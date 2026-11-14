-- =====================================================================
-- ONTICKET - 11: METODOS DE PAGO COMUNES A TODOS LOS CLUBS
-- Requiere: 01 a 10
--
-- Todos los clubs cobran con los mismos metodos: PIX, Transferencia y
-- Efectivo. El catalogo sigue siendo global (public.payment_methods).
--
-- "Mixto" NO es un metodo: es una venta pagada con varios de estos
-- metodos (varias filas de sale_payments). Asi cada impuesto se aplica
-- en proporcion a la parte pagada con sus metodos (regla 23). Un metodo
-- "mixto" no diria que parte se pago con que.
--
-- Tarjeta y Otro quedan INACTIVOS, no se borran: las ventas e impuestos
-- que ya los usan conservan su historia (reglas 7 y 24).
-- =====================================================================
BEGIN;

-- A) Columna active: un metodo inactivo no se ofrece en el panel ni en
--    el posnet, pero las filas que ya lo referencian siguen validas.
ALTER TABLE public.payment_methods
    ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.payment_methods.active IS 'false: ya no se ofrece. Las ventas e impuestos que lo usaron no cambian.';

-- B) El catalogo: PIX, Transferencia, Efectivo (en ese orden).
INSERT INTO public.payment_methods (code, label, sort_order, active) VALUES
    ('pix',      'PIX',           1, true),
    ('transfer', 'Transferencia', 2, true),
    ('cash',     'Efectivo',      3, true)
ON CONFLICT (code) DO UPDATE
    SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order, active = true;

UPDATE public.payment_methods
   SET active = false, sort_order = sort_order + 100
 WHERE code IN ('card', 'other') AND active;

-- C) Un impuesto nuevo no puede usar un metodo inactivo. Las filas que
--    ya existian se conservan (se pueden quitar desde el panel).
CREATE OR REPLACE FUNCTION private.check_tax_method_active()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    -- Un metodo que no existe lo rechaza la clave foranea (foreign key).
    IF EXISTS (SELECT 1 FROM public.payment_methods pm
                WHERE pm.code = NEW.method AND NOT pm.active) THEN
        RAISE EXCEPTION 'El metodo de pago % ya no se usa', NEW.method
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.check_tax_method_active() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION private.check_tax_method_active() TO service_role;

DROP TRIGGER IF EXISTS trg_tax_payment_methods_method_active ON public.tax_payment_methods;
CREATE TRIGGER trg_tax_payment_methods_method_active
    BEFORE INSERT ON public.tax_payment_methods
    FOR EACH ROW EXECUTE FUNCTION private.check_tax_method_active();

-- D) Vista previa de impuestos: solo metodos activos.
--    Misma firma y resultado que en 07; solo cambia el filtro de metodos.
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
         WHERE pm.active
           AND p_club_id IN (SELECT private.visible_club_ids())
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
COMMENT ON FUNCTION public.product_tax_preview(uuid, numeric, numeric) IS 'Vista previa de impuestos y margen por metodo de pago ACTIVO para un precio y costo dados.';
REVOKE EXECUTE ON FUNCTION public.product_tax_preview(uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.product_tax_preview(uuid, numeric, numeric) TO authenticated, service_role;

COMMIT;
