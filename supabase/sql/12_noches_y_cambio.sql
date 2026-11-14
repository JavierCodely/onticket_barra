-- =====================================================================
-- ONTICKET - 12: NOCHE (INICIAR / PARAR), CAMBIO EN EFECTIVO Y VENTAS
-- Requiere: 01 a 11
--
-- NOCHE (club_nights): el boton maestro del panel.
--   * INICIAR = el panel inserta una fila. Un trigger:
--       - toma la FOTO del stock de cada ubicacion (night_stock_snapshots,
--         kind 'opening');
--       - audita 'night.started'.
--     Una sola noche abierta por club (uq_club_nights_one_open).
--   * Cada caja arranca con su CAMBIO en efectivo (cash_register_floats,
--     kind 'opening'); durante la noche se agregan refuerzos ('top_up').
--     Libro de solo agregar: un error se corrige con 'correction'.
--   * PARAR = el panel escribe ended_at (el trigger pone la hora del
--     servidor). Otro trigger toma la foto de cierre, cierra los turnos
--     de caja abiertos y audita 'night.ended'. Una noche cerrada no se
--     reabre: se inicia otra.
--
-- SIN CONEXION: el posnet solo vende si tiene sincronizada una noche
-- abierta y guarda su id en sales.night_id. Si la noche se paro mientras
-- estaba sin conexion, sus ventas se ACEPTAN igual (regla 15) y aparecen
-- en v_sales_outside_night para que el encargado las revise.
--
-- VENTAS EN EL PANEL: v_sales_list (lista con filtros y en tiempo real),
-- v_night_register_summary (resumen por caja: efectivo = ventas en
-- efectivo + cambio) y v_night_stock_summary (foto de apertura y cierre).
-- =====================================================================
BEGIN;

-- =====================================================================
-- A) CLUB_NIGHTS
-- =====================================================================
CREATE TABLE public.club_nights (
    id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id              uuid        NOT NULL REFERENCES public.clubs (id),
    started_at           timestamptz NOT NULL DEFAULT now(),
    started_by_type      text,
    started_by_id        uuid,
    ended_at             timestamptz,
    ended_by_type        text,
    ended_by_id          uuid,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT club_nights_ended_after_started CHECK (ended_at IS NULL OR ended_at >= started_at),
    CONSTRAINT club_nights_started_by_check CHECK (
        (started_by_type IS NULL AND started_by_id IS NULL)
        OR (started_by_type IN ('platform_admin', 'user') AND started_by_id IS NOT NULL)),
    CONSTRAINT club_nights_ended_by_check CHECK (
        (ended_by_type IS NULL AND ended_by_id IS NULL)
        OR (ended_by_type IN ('platform_admin', 'user') AND ended_by_id IS NOT NULL AND ended_at IS NOT NULL)),
    CONSTRAINT club_nights_id_club_unique UNIQUE (id, club_id)
);
COMMENT ON TABLE public.club_nights IS 'Noches de operacion del club. Sin noche abierta el posnet no vende.';

CREATE UNIQUE INDEX uq_club_nights_one_open ON public.club_nights (club_id) WHERE ended_at IS NULL;
CREATE INDEX idx_club_nights_club_started  ON public.club_nights (club_id, started_at DESC);


-- =====================================================================
-- B) NIGHT_STOCK_SNAPSHOTS  (foto del stock al iniciar y al parar)
-- La escriben solo los triggers. Solo agregar.
-- =====================================================================
CREATE TABLE public.night_stock_snapshots (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id      uuid        NOT NULL REFERENCES public.clubs (id),
    night_id     uuid        NOT NULL,
    location_id  uuid        NOT NULL,
    product_id   uuid        NOT NULL,
    kind         text        NOT NULL,
    quantity     integer     NOT NULL,
    taken_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT night_stock_snapshots_kind_check CHECK (kind IN ('opening', 'closing')),
    CONSTRAINT night_stock_snapshots_unique UNIQUE (night_id, kind, location_id, product_id),
    CONSTRAINT night_stock_snapshots_night_fk
        FOREIGN KEY (night_id, club_id) REFERENCES public.club_nights (id, club_id),
    CONSTRAINT night_stock_snapshots_location_fk
        FOREIGN KEY (location_id, club_id) REFERENCES public.inventory_locations (id, club_id),
    CONSTRAINT night_stock_snapshots_product_fk
        FOREIGN KEY (product_id, club_id) REFERENCES public.products (id, club_id)
);
COMMENT ON TABLE public.night_stock_snapshots IS 'Foto del stock por ubicacion al iniciar y al parar cada noche. Solo agregar.';

CREATE INDEX idx_night_stock_snapshots_club     ON public.night_stock_snapshots (club_id);
CREATE INDEX idx_night_stock_snapshots_night    ON public.night_stock_snapshots (night_id, club_id);
CREATE INDEX idx_night_stock_snapshots_location ON public.night_stock_snapshots (location_id, club_id);
CREATE INDEX idx_night_stock_snapshots_product  ON public.night_stock_snapshots (product_id, club_id);


-- =====================================================================
-- C) CASH_REGISTER_FLOATS  (cambio en efectivo que se le da a cada caja)
--   opening    : el cambio con que arranca la caja (uno por caja y noche)
--   top_up     : refuerzo durante la noche (monto positivo)
--   correction : corrige un error (puede ser negativo). Solo agregar.
-- =====================================================================
CREATE TABLE public.cash_register_floats (
    id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id           uuid          NOT NULL REFERENCES public.clubs (id),
    night_id          uuid          NOT NULL,
    cash_register_id  uuid          NOT NULL,
    kind              text          NOT NULL,
    amount            numeric(12,2) NOT NULL,
    note              text,
    actor_type        text,
    actor_id          uuid,
    created_at        timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT cash_register_floats_kind_check CHECK (kind IN ('opening', 'top_up', 'correction')),
    CONSTRAINT cash_register_floats_amount_check CHECK (
        (kind IN ('opening', 'top_up') AND amount > 0) OR (kind = 'correction' AND amount <> 0)),
    CONSTRAINT cash_register_floats_actor_check CHECK (
        (actor_type IS NULL AND actor_id IS NULL)
        OR (actor_type IN ('platform_admin', 'user') AND actor_id IS NOT NULL)),
    CONSTRAINT cash_register_floats_night_fk
        FOREIGN KEY (night_id, club_id) REFERENCES public.club_nights (id, club_id),
    CONSTRAINT cash_register_floats_register_fk
        FOREIGN KEY (cash_register_id, club_id) REFERENCES public.cash_registers (id, club_id)
);
COMMENT ON TABLE public.cash_register_floats IS 'Cambio en efectivo entregado a cada caja por noche (inicial y refuerzos). Solo agregar.';

CREATE UNIQUE INDEX uq_cash_register_floats_opening
    ON public.cash_register_floats (night_id, cash_register_id) WHERE kind = 'opening';
CREATE INDEX idx_cash_register_floats_club     ON public.cash_register_floats (club_id);
CREATE INDEX idx_cash_register_floats_night    ON public.cash_register_floats (night_id, club_id);
CREATE INDEX idx_cash_register_floats_register ON public.cash_register_floats (cash_register_id, club_id);


-- =====================================================================
-- D) SALES.NIGHT_ID  (la noche en la que vendio el posnet)
-- NULL solo en ventas anteriores a este archivo o de un posnet viejo:
-- no se rechaza (regla 15), se lista en v_sales_outside_night.
-- Si la noche todavia no llego al servidor: 23503 y pos-upload reintenta.
-- =====================================================================
ALTER TABLE public.sales ADD COLUMN night_id uuid;
ALTER TABLE public.sales ADD CONSTRAINT sales_night_fk
    FOREIGN KEY (night_id, club_id) REFERENCES public.club_nights (id, club_id);
CREATE INDEX idx_sales_night ON public.sales (night_id, club_id);
COMMENT ON COLUMN public.sales.night_id IS 'Noche abierta en el posnet al vender. NULL: venta sin noche (se revisa).';


-- =====================================================================
-- E) REGLAS (triggers)
-- =====================================================================

-- E1) Al iniciar: la hora es la del servidor y queda firmado quien fue.
CREATE OR REPLACE FUNCTION private.night_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_actor_type text;
    v_actor_id   uuid;
BEGIN
    SELECT a.actor_type, a.actor_id INTO v_actor_type, v_actor_id
      FROM private.current_actor() a;
    NEW.started_at      := now();
    NEW.started_by_type := v_actor_type;
    NEW.started_by_id   := v_actor_id;
    NEW.ended_at        := NULL;
    NEW.ended_by_type   := NULL;
    NEW.ended_by_id     := NULL;
    RETURN NEW;
END;
$$;

-- E2) Al parar: solo se puede escribir ended_at, una sola vez.
CREATE OR REPLACE FUNCTION private.night_before_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    c_mutable CONSTANT text[] := ARRAY['ended_at', 'ended_by_type', 'ended_by_id', 'updated_at'];
    v_actor_type text;
    v_actor_id   uuid;
BEGIN
    IF OLD.ended_at IS NOT NULL THEN
        RAISE EXCEPTION 'La noche ya esta cerrada: inicia una nueva'
            USING ERRCODE = 'check_violation';
    END IF;
    IF (to_jsonb(NEW) - c_mutable) IS DISTINCT FROM (to_jsonb(OLD) - c_mutable) THEN
        RAISE EXCEPTION 'De una noche solo se puede registrar el cierre'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.ended_at IS NOT NULL THEN
        SELECT a.actor_type, a.actor_id INTO v_actor_type, v_actor_id
          FROM private.current_actor() a;
        NEW.ended_at      := now();
        NEW.ended_by_type := v_actor_type;
        NEW.ended_by_id   := v_actor_id;
    END IF;
    RETURN NEW;
END;
$$;

-- E3) Despues de iniciar o parar: foto del stock de todas las ubicaciones,
--     cierre de turnos y auditoria. SECURITY DEFINER: el panel no puede
--     escribir night_stock_snapshots, cash_shifts ni audit_log.
CREATE OR REPLACE FUNCTION private.night_after_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.night_stock_snapshots (club_id, night_id, location_id, product_id, kind, quantity)
        SELECT b.club_id, NEW.id, b.location_id, b.product_id, 'opening', b.quantity
          FROM public.inventory_balances b
          JOIN public.inventory_locations l ON l.id = b.location_id AND l.club_id = b.club_id
         WHERE b.club_id = NEW.club_id
           AND l.deleted_at IS NULL;
        IF NEW.started_by_id IS NOT NULL THEN
            INSERT INTO public.audit_log (club_id, actor_type, actor_id, action, entity_type, entity_id)
            VALUES (NEW.club_id, NEW.started_by_type, NEW.started_by_id, 'night.started', 'night', NEW.id);
        END IF;
    ELSIF OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL THEN
        INSERT INTO public.night_stock_snapshots (club_id, night_id, location_id, product_id, kind, quantity)
        SELECT b.club_id, NEW.id, b.location_id, b.product_id, 'closing', b.quantity
          FROM public.inventory_balances b
          JOIN public.inventory_locations l ON l.id = b.location_id AND l.club_id = b.club_id
         WHERE b.club_id = NEW.club_id
           AND l.deleted_at IS NULL;
        -- Todas las operaciones se cierran: los turnos de caja abiertos.
        UPDATE public.cash_shifts s
           SET closed_at = GREATEST(NEW.ended_at, s.opened_at)
         WHERE s.club_id = NEW.club_id
           AND s.closed_at IS NULL;
        IF NEW.ended_by_id IS NOT NULL THEN
            INSERT INTO public.audit_log (club_id, actor_type, actor_id, action, entity_type, entity_id)
            VALUES (NEW.club_id, NEW.ended_by_type, NEW.ended_by_id, 'night.ended', 'night', NEW.id);
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_club_nights_before_insert
    BEFORE INSERT ON public.club_nights
    FOR EACH ROW EXECUTE FUNCTION private.night_before_insert();
CREATE TRIGGER trg_club_nights_before_update
    BEFORE UPDATE ON public.club_nights
    FOR EACH ROW EXECUTE FUNCTION private.night_before_update();
CREATE TRIGGER trg_club_nights_after_change
    AFTER INSERT OR UPDATE ON public.club_nights
    FOR EACH ROW EXECUTE FUNCTION private.night_after_change();
CREATE TRIGGER trg_club_nights_club_fixed
    BEFORE UPDATE OF club_id ON public.club_nights
    FOR EACH ROW EXECUTE FUNCTION private.forbid_club_change();
CREATE TRIGGER trg_club_nights_updated_at
    BEFORE UPDATE ON public.club_nights
    FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_club_nights_no_delete
    BEFORE DELETE ON public.club_nights
    FOR EACH ROW EXECUTE FUNCTION private.forbid_update_delete();

-- E4) Cambio: solo con la noche abierta, firmado con quien lo cargo.
CREATE OR REPLACE FUNCTION private.cash_float_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_actor_type text;
    v_actor_id   uuid;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.club_nights n
                    WHERE n.id = NEW.night_id AND n.club_id = NEW.club_id
                      AND n.ended_at IS NULL) THEN
        RAISE EXCEPTION 'La noche no esta abierta: el cambio se carga con la noche iniciada'
            USING ERRCODE = 'check_violation';
    END IF;
    SELECT a.actor_type, a.actor_id INTO v_actor_type, v_actor_id
      FROM private.current_actor() a;
    NEW.actor_type := v_actor_type;
    NEW.actor_id   := v_actor_id;
    NEW.created_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cash_register_floats_before_insert
    BEFORE INSERT ON public.cash_register_floats
    FOR EACH ROW EXECUTE FUNCTION private.cash_float_before_insert();
CREATE TRIGGER trg_cash_register_floats_append_only
    BEFORE UPDATE OR DELETE ON public.cash_register_floats
    FOR EACH ROW EXECUTE FUNCTION private.forbid_update_delete();
CREATE TRIGGER trg_night_stock_snapshots_append_only
    BEFORE UPDATE OR DELETE ON public.night_stock_snapshots
    FOR EACH ROW EXECUTE FUNCTION private.forbid_update_delete();


-- =====================================================================
-- F) VISTAS PARA LA SECCION VENTAS
-- =====================================================================

-- F1) Lista de ventas: cajero, caja, metodos (en orden), monto por metodo,
--     estado de retiro y si quedo fuera de una noche abierta.
CREATE VIEW public.v_sales_list
WITH (security_invoker = true) AS
SELECT s.id,
       s.club_id,
       s.night_id,
       s.ticket_number,
       s.total,
       s.status,
       s.created_at_device,
       s.received_at,
       s.delivered_at,
       s.cash_register_id,
       cr.name                                     AS cash_register_name,
       s.cashier_user_id,
       cu.full_name                                AS cashier_name,
       du.full_name                                AS delivered_by_name,
       COALESCE(p.methods, ARRAY[]::text[])        AS payment_methods,
       COALESCE(cardinality(p.methods), 0) > 1     AS is_mixed,
       COALESCE(p.cash_amount, 0)                  AS cash_amount,
       COALESCE(p.pix_amount, 0)                   AS pix_amount,
       COALESCE(p.transfer_amount, 0)              AS transfer_amount,
       COALESCE(p.paid_total, 0)                   AS paid_total,
       (s.night_id IS NULL OR COALESCE(s.created_at_device > n.ended_at, false)) AS outside_night
  FROM public.sales s
  JOIN public.cash_registers cr ON cr.id = s.cash_register_id AND cr.club_id = s.club_id
  JOIN public.users cu          ON cu.id = s.cashier_user_id  AND cu.club_id = s.club_id
  LEFT JOIN public.users du     ON du.id = s.delivered_by_user_id AND du.club_id = s.club_id
  LEFT JOIN public.club_nights n ON n.id = s.night_id AND n.club_id = s.club_id
  LEFT JOIN LATERAL (
        SELECT array_agg(x.method ORDER BY x.sort_order)          AS methods,
               sum(x.amount) FILTER (WHERE x.method = 'cash')     AS cash_amount,
               sum(x.amount) FILTER (WHERE x.method = 'pix')      AS pix_amount,
               sum(x.amount) FILTER (WHERE x.method = 'transfer') AS transfer_amount,
               sum(x.amount)                                      AS paid_total
          FROM (SELECT sp.method, pm.sort_order, sum(sp.amount) AS amount
                  FROM public.sale_payments sp
                  JOIN public.payment_methods pm ON pm.code = sp.method
                 WHERE sp.sale_id = s.id AND sp.club_id = s.club_id
                 GROUP BY sp.method, pm.sort_order) x
       ) p ON true;
COMMENT ON VIEW public.v_sales_list IS 'Ventas para el panel: cajero, caja, metodos, monto por metodo, retiro y si quedo fuera de noche.';

-- F2) Resumen de cada noche por caja. Efectivo esperado = cambio + ventas
--     en efectivo. Una caja aparece si esta activa o si tuvo movimiento.
CREATE VIEW public.v_night_register_summary
WITH (security_invoker = true) AS
WITH f AS (
    SELECT cf.night_id, cf.cash_register_id,
           COALESCE(sum(cf.amount) FILTER (WHERE cf.kind = 'opening'), 0) AS opening_float,
           COALESCE(sum(cf.amount) FILTER (WHERE cf.kind <> 'opening'), 0) AS added_float
      FROM public.cash_register_floats cf
     GROUP BY cf.night_id, cf.cash_register_id
),
v AS (
    SELECT s.night_id, s.cash_register_id,
           count(*)                                          AS tickets,
           sum(s.total)                                      AS sales_total
      FROM public.sales s
     WHERE s.night_id IS NOT NULL
     GROUP BY s.night_id, s.cash_register_id
),
pay AS (
    SELECT s.night_id, s.cash_register_id,
           COALESCE(sum(sp.amount) FILTER (WHERE sp.method = 'cash'), 0)     AS cash_sales,
           COALESCE(sum(sp.amount) FILTER (WHERE sp.method = 'pix'), 0)      AS pix_sales,
           COALESCE(sum(sp.amount) FILTER (WHERE sp.method = 'transfer'), 0) AS transfer_sales,
           COALESCE(sum(sp.amount) FILTER (WHERE sp.method NOT IN ('cash', 'pix', 'transfer')), 0) AS other_sales
      FROM public.sales s
      JOIN public.sale_payments sp ON sp.sale_id = s.id AND sp.club_id = s.club_id
     WHERE s.night_id IS NOT NULL
     GROUP BY s.night_id, s.cash_register_id
)
SELECT n.id                                              AS night_id,
       n.club_id,
       cr.id                                             AS cash_register_id,
       cr.name                                           AS cash_register_name,
       COALESCE(f.opening_float, 0)                      AS opening_float,
       COALESCE(f.added_float, 0)                        AS added_float,
       COALESCE(f.opening_float, 0) + COALESCE(f.added_float, 0) AS float_total,
       COALESCE(v.tickets, 0)                            AS tickets,
       COALESCE(v.sales_total, 0)                        AS sales_total,
       COALESCE(pay.cash_sales, 0)                       AS cash_sales,
       COALESCE(pay.pix_sales, 0)                        AS pix_sales,
       COALESCE(pay.transfer_sales, 0)                   AS transfer_sales,
       COALESCE(pay.other_sales, 0)                      AS other_sales,
       COALESCE(f.opening_float, 0) + COALESCE(f.added_float, 0) + COALESCE(pay.cash_sales, 0) AS expected_cash
  FROM public.club_nights n
  JOIN public.cash_registers cr ON cr.club_id = n.club_id
  LEFT JOIN f   ON f.night_id = n.id   AND f.cash_register_id = cr.id
  LEFT JOIN v   ON v.night_id = n.id   AND v.cash_register_id = cr.id
  LEFT JOIN pay ON pay.night_id = n.id AND pay.cash_register_id = cr.id
 WHERE (cr.deleted_at IS NULL AND cr.active) OR f.night_id IS NOT NULL OR v.night_id IS NOT NULL;
COMMENT ON VIEW public.v_night_register_summary IS 'Por noche y caja: cambio, ventas por metodo y efectivo esperado (cambio + ventas en efectivo).';

-- F3) Stock de la noche: foto de apertura, lo vendido y foto de cierre.
CREATE VIEW public.v_night_stock_summary
WITH (security_invoker = true) AS
SELECT o.night_id,
       o.club_id,
       o.location_id,
       l.name             AS location_name,
       l.kind             AS location_kind,
       o.product_id,
       p.name             AS product_name,
       o.quantity         AS opening_quantity,
       c.quantity         AS closing_quantity,
       COALESCE((SELECT -sum(m.quantity)
                   FROM public.inventory_movements m
                   JOIN public.sale_items si ON si.id = m.sale_item_id AND si.club_id = m.club_id
                   JOIN public.sales s       ON s.id = si.sale_id AND s.club_id = si.club_id
                  WHERE m.movement_type = 'sale'
                    AND m.location_id = o.location_id
                    AND m.product_id  = o.product_id
                    AND s.night_id    = o.night_id), 0) AS sold_quantity
  FROM public.night_stock_snapshots o
  JOIN public.inventory_locations l ON l.id = o.location_id AND l.club_id = o.club_id
  JOIN public.products p            ON p.id = o.product_id  AND p.club_id = o.club_id
  LEFT JOIN public.night_stock_snapshots c
         ON c.night_id = o.night_id AND c.kind = 'closing'
        AND c.location_id = o.location_id AND c.product_id = o.product_id
 WHERE o.kind = 'opening';
COMMENT ON VIEW public.v_night_stock_summary IS 'Por noche, ubicacion y producto: stock al iniciar, vendido en la noche y stock al parar.';

-- F4) Control: ventas sin noche o hechas despues de parar (sin conexion).
CREATE VIEW public.v_sales_outside_night
WITH (security_invoker = true) AS
SELECT sl.id AS sale_id, sl.club_id, sl.night_id, sl.ticket_number, sl.total,
       sl.cash_register_name, sl.cashier_name, sl.created_at_device, sl.received_at
  FROM public.v_sales_list sl
 WHERE sl.outside_night;
COMMENT ON VIEW public.v_sales_outside_night IS 'Ventas sin noche o posteriores a su cierre (posnet sin conexion). Se aceptan y se revisan.';


-- =====================================================================
-- G) SEGURIDAD: RLS y permisos (mismo patron que 08)
-- =====================================================================
ALTER TABLE public.club_nights           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.night_stock_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_register_floats  ENABLE ROW LEVEL SECURITY;

CREATE POLICY club_nights_select ON public.club_nights
    FOR SELECT TO authenticated USING (club_id IN (SELECT private.visible_club_ids()));
CREATE POLICY club_nights_insert ON public.club_nights
    FOR INSERT TO authenticated WITH CHECK (club_id IN (SELECT private.visible_club_ids()));
CREATE POLICY club_nights_update ON public.club_nights
    FOR UPDATE TO authenticated
    USING      (club_id IN (SELECT private.visible_club_ids()))
    WITH CHECK (club_id IN (SELECT private.visible_club_ids()));

CREATE POLICY night_stock_snapshots_select ON public.night_stock_snapshots
    FOR SELECT TO authenticated USING (club_id IN (SELECT private.visible_club_ids()));

CREATE POLICY cash_register_floats_select ON public.cash_register_floats
    FOR SELECT TO authenticated USING (club_id IN (SELECT private.visible_club_ids()));
CREATE POLICY cash_register_floats_insert ON public.cash_register_floats
    FOR INSERT TO authenticated WITH CHECK (club_id IN (SELECT private.visible_club_ids()));

DO $$
DECLARE
    r text;
BEGIN
    FOREACH r IN ARRAY ARRAY[
        'club_nights', 'night_stock_snapshots', 'cash_register_floats',
        'v_sales_list', 'v_night_register_summary', 'v_night_stock_summary', 'v_sales_outside_night']
    LOOP
        EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', r);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', r);
        EXECUTE format('GRANT SELECT ON public.%I TO authenticated', r);
    END LOOP;
END;
$$;

-- Iniciar: solo club_id (hora y autor los pone el trigger). Parar: ended_at.
GRANT INSERT (club_id)  ON public.club_nights TO authenticated;
GRANT UPDATE (ended_at) ON public.club_nights TO authenticated;
GRANT INSERT (club_id, night_id, cash_register_id, kind, amount, note)
    ON public.cash_register_floats TO authenticated;

REVOKE EXECUTE ON FUNCTION
    private.night_before_insert(),
    private.night_before_update(),
    private.night_after_change(),
    private.cash_float_before_insert()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
    private.night_before_insert(),
    private.night_before_update(),
    private.night_after_change(),
    private.cash_float_before_insert()
TO service_role;


-- =====================================================================
-- H) PUBLICACIONES
--   powersync         : el posnet necesita saber si hay noche abierta.
--   supabase_realtime : el panel ve las ventas y los retiros en vivo
--                       (Realtime respeta RLS: cada uno ve su club).
-- Si la publicacion todavia no existe (09 sin ejecutar), no se toca:
-- el 09 agrega club_nights al crearla.
-- =====================================================================
DO $$
DECLARE
    t text;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync')
       AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                        WHERE pubname = 'powersync' AND schemaname = 'public' AND tablename = 'club_nights') THEN
        ALTER PUBLICATION powersync ADD TABLE public.club_nights;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime' AND NOT puballtables) THEN
        FOREACH t IN ARRAY ARRAY['sales', 'sale_payments', 'club_nights', 'cash_register_floats'] LOOP
            IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
                EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
            END IF;
        END LOOP;
    END IF;
END;
$$;

COMMIT;
