-- =====================================================================
-- ONTICKET - 16: PRECIO DE UN PRODUCTO POR BARRA
-- Requiere: 01 a 15
--
-- Un producto tiene su precio general (products.price) y, opcionalmente,
-- un precio distinto en una barra: por ejemplo Corona a 7000 en la barra
-- VIP. Toda caja vinculada a esa barra (cash_registers.inventory_location_id)
-- cobra ese precio; sin precio de barra se usa el general.
--
--   precio que cobra una caja = COALESCE(precio de su barra, products.price)
--
-- Decision del duenio del proyecto: precio POR BARRA (no por caja ni con
-- listas de precios). El posnet lo resuelve con estas dos tablas, que le
-- llegan por PowerSync, y guarda el precio cobrado en sale_items
-- (regla 7): cambiar o quitar un precio de barra no toca ventas pasadas.
--
-- Una fila por producto y barra. Cambiar el precio = update de price;
-- quitarlo = borrar la fila (vuelve el precio general). Todo se audita.
-- Cuando los combos sean productos (etapa 2), esta tabla les sirve igual.
-- =====================================================================
BEGIN;

CREATE TABLE public.product_location_prices (
    id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id      uuid          NOT NULL REFERENCES public.clubs (id),
    product_id   uuid          NOT NULL,
    location_id  uuid          NOT NULL,
    price        numeric(12,2) NOT NULL,
    created_at   timestamptz   NOT NULL DEFAULT now(),
    updated_at   timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT product_location_prices_price_check CHECK (price >= 0),
    CONSTRAINT product_location_prices_one_per_bar UNIQUE (product_id, location_id),
    CONSTRAINT product_location_prices_id_club_unique UNIQUE (id, club_id),
    CONSTRAINT product_location_prices_product_fk
        FOREIGN KEY (product_id, club_id) REFERENCES public.products (id, club_id),
    CONSTRAINT product_location_prices_location_fk
        FOREIGN KEY (location_id, club_id) REFERENCES public.inventory_locations (id, club_id)
);
COMMENT ON TABLE public.product_location_prices IS
    'Precio de un producto en una barra. Sin fila, la barra cobra products.price. Una por producto y barra.';

CREATE INDEX idx_product_location_prices_club     ON public.product_location_prices (club_id);
CREATE INDEX idx_product_location_prices_product  ON public.product_location_prices (product_id, club_id);
CREATE INDEX idx_product_location_prices_location ON public.product_location_prices (location_id, club_id);


-- ---------------------------------------------------------------------
-- Reglas
-- ---------------------------------------------------------------------
-- Solo en una barra vigente (un deposito no vende) y el producto no
-- cambia de barra ni de producto: para otro, otra fila.
CREATE OR REPLACE FUNCTION private.product_location_price_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND (NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.location_id IS DISTINCT FROM OLD.location_id) THEN
        RAISE EXCEPTION 'El precio no cambia de producto ni de barra' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.inventory_locations l
                    WHERE l.id = NEW.location_id AND l.club_id = NEW.club_id
                      AND l.kind = 'bar' AND l.deleted_at IS NULL) THEN
        RAISE EXCEPTION 'El precio especial solo se asigna a una barra' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

-- Corre despues de club_fixed (orden alfabetico): mover de club da ese error.
CREATE TRIGGER trg_product_location_prices_validate
    BEFORE INSERT OR UPDATE ON public.product_location_prices
    FOR EACH ROW EXECUTE FUNCTION private.product_location_price_check();
CREATE TRIGGER trg_product_location_prices_club_fixed
    BEFORE UPDATE OF club_id ON public.product_location_prices
    FOR EACH ROW EXECUTE FUNCTION private.forbid_club_change();
CREATE TRIGGER trg_product_location_prices_updated_at
    BEFORE UPDATE ON public.product_location_prices
    FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- Auditoria: asignar, cambiar y quitar, con el precio anterior y el nuevo.
-- SECURITY DEFINER: el panel no escribe en audit_log.
CREATE OR REPLACE FUNCTION private.product_location_price_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_type text;
    v_actor_id   uuid;
    v_row        public.product_location_prices;
BEGIN
    SELECT a.actor_type, a.actor_id INTO v_actor_type, v_actor_id FROM private.current_actor() a;
    IF v_actor_id IS NULL THEN
        RETURN NULL;
    END IF;
    v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

    INSERT INTO public.audit_log (club_id, actor_type, actor_id, action, entity_type, entity_id, details)
    VALUES (
        v_row.club_id, v_actor_type, v_actor_id,
        CASE TG_OP WHEN 'INSERT' THEN 'product_price.bar_set'
                   WHEN 'UPDATE' THEN 'product_price.bar_changed'
                   ELSE 'product_price.bar_removed' END,
        'product', v_row.product_id,
        jsonb_build_object(
            'location_id', v_row.location_id,
            'old_price',   CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.price END,
            'new_price',   CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.price END)
    );
    RETURN NULL;
END;
$$;
CREATE TRIGGER trg_product_location_prices_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.product_location_prices
    FOR EACH ROW EXECUTE FUNCTION private.product_location_price_audit();


-- ---------------------------------------------------------------------
-- Vista: precio efectivo de cada producto en cada caja (lo que cobra).
-- Para el panel y para documentar la regla que aplica el posnet.
-- ---------------------------------------------------------------------
CREATE VIEW public.v_register_product_prices
WITH (security_invoker = true) AS
SELECT cr.club_id,
       cr.id                         AS cash_register_id,
       cr.name                       AS cash_register_name,
       cr.inventory_location_id      AS location_id,
       p.id                          AS product_id,
       p.name                        AS product_name,
       p.price                       AS base_price,
       plp.price                     AS bar_price,
       COALESCE(plp.price, p.price)  AS effective_price
  FROM public.cash_registers cr
  JOIN public.products p
    ON p.club_id = cr.club_id AND p.deleted_at IS NULL
  LEFT JOIN public.product_location_prices plp
    ON plp.product_id = p.id AND plp.location_id = cr.inventory_location_id AND plp.club_id = cr.club_id
 WHERE cr.deleted_at IS NULL;
COMMENT ON VIEW public.v_register_product_prices IS
    'Por caja y producto: precio general, precio de su barra y el que se cobra (el de la barra si hay).';


-- ---------------------------------------------------------------------
-- Seguridad (mismo patron que 08 y 15)
-- ---------------------------------------------------------------------
ALTER TABLE public.product_location_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_location_prices_select ON public.product_location_prices
    FOR SELECT TO authenticated USING (club_id IN (SELECT private.visible_club_ids()));
CREATE POLICY product_location_prices_insert ON public.product_location_prices
    FOR INSERT TO authenticated WITH CHECK (club_id IN (SELECT private.visible_club_ids()));
CREATE POLICY product_location_prices_update ON public.product_location_prices
    FOR UPDATE TO authenticated
    USING      (club_id IN (SELECT private.visible_club_ids()))
    WITH CHECK (club_id IN (SELECT private.visible_club_ids()));
CREATE POLICY product_location_prices_delete ON public.product_location_prices
    FOR DELETE TO authenticated USING (club_id IN (SELECT private.visible_club_ids()));

REVOKE ALL ON public.product_location_prices   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_register_product_prices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_location_prices TO service_role;
GRANT SELECT ON public.v_register_product_prices TO service_role, authenticated;
GRANT SELECT, DELETE ON public.product_location_prices TO authenticated;
GRANT INSERT (club_id, product_id, location_id, price) ON public.product_location_prices TO authenticated;
GRANT UPDATE (price) ON public.product_location_prices TO authenticated;

REVOKE EXECUTE ON FUNCTION private.product_location_price_check() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.product_location_price_audit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.product_location_price_check() TO service_role;
GRANT EXECUTE ON FUNCTION private.product_location_price_audit() TO service_role;

-- El posnet necesita el precio de su barra para cobrar sin conexion.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync')
       AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                        WHERE pubname = 'powersync' AND schemaname = 'public'
                          AND tablename = 'product_location_prices') THEN
        ALTER PUBLICATION powersync ADD TABLE public.product_location_prices;
    END IF;
END;
$$;

COMMIT;
