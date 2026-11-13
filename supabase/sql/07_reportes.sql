-- =====================================================================
-- ONTICKET - 07 de 09: REPORTES (VISTAS) Y VISTA PREVIA DE IMPUESTOS
-- Requiere: 01 a 06
--
-- * Todas las vistas llevan security_invoker = true: respetan las
--   politicas RLS de quien consulta. Un administrador solo ve datos de
--   sus clubs; nunca hay cruce entre clubs.
-- * Las estadisticas son SIEMPRE por club (toda vista expone club_id).
-- * Las vistas no se sincronizan al posnet: son para el panel web.
-- * Glosario de columnas de dinero:
--     revenue               lo cobrado al cliente
--     cost_effective        costo real (el del producto ENTREGADO)
--     substitution_discount valor de lista entregado - lo cobrado
--     gross_margin          revenue - cost_effective
--     tax_total             impuestos incluidos en el precio
--     net_margin            gross_margin - tax_total
-- =====================================================================
BEGIN;

-- =====================================================================
-- A) v_sale_item_financials  (una fila por item vendido)
-- Ejemplo: Corona vendida a 5000 (costo 1000), entregada como Heineken
-- (lista 6000, costo 2000), pagada con tarjeta con 260 de impuestos:
--   revenue 5000 | cost_effective 2000 | substitution_discount 1000
--   gross_margin 3000 | tax_total 260 | net_margin 2740
-- business_day: jornada del club (ver clubs.business_day_start_hour).
-- =====================================================================
CREATE VIEW public.v_sale_item_financials
WITH (security_invoker = true) AS
SELECT
    si.id                       AS sale_item_id,
    si.club_id,
    si.sale_id,
    s.ticket_number,
    s.created_at_device         AS sold_at,
    ((s.created_at_device AT TIME ZONE c.timezone)
        - make_interval(hours => c.business_day_start_hour))::date AS business_day,
    si.product_id               AS sold_product_id,
    si.product_name             AS sold_product_name,
    si.quantity,
    si.unit_price,
    si.unit_cost,
    COALESCE(sub.quantity, 0)   AS quantity_substituted,
    si.line_total               AS revenue,
    calc.cost_effective,
    calc.list_value_delivered,
    calc.list_value_delivered - si.line_total                    AS substitution_discount,
    si.line_total - calc.cost_effective                          AS gross_margin,
    calc.tax_total,
    si.line_total - calc.cost_effective - calc.tax_total         AS net_margin
FROM public.sale_items si
JOIN public.sales s ON s.id = si.sale_id AND s.club_id = si.club_id
JOIN public.clubs c ON c.id = si.club_id
LEFT JOIN (
    SELECT x.sale_item_id,
           SUM(x.quantity)                            AS quantity,
           SUM(x.quantity * x.substitute_unit_cost)   AS cost,
           SUM(x.quantity * x.substitute_unit_price)  AS list_value
      FROM public.sale_item_substitutions x
     GROUP BY x.sale_item_id
) sub ON sub.sale_item_id = si.id
LEFT JOIN (
    SELECT t.sale_item_id, SUM(t.amount) AS amount
      FROM public.sale_item_taxes t
     GROUP BY t.sale_item_id
) tax ON tax.sale_item_id = si.id
CROSS JOIN LATERAL (
    SELECT (si.quantity - COALESCE(sub.quantity, 0)) * si.unit_cost  + COALESCE(sub.cost, 0)       AS cost_effective,
           (si.quantity - COALESCE(sub.quantity, 0)) * si.unit_price + COALESCE(sub.list_value, 0) AS list_value_delivered,
           COALESCE(tax.amount, 0)                                                                 AS tax_total
) calc;
COMMENT ON VIEW public.v_sale_item_financials IS 'Finanzas por item vendido: ingreso, costo real, descuento por sustitucion, impuestos y margenes.';


-- =====================================================================
-- B) v_club_daily_stats  (estadisticas por club y por jornada)
-- =====================================================================
CREATE VIEW public.v_club_daily_stats
WITH (security_invoker = true) AS
SELECT
    f.club_id,
    f.business_day,
    COUNT(DISTINCT f.sale_id)     AS tickets,
    SUM(f.quantity)               AS units,
    SUM(f.revenue)                AS revenue,
    SUM(f.cost_effective)         AS cost,
    SUM(f.substitution_discount)  AS substitution_discount,
    SUM(f.gross_margin)           AS gross_margin,
    SUM(f.tax_total)              AS taxes,
    SUM(f.net_margin)             AS net_margin
FROM public.v_sale_item_financials f
GROUP BY f.club_id, f.business_day;
COMMENT ON VIEW public.v_club_daily_stats IS 'Totales por club y jornada. Siempre filtrar por club_id.';


-- =====================================================================
-- C) v_sale_taxes_detail  (impuestos de cada venta, con su foto)
-- Muestra el nombre y la tasa que tenia el impuesto AL VENDER, aunque
-- despues se haya renombrado, cambiado o desactivado.
-- =====================================================================
CREATE VIEW public.v_sale_taxes_detail
WITH (security_invoker = true) AS
SELECT
    t.club_id,
    t.sale_id,
    s.ticket_number,
    s.created_at_device AS sold_at,
    t.tax_id,
    t.tax_name,
    t.kind,
    t.percentage,
    t.fixed_amount,
    t.applies_to_methods,
    SUM(t.amount) AS amount
FROM public.sale_item_taxes t
JOIN public.sales s ON s.id = t.sale_id AND s.club_id = t.club_id
GROUP BY t.club_id, t.sale_id, s.ticket_number, s.created_at_device,
         t.tax_id, t.tax_name, t.kind, t.percentage, t.fixed_amount, t.applies_to_methods;
COMMENT ON VIEW public.v_sale_taxes_detail IS 'Impuestos aplicados por venta, con los datos historicos del impuesto.';


-- =====================================================================
-- D) CONTROLES: lo que no cierra, para que un encargado lo revise.
-- No bloquean nada (las ventas ya ocurrieron).
-- =====================================================================

-- D1) Ventas cuyo total no coincide con sus items o con sus pagos.
--     Puede mostrar filas por unos segundos mientras termina de subir
--     una venta (los items y pagos llegan despues de la cabecera).
CREATE VIEW public.v_sales_integrity_issues
WITH (security_invoker = true) AS
SELECT
    s.id AS sale_id,
    s.club_id,
    s.ticket_number,
    s.total,
    COALESCE(i.items_total, 0) AS items_total,
    COALESCE(p.paid_total, 0)  AS paid_total
FROM public.sales s
LEFT JOIN (
    SELECT si.sale_id, SUM(si.line_total) AS items_total
      FROM public.sale_items si
     GROUP BY si.sale_id
) i ON i.sale_id = s.id
LEFT JOIN (
    SELECT sp.sale_id, SUM(sp.amount) AS paid_total
      FROM public.sale_payments sp
     GROUP BY sp.sale_id
) p ON p.sale_id = s.id
WHERE s.total <> COALESCE(i.items_total, 0)
   OR s.total <> COALESCE(p.paid_total, 0);
COMMENT ON VIEW public.v_sales_integrity_issues IS 'Ventas cuyo total no coincide con la suma de items o de pagos.';

-- D2) Numeros de ticket repetidos dentro de un club (dos posnets sin
--     conexion usaron el mismo numero). El QR identifica la venta por su
--     id, asi que el retiro funciona igual; conviene renumerar en papel.
CREATE VIEW public.v_ticket_number_conflicts
WITH (security_invoker = true) AS
SELECT
    s.club_id,
    s.ticket_number,
    COUNT(*)                 AS sales_count,
    MIN(s.created_at_device) AS first_sold_at,
    MAX(s.created_at_device) AS last_sold_at
FROM public.sales s
GROUP BY s.club_id, s.ticket_number
HAVING COUNT(*) > 1;
COMMENT ON VIEW public.v_ticket_number_conflicts IS 'Numeros de ticket usados por mas de una venta del mismo club.';

-- D3) Impuestos cuyo monto no coincide con el recalculo del servidor
--     (formulas en el archivo 02, seccion E). Tolerancia: 1 centavo.
CREATE VIEW public.v_sale_tax_issues
WITH (security_invoker = true) AS
SELECT
    t.id AS sale_item_tax_id,
    t.club_id,
    t.sale_id,
    s.ticket_number,
    t.tax_name,
    t.amount,
    expected.amount AS expected_amount,
    t.taxable_ratio,
    ratio.value     AS expected_ratio
FROM public.sale_item_taxes t
JOIN public.sale_items si ON si.id = t.sale_item_id AND si.club_id = t.club_id
JOIN public.sales s       ON s.id  = t.sale_id      AND s.club_id  = t.club_id
CROSS JOIN LATERAL (
    -- lo pagado con los metodos alcanzados por el impuesto
    SELECT COALESCE(SUM(sp.amount), 0) AS amount
      FROM public.sale_payments sp
     WHERE sp.sale_id = t.sale_id
       AND sp.method = ANY (string_to_array(t.applies_to_methods, ','))
) paid
CROSS JOIN LATERAL (
    SELECT CASE WHEN s.total > 0 THEN LEAST(paid.amount / s.total, 1) ELSE 0 END AS value
) ratio
CROSS JOIN LATERAL (
    SELECT ROUND(CASE t.kind
               WHEN 'percentage' THEN si.line_total * t.percentage / 100 * t.taxable_ratio
               ELSE t.fixed_amount * si.quantity * t.taxable_ratio
           END, 2) AS amount
) expected
WHERE ABS(t.amount - expected.amount) > 0.01
   OR ABS(t.taxable_ratio - ratio.value) > 0.0005;
COMMENT ON VIEW public.v_sale_tax_issues IS 'Impuestos de ventas cuyo monto o proporcion no coincide con el recalculo del servidor.';


-- =====================================================================
-- E) product_tax_preview  (para el formulario de producto del panel)
--
--   supabase.rpc('product_tax_preview', { p_club_id, p_price, p_cost })
--
-- Devuelve, por cada metodo de pago, cada impuesto ACTIVO que aplica
-- (con su nombre y monto) y los totales del metodo: impuestos, neto y
-- margen despues de impuestos. Los totales se repiten en cada fila del
-- metodo. Un metodo sin impuestos devuelve una fila con tax_id NULL.
-- Si quien llama no gestiona el club, no devuelve filas.
--
-- Ejemplo (precio 5000, costo 1000; tarjeta: 3 % + 1,2 % + $50 fijo):
--   impuestos 260 | neto 4740 | margen 3740 (74,80 %)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.product_tax_preview(
    p_club_id uuid,
    p_price   numeric,
    p_cost    numeric
)
RETURNS TABLE (
    payment_method        text,
    payment_method_label  text,
    tax_id                uuid,
    tax_name              text,
    tax_kind              text,
    percentage            numeric,
    fixed_amount          numeric,
    tax_amount            numeric,
    total_taxes           numeric,
    net_after_taxes       numeric,
    margin_after_taxes    numeric,
    margin_pct            numeric
)
LANGUAGE sql
STABLE
STRICT
SET search_path = ''
AS $$
    WITH methods AS (
        SELECT pm.code, pm.label, pm.sort_order
          FROM public.payment_methods pm
         WHERE p_club_id IN (SELECT private.visible_club_ids())
    ),
    applied AS (
        SELECT tpm.method,
               t.id   AS tax_id,
               t.name AS tax_name,
               t.kind,
               t.percentage,
               t.fixed_amount,
               ROUND(CASE t.kind
                         WHEN 'percentage' THEN p_price * t.percentage / 100
                         ELSE t.fixed_amount
                     END, 2) AS amount
          FROM public.taxes t
          JOIN public.tax_payment_methods tpm
            ON tpm.tax_id = t.id AND tpm.club_id = t.club_id
         WHERE t.club_id = p_club_id
           AND t.active
    ),
    totals AS (
        SELECT m.code, COALESCE(SUM(a.amount), 0) AS total
          FROM methods m
          LEFT JOIN applied a ON a.method = m.code
         GROUP BY m.code
    )
    SELECT m.code,
           m.label,
           a.tax_id,
           a.tax_name,
           a.kind,
           a.percentage,
           a.fixed_amount,
           COALESCE(a.amount, 0),
           tt.total,
           p_price - tt.total,
           p_price - tt.total - p_cost,
           CASE WHEN p_price > 0
                THEN ROUND((p_price - tt.total - p_cost) / p_price * 100, 2)
           END
      FROM methods m
      JOIN totals tt ON tt.code = m.code
      LEFT JOIN applied a ON a.method = m.code
     ORDER BY m.sort_order, a.tax_name;
$$;
COMMENT ON FUNCTION public.product_tax_preview(uuid, numeric, numeric) IS 'Vista previa de impuestos y margen por metodo de pago para un precio y costo dados.';

COMMIT;
