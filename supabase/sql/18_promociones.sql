-- =====================================================================
-- ONTICKET - 18: PROMOCIONES
-- Requiere: 01 a 17
--
-- Decisiones del duenio del proyecto:
-- * Una promocion es sobre UN producto (no combos, no categorias).
-- * BAJA EL PRECIO COBRADO: la linea de venta guarda el precio de lista
--   (unit_price), el descuento (discount_amount) y lo cobrado
--   (line_total = quantity * unit_price - discount_amount). Los
--   impuestos se calculan sobre lo cobrado (archivo 02, seccion E) y el
--   margen baja. Los reportes muestran el descuento por promocion.
-- * Vigencia: fechas desde/hasta (opcionales), dias de la semana y
--   franja horaria (happy hour), mas el interruptor active.
-- * Barras: sin barras elegidas vale en todas; con barras, solo en esas.
--
-- Tipos (el descuento se calcula sobre el precio que cobra la caja, el
-- de su barra si tiene uno: archivo 16):
--   percentage    descuento = ROUND(cantidad * precio * porcentaje / 100, 2)
--   fixed_amount  descuento = cantidad * LEAST(monto, precio)   (por unidad)
--   nxm           lleva N, paga M: descuento = floor(cantidad / N) * (N - M) * precio
--                 (2x1 = N 2, M 1; 3x2 = N 3, M 2)
--
-- Vigencia, en la hora local del club:
--   * Los dias y las fechas son de la JORNADA (regla 27): con jornada
--     desde las 12, "viernes de 00:00 a 01:30" es la madrugada del
--     sabado del reloj, que pertenece a la noche del viernes.
--   * La franja puede cruzar la medianoche (23:00 a 02:00). Sin franja
--     vale toda la jornada. Fin excluido.
--   * weekdays: bits por dia ISO de la jornada, lunes = 1, martes = 2,
--     miercoles = 4, jueves = 8, viernes = 16, sabado = 32, domingo = 64.
--     127 = todos los dias.
--
-- El posnet aplica la promocion sin conexion (le llega por PowerSync) y
-- guarda la foto en sale_items: promotion_id, promotion_name y
-- discount_amount. Si hay varias vigentes para el mismo producto, aplica
-- la de mayor descuento. El servidor NO bloquea (regla 15):
-- v_sale_promotion_issues lista lo que no coincide con el recalculo.
--
-- Las condiciones (producto, tipo y valores) no cambian despues de
-- crearla: para otro descuento se crea otra promocion. Asi el recalculo
-- de ventas pasadas sigue valiendo. Se cambian nombre, vigencia, barras y
-- active. Se activan y desactivan; no se borran (como los impuestos).
-- =====================================================================
BEGIN;

-- =====================================================================
-- A) PROMOTIONS
-- =====================================================================
CREATE TABLE public.promotions (
    id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id        uuid          NOT NULL REFERENCES public.clubs (id),
    product_id     uuid          NOT NULL,
    name           text          NOT NULL,
    kind           text          NOT NULL,
    percentage     numeric(5,2),
    fixed_amount   numeric(12,2),
    buy_quantity   integer,
    pay_quantity   integer,
    starts_on      date,
    ends_on        date,
    weekdays       smallint      NOT NULL DEFAULT 127,
    start_time     time,
    end_time       time,
    active         boolean       NOT NULL DEFAULT true,
    created_at     timestamptz   NOT NULL DEFAULT now(),
    updated_at     timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT promotions_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 80),
    CONSTRAINT promotions_kind_check CHECK (kind IN ('percentage', 'fixed_amount', 'nxm')),
    CONSTRAINT promotions_values_check CHECK (
        CASE kind
            WHEN 'percentage'   THEN percentage > 0 AND percentage <= 100
                                     AND fixed_amount IS NULL AND buy_quantity IS NULL AND pay_quantity IS NULL
            WHEN 'fixed_amount' THEN fixed_amount > 0
                                     AND percentage IS NULL AND buy_quantity IS NULL AND pay_quantity IS NULL
            ELSE buy_quantity BETWEEN 2 AND 100 AND pay_quantity >= 1 AND pay_quantity < buy_quantity
                 AND percentage IS NULL AND fixed_amount IS NULL
        END),
    CONSTRAINT promotions_dates_check CHECK (starts_on IS NULL OR ends_on IS NULL OR starts_on <= ends_on),
    CONSTRAINT promotions_weekdays_check CHECK (weekdays BETWEEN 1 AND 127),
    CONSTRAINT promotions_time_check CHECK (
        (start_time IS NULL AND end_time IS NULL)
        OR (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time <> end_time)),
    CONSTRAINT promotions_id_club_unique UNIQUE (id, club_id),
    CONSTRAINT promotions_product_fk
        FOREIGN KEY (product_id, club_id) REFERENCES public.products (id, club_id)
);
COMMENT ON TABLE public.promotions IS
    'Promocion sobre un producto: porcentaje, monto fijo por unidad o NxM, con vigencia (fechas, dias, franja). Baja el precio cobrado.';

CREATE INDEX idx_promotions_club    ON public.promotions (club_id);
CREATE INDEX idx_promotions_product ON public.promotions (product_id, club_id);


-- =====================================================================
-- B) PROMOTION_LOCATIONS  (barras donde vale; sin filas = todas)
-- =====================================================================
CREATE TABLE public.promotion_locations (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id       uuid         NOT NULL REFERENCES public.clubs (id),
    promotion_id  uuid         NOT NULL,
    location_id   uuid         NOT NULL,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT promotion_locations_one_per_bar UNIQUE (promotion_id, location_id),
    CONSTRAINT promotion_locations_id_club_unique UNIQUE (id, club_id),
    CONSTRAINT promotion_locations_promotion_fk
        FOREIGN KEY (promotion_id, club_id) REFERENCES public.promotions (id, club_id),
    CONSTRAINT promotion_locations_location_fk
        FOREIGN KEY (location_id, club_id) REFERENCES public.inventory_locations (id, club_id)
);
COMMENT ON TABLE public.promotion_locations IS
    'Barras donde vale una promocion. Sin filas vale en todas. Se agregan y se borran filas.';

CREATE INDEX idx_promotion_locations_club      ON public.promotion_locations (club_id);
CREATE INDEX idx_promotion_locations_promotion ON public.promotion_locations (promotion_id, club_id);
CREATE INDEX idx_promotion_locations_location  ON public.promotion_locations (location_id, club_id);


-- =====================================================================
-- C) SALE_ITEMS: foto de la promocion aplicada
-- =====================================================================
ALTER TABLE public.sale_items
    ADD COLUMN promotion_id    uuid,
    ADD COLUMN promotion_name  text,
    ADD COLUMN discount_amount numeric(12,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.sale_items.unit_price IS 'Precio de lista por unidad al vender (el de la barra si tenia).';
COMMENT ON COLUMN public.sale_items.discount_amount IS 'Descuento de la promocion en toda la linea. line_total = quantity * unit_price - discount_amount.';

ALTER TABLE public.sale_items DROP CONSTRAINT sale_items_line_total_check;
ALTER TABLE public.sale_items
    ADD CONSTRAINT sale_items_line_total_check CHECK (line_total = quantity * unit_price - discount_amount),
    ADD CONSTRAINT sale_items_discount_check CHECK (
        discount_amount >= 0
        AND discount_amount <= quantity * unit_price
        AND (promotion_id IS NOT NULL OR discount_amount = 0)
        AND ((promotion_id IS NULL) = (promotion_name IS NULL))),
    ADD CONSTRAINT sale_items_promotion_fk
        FOREIGN KEY (promotion_id, club_id) REFERENCES public.promotions (id, club_id);

CREATE INDEX idx_sale_items_promotion ON public.sale_items (promotion_id, club_id);


-- =====================================================================
-- D) REGLAS
-- =====================================================================
-- Solo sobre un producto comun (no un combo), y las condiciones no
-- cambian despues de crearla.
CREATE OR REPLACE FUNCTION private.promotion_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND (NEW.product_id   IS DISTINCT FROM OLD.product_id
         OR NEW.kind         IS DISTINCT FROM OLD.kind
         OR NEW.percentage   IS DISTINCT FROM OLD.percentage
         OR NEW.fixed_amount IS DISTINCT FROM OLD.fixed_amount
         OR NEW.buy_quantity IS DISTINCT FROM OLD.buy_quantity
         OR NEW.pay_quantity IS DISTINCT FROM OLD.pay_quantity) THEN
        RAISE EXCEPTION 'Las condiciones de una promocion no cambian: crear otra'
            USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'INSERT' AND NOT EXISTS (
        SELECT 1 FROM public.products p
         WHERE p.id = NEW.product_id AND p.club_id = NEW.club_id
           AND p.kind = 'product' AND p.deleted_at IS NULL) THEN
        RAISE EXCEPTION 'Una promocion es sobre un producto del club (no un combo)'
            USING ERRCODE = 'check_violation';
    END IF;
    NEW.name := btrim(NEW.name);
    RETURN NEW;
END;
$$;

-- Corre despues de club_fixed (orden alfabetico).
CREATE TRIGGER trg_promotions_validate
    BEFORE INSERT OR UPDATE ON public.promotions
    FOR EACH ROW EXECUTE FUNCTION private.promotion_check();
CREATE TRIGGER trg_promotions_club_fixed
    BEFORE UPDATE OF club_id ON public.promotions
    FOR EACH ROW EXECUTE FUNCTION private.forbid_club_change();
CREATE TRIGGER trg_promotions_updated_at
    BEFORE UPDATE ON public.promotions
    FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
-- created / updated / activated / deactivated, con antes y despues.
CREATE TRIGGER trg_promotions_audit
    AFTER INSERT OR UPDATE ON public.promotions
    FOR EACH ROW EXECUTE FUNCTION private.audit_catalog_change('promotion');

-- Solo barras (un deposito no vende).
CREATE OR REPLACE FUNCTION private.promotion_location_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.inventory_locations l
                    WHERE l.id = NEW.location_id AND l.club_id = NEW.club_id
                      AND l.kind = 'bar' AND l.deleted_at IS NULL) THEN
        RAISE EXCEPTION 'Una promocion solo se limita a barras' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_promotion_locations_validate
    BEFORE INSERT ON public.promotion_locations
    FOR EACH ROW EXECUTE FUNCTION private.promotion_location_check();

-- Auditoria de barras: agregar y quitar. SECURITY DEFINER: el panel no
-- escribe en audit_log.
CREATE OR REPLACE FUNCTION private.promotion_location_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_type text;
    v_actor_id   uuid;
    v_row        public.promotion_locations;
BEGIN
    SELECT a.actor_type, a.actor_id INTO v_actor_type, v_actor_id FROM private.current_actor() a;
    IF v_actor_id IS NULL THEN
        RETURN NULL;
    END IF;
    v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    INSERT INTO public.audit_log (club_id, actor_type, actor_id, action, entity_type, entity_id, details)
    VALUES (v_row.club_id, v_actor_type, v_actor_id,
            CASE TG_OP WHEN 'INSERT' THEN 'promotion.bar_added' ELSE 'promotion.bar_removed' END,
            'promotion', v_row.promotion_id,
            jsonb_build_object('location_id', v_row.location_id));
    RETURN NULL;
END;
$$;
CREATE TRIGGER trg_promotion_locations_audit
    AFTER INSERT OR DELETE ON public.promotion_locations
    FOR EACH ROW EXECUTE FUNCTION private.promotion_location_audit();


-- =====================================================================
-- E) REPORTES: el descuento por promocion, separado del de sustitucion
-- (se agregan columnas al final; las anteriores no cambian de nombre).
--   substitution_discount = valor de lista entregado - lista vendida
--   promotion_discount    = discount_amount de la linea
--   revenue (line_total)  = lo cobrado, ya con la promocion
-- =====================================================================
CREATE OR REPLACE VIEW public.v_sale_item_financials
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
    calc.list_value_delivered - si.quantity * si.unit_price      AS substitution_discount,
    si.line_total - calc.cost_effective                          AS gross_margin,
    calc.tax_total,
    si.line_total - calc.cost_effective - calc.tax_total         AS net_margin,
    si.promotion_id,
    si.promotion_name,
    si.discount_amount                                           AS promotion_discount
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
COMMENT ON VIEW public.v_sale_item_financials IS
    'Finanzas por item vendido: ingreso (con promocion), costo real, descuentos por sustitucion y por promocion, impuestos y margenes.';

CREATE OR REPLACE VIEW public.v_club_daily_stats
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
    SUM(f.net_margin)             AS net_margin,
    SUM(f.promotion_discount)     AS promotion_discount
FROM public.v_sale_item_financials f
GROUP BY f.club_id, f.business_day;
COMMENT ON VIEW public.v_club_daily_stats IS 'Totales por club y jornada. Siempre filtrar por club_id.';


-- Regla de vigencia (la misma que repite el posnet). Funcion pura: recibe
-- la hora LOCAL del club y su hora de inicio de jornada; no lee tablas.
-- Las fechas y los dias son de la jornada; la franja, del reloj local.
CREATE OR REPLACE FUNCTION private.promotion_in_schedule(
    p_starts_on      date,
    p_ends_on        date,
    p_weekdays       smallint,
    p_start_time     time,
    p_end_time       time,
    p_local_ts       timestamp,
    p_day_start_hour integer
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT (p_starts_on IS NULL OR d.business_day >= p_starts_on)
       AND (p_ends_on   IS NULL OR d.business_day <= p_ends_on)
       AND (p_weekdays & (1 << (extract(isodow FROM d.business_day)::int - 1))) <> 0
       AND CASE
               WHEN p_start_time IS NULL THEN true
               WHEN p_start_time < p_end_time
                   THEN p_local_ts::time >= p_start_time AND p_local_ts::time < p_end_time
               ELSE p_local_ts::time >= p_start_time OR p_local_ts::time < p_end_time
           END
      FROM (SELECT (p_local_ts - make_interval(hours => p_day_start_hour))::date AS business_day) d;
$$;

-- Estado de cada promocion AHORA, en la hora local del club: para la
-- lista del panel.
CREATE VIEW public.v_promotions_status
WITH (security_invoker = true) AS
SELECT
    p.id AS promotion_id,
    p.club_id,
    p.product_id,
    p.active,
    d.business_day,
    v.in_schedule                                            AS in_schedule_now,
    (p.active AND v.in_schedule)                             AS applies_now,
    (p.ends_on IS NOT NULL AND p.ends_on < d.business_day)   AS expired
FROM public.promotions p
JOIN public.clubs c ON c.id = p.club_id
CROSS JOIN LATERAL (
    SELECT (now() AT TIME ZONE c.timezone) AS local_ts
) l
CROSS JOIN LATERAL (
    SELECT (l.local_ts - make_interval(hours => c.business_day_start_hour))::date AS business_day
) d
CROSS JOIN LATERAL (
    SELECT private.promotion_in_schedule(p.starts_on, p.ends_on, p.weekdays, p.start_time, p.end_time,
                                         l.local_ts, c.business_day_start_hour) AS in_schedule
) v;
COMMENT ON VIEW public.v_promotions_status IS
    'Por promocion: si su vigencia (fechas y dias de la jornada, franja horaria local) incluye este momento y si se aplica.';


-- Control: lineas con promocion cuyo descuento no coincide con el
-- recalculo, o con una promocion de otro producto. No bloquea nada.
-- La vigencia no se controla: la hora del posnet no es confiable (regla 19).
CREATE VIEW public.v_sale_promotion_issues
WITH (security_invoker = true) AS
SELECT
    si.id AS sale_item_id,
    si.club_id,
    si.sale_id,
    s.ticket_number,
    si.product_id,
    si.product_name,
    si.promotion_id,
    si.promotion_name,
    si.quantity,
    si.unit_price,
    si.discount_amount,
    e.amount AS expected_discount,
    (p.product_id <> si.product_id) AS wrong_product
FROM public.sale_items si
JOIN public.sales s      ON s.id = si.sale_id      AND s.club_id = si.club_id
JOIN public.promotions p ON p.id = si.promotion_id AND p.club_id = si.club_id
CROSS JOIN LATERAL (
    SELECT CASE p.kind
               WHEN 'percentage'   THEN ROUND(si.quantity * si.unit_price * p.percentage / 100, 2)
               WHEN 'fixed_amount' THEN si.quantity * LEAST(p.fixed_amount, si.unit_price)
               ELSE (si.quantity / p.buy_quantity) * (p.buy_quantity - p.pay_quantity) * si.unit_price
           END AS amount
) e
WHERE p.product_id <> si.product_id
   OR ABS(si.discount_amount - e.amount) > 0.01;
COMMENT ON VIEW public.v_sale_promotion_issues IS
    'Lineas vendidas con promocion cuyo descuento no coincide con el recalculo o cuyo producto no es el de la promocion.';


-- =====================================================================
-- F) SEGURIDAD (mismo patron que 08 y 16)
-- =====================================================================
ALTER TABLE public.promotions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY promotions_select ON public.promotions
    FOR SELECT TO authenticated USING (club_id IN (SELECT private.visible_club_ids()));
CREATE POLICY promotions_insert ON public.promotions
    FOR INSERT TO authenticated WITH CHECK (club_id IN (SELECT private.visible_club_ids()));
CREATE POLICY promotions_update ON public.promotions
    FOR UPDATE TO authenticated
    USING      (club_id IN (SELECT private.visible_club_ids()))
    WITH CHECK (club_id IN (SELECT private.visible_club_ids()));

CREATE POLICY promotion_locations_select ON public.promotion_locations
    FOR SELECT TO authenticated USING (club_id IN (SELECT private.visible_club_ids()));
CREATE POLICY promotion_locations_insert ON public.promotion_locations
    FOR INSERT TO authenticated WITH CHECK (club_id IN (SELECT private.visible_club_ids()));
CREATE POLICY promotion_locations_delete ON public.promotion_locations
    FOR DELETE TO authenticated USING (club_id IN (SELECT private.visible_club_ids()));

REVOKE ALL ON public.promotions, public.promotion_locations,
              public.v_promotions_status, public.v_sale_promotion_issues
    FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.promotions, public.promotion_locations TO service_role;
GRANT SELECT ON public.v_promotions_status, public.v_sale_promotion_issues TO service_role, authenticated;

GRANT SELECT ON public.promotions TO authenticated;
GRANT INSERT (club_id, product_id, name, kind, percentage, fixed_amount, buy_quantity, pay_quantity,
              starts_on, ends_on, weekdays, start_time, end_time, active)
    ON public.promotions TO authenticated;
GRANT UPDATE (name, starts_on, ends_on, weekdays, start_time, end_time, active)
    ON public.promotions TO authenticated;

GRANT SELECT, DELETE ON public.promotion_locations TO authenticated;
GRANT INSERT (club_id, promotion_id, location_id) ON public.promotion_locations TO authenticated;

-- promotion_in_schedule es pura (no lee tablas) y la usa una vista del panel.
REVOKE EXECUTE ON FUNCTION private.promotion_in_schedule(date, date, smallint, time, time, timestamp, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.promotion_in_schedule(date, date, smallint, time, time, timestamp, integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.promotion_check()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.promotion_location_check() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.promotion_location_audit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.promotion_check()          TO service_role;
GRANT EXECUTE ON FUNCTION private.promotion_location_check() TO service_role;
GRANT EXECUTE ON FUNCTION private.promotion_location_audit() TO service_role;

-- El posnet aplica las promociones sin conexion: necesita ambas tablas.
DO $$
DECLARE
    t text;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync') THEN
        FOREACH t IN ARRAY ARRAY['promotions', 'promotion_locations'] LOOP
            IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                            WHERE pubname = 'powersync' AND schemaname = 'public' AND tablename = t) THEN
                EXECUTE format('ALTER PUBLICATION powersync ADD TABLE public.%I', t);
            END IF;
        END LOOP;
    END IF;
END;
$$;

COMMIT;
