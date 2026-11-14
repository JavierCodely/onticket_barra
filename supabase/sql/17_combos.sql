-- =====================================================================
-- ONTICKET - 17: COMBOS
-- Requiere: 01 a 16
--
-- Un combo es un PRODUCTO con kind = 'combo' (asi tiene foto, categoria,
-- activo/inactivo y precio por barra, archivo 16, sin repetir nada).
-- Su composicion va en combo_items: que producto, cuantas unidades y a que
-- precio individual se vende dentro del combo.
--
--   precio del combo = suma (cantidad x precio individual en el combo)
--   costo del combo  = suma (cantidad x costo actual del producto)
--
-- Los dos los mantiene la base: nadie los escribe a mano. Un cambio de
-- costo de un producto actualiza el costo de los combos que lo usan.
-- El precio por barra de un combo es un solo precio (archivo 16).
--
-- STOCK (regla 10): un combo no tiene stock propio. Al venderse:
--   - se guarda la FOTO de su composicion en sale_item_components;
--   - se descuenta cada producto que lo compone en la ubicacion de la caja.
-- SUSTITUCION (regla 20): en un combo se sustituye un PRODUCTO del combo
-- (component_product_id). Lo vendido es ese producto a su precio
-- individual en el combo; lo entregado, el sustituto.
--
-- Decisiones del duenio del proyecto: precio propio, precio por barra,
-- foto y categoria, activar/desactivar, y precio individual por producto.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- A) products.kind: 'product' (con stock) o 'combo' (sin stock propio)
-- ---------------------------------------------------------------------
ALTER TABLE public.products
    ADD COLUMN kind text NOT NULL DEFAULT 'product',
    ADD CONSTRAINT products_kind_check CHECK (kind IN ('product', 'combo'));
COMMENT ON COLUMN public.products.kind IS
    'product: tiene stock. combo: agrupa productos (combo_items), sin stock propio. No cambia.';

CREATE OR REPLACE FUNCTION private.product_kind_fixed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.kind IS DISTINCT FROM OLD.kind THEN
        RAISE EXCEPTION 'Un producto no se convierte en combo ni al reves' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_products_kind_fixed
    BEFORE UPDATE OF kind ON public.products
    FOR EACH ROW EXECUTE FUNCTION private.product_kind_fixed();


-- ---------------------------------------------------------------------
-- B) COMBO_ITEMS: composicion de cada combo
-- ---------------------------------------------------------------------
CREATE TABLE public.combo_items (
    id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id     uuid          NOT NULL REFERENCES public.clubs (id),
    combo_id    uuid          NOT NULL,
    product_id  uuid          NOT NULL,
    quantity    integer       NOT NULL,
    unit_price  numeric(12,2) NOT NULL,      -- precio individual dentro del combo
    created_at  timestamptz   NOT NULL DEFAULT now(),
    updated_at  timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT combo_items_quantity_check   CHECK (quantity > 0 AND quantity <= 1000),
    CONSTRAINT combo_items_unit_price_check CHECK (unit_price >= 0),
    CONSTRAINT combo_items_not_itself       CHECK (combo_id <> product_id),
    CONSTRAINT combo_items_one_per_product  UNIQUE (combo_id, product_id),
    CONSTRAINT combo_items_id_club_unique   UNIQUE (id, club_id),
    CONSTRAINT combo_items_combo_fk
        FOREIGN KEY (combo_id, club_id) REFERENCES public.products (id, club_id),
    CONSTRAINT combo_items_product_fk
        FOREIGN KEY (product_id, club_id) REFERENCES public.products (id, club_id)
);
COMMENT ON TABLE public.combo_items IS
    'Productos de cada combo: cantidad y precio individual dentro del combo. Uno por producto y combo.';

CREATE INDEX idx_combo_items_club    ON public.combo_items (club_id);
CREATE INDEX idx_combo_items_combo   ON public.combo_items (combo_id, club_id);
CREATE INDEX idx_combo_items_product ON public.combo_items (product_id, club_id);

-- El combo es un combo; lo que lleva, productos (sin combos dentro de
-- combos). Ni el combo ni el producto cambian: para otro, otra fila.
CREATE OR REPLACE FUNCTION private.combo_item_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND (NEW.combo_id IS DISTINCT FROM OLD.combo_id OR NEW.product_id IS DISTINCT FROM OLD.product_id) THEN
        RAISE EXCEPTION 'Una linea del combo no cambia de combo ni de producto' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.products p
                    WHERE p.id = NEW.combo_id AND p.club_id = NEW.club_id
                      AND p.kind = 'combo' AND p.deleted_at IS NULL) THEN
        RAISE EXCEPTION 'Solo un combo lleva productos' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.products p
                    WHERE p.id = NEW.product_id AND p.club_id = NEW.club_id
                      AND p.kind = 'product' AND p.deleted_at IS NULL) THEN
        RAISE EXCEPTION 'Un combo lleva productos, no otros combos' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

-- Corre despues de club_fixed (orden alfabetico).
CREATE TRIGGER trg_combo_items_validate
    BEFORE INSERT OR UPDATE ON public.combo_items
    FOR EACH ROW EXECUTE FUNCTION private.combo_item_check();
CREATE TRIGGER trg_combo_items_club_fixed
    BEFORE UPDATE OF club_id ON public.combo_items
    FOR EACH ROW EXECUTE FUNCTION private.forbid_club_change();
CREATE TRIGGER trg_combo_items_updated_at
    BEFORE UPDATE ON public.combo_items
    FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


-- ---------------------------------------------------------------------
-- C) Precio y costo del combo = suma de sus productos
-- ---------------------------------------------------------------------
-- Nadie escribe el precio ni el costo de un combo: tienen que coincidir
-- con la suma (un combo nuevo, sin productos, vale 0). La cuenta va dentro
-- de cada trigger (sin funciones auxiliares: el panel no las ejecuta).
CREATE OR REPLACE FUNCTION private.combo_price_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_price numeric;
    v_cost  numeric;
BEGIN
    IF NEW.kind <> 'combo' THEN
        RETURN NEW;
    END IF;
    SELECT COALESCE(sum(ci.quantity * ci.unit_price), 0), COALESCE(sum(ci.quantity * p.cost), 0)
      INTO v_price, v_cost
      FROM public.combo_items ci
      JOIN public.products p ON p.id = ci.product_id AND p.club_id = ci.club_id
     WHERE ci.combo_id = NEW.id AND ci.club_id = NEW.club_id;
    IF NEW.price <> v_price OR NEW.cost <> v_cost THEN
        RAISE EXCEPTION 'El precio y el costo de un combo son la suma de sus productos (precio %, costo %)', v_price, v_cost
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_products_combo_price_guard
    BEFORE INSERT OR UPDATE OF price, cost ON public.products
    FOR EACH ROW EXECUTE FUNCTION private.combo_price_guard();

-- Cambia la composicion -> se recalcula el combo.
CREATE OR REPLACE FUNCTION private.combo_items_after_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_row public.combo_items;
BEGIN
    v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    UPDATE public.products c
       SET price = t.price, cost = t.cost
      FROM (SELECT COALESCE(sum(ci.quantity * ci.unit_price), 0) AS price,
                   COALESCE(sum(ci.quantity * p.cost), 0)        AS cost
              FROM public.combo_items ci
              JOIN public.products p ON p.id = ci.product_id AND p.club_id = ci.club_id
             WHERE ci.combo_id = v_row.combo_id AND ci.club_id = v_row.club_id) t
     WHERE c.id = v_row.combo_id AND c.club_id = v_row.club_id
       AND (c.price <> t.price OR c.cost <> t.cost);
    RETURN NULL;
END;
$$;
CREATE TRIGGER trg_combo_items_recalc
    AFTER INSERT OR UPDATE OR DELETE ON public.combo_items
    FOR EACH ROW EXECUTE FUNCTION private.combo_items_after_change();

-- Cambia el costo de un producto -> cambia el costo de sus combos.
CREATE OR REPLACE FUNCTION private.product_cost_to_combos()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.kind = 'product' AND NEW.cost IS DISTINCT FROM OLD.cost THEN
        UPDATE public.products c
           SET cost = t.cost
          FROM (SELECT ci.combo_id, COALESCE(sum(ci.quantity * p.cost), 0) AS cost
                  FROM public.combo_items ci
                  JOIN public.products p ON p.id = ci.product_id AND p.club_id = ci.club_id
                 WHERE ci.club_id = NEW.club_id
                   AND ci.combo_id IN (SELECT x.combo_id FROM public.combo_items x
                                        WHERE x.product_id = NEW.id AND x.club_id = NEW.club_id)
                 GROUP BY ci.combo_id) t
         WHERE c.id = t.combo_id AND c.club_id = NEW.club_id AND c.cost <> t.cost;
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER trg_products_cost_to_combos
    AFTER UPDATE OF cost ON public.products
    FOR EACH ROW EXECUTE FUNCTION private.product_cost_to_combos();

-- Auditoria de la composicion. SECURITY DEFINER: el panel no escribe en
-- audit_log.
CREATE OR REPLACE FUNCTION private.combo_item_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_type text;
    v_actor_id   uuid;
    v_row        public.combo_items;
BEGIN
    SELECT a.actor_type, a.actor_id INTO v_actor_type, v_actor_id FROM private.current_actor() a;
    IF v_actor_id IS NULL THEN
        RETURN NULL;
    END IF;
    v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    INSERT INTO public.audit_log (club_id, actor_type, actor_id, action, entity_type, entity_id, details)
    VALUES (
        v_row.club_id, v_actor_type, v_actor_id,
        CASE TG_OP WHEN 'INSERT' THEN 'combo.item_added'
                   WHEN 'UPDATE' THEN 'combo.item_changed'
                   ELSE 'combo.item_removed' END,
        'product', v_row.combo_id,
        jsonb_build_object(
            'product_id',     v_row.product_id,
            'old_quantity',   CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.quantity END,
            'new_quantity',   CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.quantity END,
            'old_unit_price', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.unit_price END,
            'new_unit_price', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.unit_price END)
    );
    RETURN NULL;
END;
$$;
CREATE TRIGGER trg_combo_items_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.combo_items
    FOR EACH ROW EXECUTE FUNCTION private.combo_item_audit();


-- ---------------------------------------------------------------------
-- D) Stock: un combo no tiene stock propio
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.movement_not_on_combo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.products p
                WHERE p.id = NEW.product_id AND p.club_id = NEW.club_id AND p.kind = 'combo') THEN
        RAISE EXCEPTION 'Un combo no tiene stock propio: se mueve el stock de sus productos'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_inventory_movements_not_combo
    BEFORE INSERT ON public.inventory_movements
    FOR EACH ROW EXECUTE FUNCTION private.movement_not_on_combo();


-- ---------------------------------------------------------------------
-- E) SALE_ITEM_COMPONENTS: foto de la composicion al vender un combo.
--    La toma un trigger; solo agregar. Sirve para el stock, la
--    sustitucion y los reportes por producto, aunque el combo cambie.
-- ---------------------------------------------------------------------
CREATE TABLE public.sale_item_components (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id       uuid          NOT NULL REFERENCES public.clubs (id),
    sale_item_id  uuid          NOT NULL,
    product_id    uuid          NOT NULL,
    product_name  text          NOT NULL,
    quantity      integer       NOT NULL,          -- por cada combo vendido
    unit_price    numeric(12,2) NOT NULL,          -- precio individual en el combo
    unit_cost     numeric(12,2) NOT NULL,
    created_at    timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT sale_item_components_quantity_check CHECK (quantity > 0),
    CONSTRAINT sale_item_components_one_per_product UNIQUE (sale_item_id, product_id),
    CONSTRAINT sale_item_components_id_club_unique UNIQUE (id, club_id),
    CONSTRAINT sale_item_components_sale_item_fk
        FOREIGN KEY (sale_item_id, club_id) REFERENCES public.sale_items (id, club_id),
    CONSTRAINT sale_item_components_product_fk
        FOREIGN KEY (product_id, club_id) REFERENCES public.products (id, club_id)
);
COMMENT ON TABLE public.sale_item_components IS
    'Foto de la composicion de un combo al venderlo. Solo agregar; la toma un trigger.';

CREATE INDEX idx_sale_item_components_club      ON public.sale_item_components (club_id);
CREATE INDEX idx_sale_item_components_sale_item ON public.sale_item_components (sale_item_id, club_id);
CREATE INDEX idx_sale_item_components_product   ON public.sale_item_components (product_id, club_id);

CREATE TRIGGER trg_sale_item_components_append_only
    BEFORE UPDATE OR DELETE ON public.sale_item_components
    FOR EACH ROW EXECUTE FUNCTION private.forbid_update_delete();

-- Un movimiento de venta por item Y producto (un combo mueve varios).
DROP INDEX IF EXISTS public.uq_inventory_movements_sale_item;
CREATE UNIQUE INDEX uq_inventory_movements_sale_item_product
    ON public.inventory_movements (sale_item_id, product_id) WHERE movement_type = 'sale';

-- Reemplaza la del archivo 06: cada item descuenta stock en la ubicacion
-- de su caja; un combo, cada uno de sus productos.
CREATE OR REPLACE FUNCTION private.sale_item_creates_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_location uuid;
    v_at       timestamptz;
    v_kind     text;
BEGIN
    SELECT cr.inventory_location_id, s.created_at_device INTO v_location, v_at
      FROM public.sales s
      JOIN public.cash_registers cr
        ON cr.id = s.cash_register_id AND cr.club_id = s.club_id
     WHERE s.id = NEW.sale_id
       AND s.club_id = NEW.club_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'La venta % todavia no existe', NEW.sale_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    SELECT p.kind INTO v_kind FROM public.products p WHERE p.id = NEW.product_id AND p.club_id = NEW.club_id;

    IF v_kind = 'combo' THEN
        INSERT INTO public.sale_item_components
            (club_id, sale_item_id, product_id, product_name, quantity, unit_price, unit_cost)
        SELECT NEW.club_id, NEW.id, ci.product_id, p.name, ci.quantity, ci.unit_price, p.cost
          FROM public.combo_items ci
          JOIN public.products p ON p.id = ci.product_id AND p.club_id = ci.club_id
         WHERE ci.combo_id = NEW.product_id AND ci.club_id = NEW.club_id;

        INSERT INTO public.inventory_movements
            (club_id, location_id, product_id, movement_type, quantity, sale_item_id, occurred_at)
        SELECT NEW.club_id, v_location, c.product_id, 'sale', -(NEW.quantity * c.quantity), NEW.id, v_at
          FROM public.sale_item_components c
         WHERE c.sale_item_id = NEW.id AND c.club_id = NEW.club_id;
    ELSE
        INSERT INTO public.inventory_movements
            (club_id, location_id, product_id, movement_type, quantity, sale_item_id, occurred_at)
        VALUES (NEW.club_id, v_location, NEW.product_id, 'sale', -NEW.quantity, NEW.id, v_at);
    END IF;
    RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------
-- F) Sustitucion dentro de un combo
-- ---------------------------------------------------------------------
ALTER TABLE public.sale_item_substitutions
    ADD COLUMN component_product_id uuid,
    ADD CONSTRAINT sale_item_substitutions_component_fk
        FOREIGN KEY (component_product_id, club_id) REFERENCES public.products (id, club_id);
COMMENT ON COLUMN public.sale_item_substitutions.component_product_id IS
    'Solo en combos: que producto del combo se sustituye. NULL en un producto comun.';
CREATE INDEX idx_sale_item_substitutions_component
    ON public.sale_item_substitutions (component_product_id, club_id);

-- Reemplaza la del archivo 06. Copia lo vendido, valida la cantidad y
-- calcula las diferencias. El posnet no puede falsear esos datos.
CREATE OR REPLACE FUNCTION private.substitution_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_item       public.sale_items%ROWTYPE;
    v_kind       text;
    v_component  public.sale_item_components%ROWTYPE;
    v_limit      integer;
    v_replaced   integer;
BEGIN
    -- FOR UPDATE: dos sustituciones simultaneas del mismo item se ordenan.
    SELECT si.* INTO v_item
      FROM public.sale_items si
     WHERE si.id = NEW.sale_item_id
       AND si.club_id = NEW.club_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El item de venta % todavia no existe', NEW.sale_item_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_item.sale_id <> NEW.sale_id THEN
        RAISE EXCEPTION 'El item % no pertenece a la venta %', NEW.sale_item_id, NEW.sale_id
            USING ERRCODE = 'check_violation';
    END IF;
    -- Se entrega un producto con stock, nunca un combo.
    IF EXISTS (SELECT 1 FROM public.products p
                WHERE p.id = NEW.substitute_product_id AND p.club_id = NEW.club_id AND p.kind = 'combo') THEN
        RAISE EXCEPTION 'Se entrega un producto, no un combo' USING ERRCODE = 'check_violation';
    END IF;

    SELECT p.kind INTO v_kind FROM public.products p
     WHERE p.id = v_item.product_id AND p.club_id = v_item.club_id;

    IF v_kind = 'combo' THEN
        IF NEW.component_product_id IS NULL THEN
            RAISE EXCEPTION 'En un combo hay que indicar que producto se sustituye'
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT c.* INTO v_component
          FROM public.sale_item_components c
         WHERE c.sale_item_id = NEW.sale_item_id AND c.product_id = NEW.component_product_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'El producto % no es parte de ese combo', NEW.component_product_id
                USING ERRCODE = 'check_violation';
        END IF;
        v_limit := v_item.quantity * v_component.quantity;
        SELECT COALESCE(SUM(s.quantity), 0) INTO v_replaced
          FROM public.sale_item_substitutions s
         WHERE s.sale_item_id = NEW.sale_item_id
           AND s.component_product_id = NEW.component_product_id;

        NEW.original_product_id   := v_component.product_id;
        NEW.original_product_name := v_component.product_name;
        NEW.original_unit_price   := v_component.unit_price;
        NEW.original_unit_cost    := v_component.unit_cost;
    ELSE
        IF NEW.component_product_id IS NOT NULL THEN
            RAISE EXCEPTION 'Solo en un combo se indica que producto del combo se sustituye'
                USING ERRCODE = 'check_violation';
        END IF;
        v_limit := v_item.quantity;
        SELECT COALESCE(SUM(s.quantity), 0) INTO v_replaced
          FROM public.sale_item_substitutions s
         WHERE s.sale_item_id = NEW.sale_item_id;

        NEW.original_product_id   := v_item.product_id;
        NEW.original_product_name := v_item.product_name;
        NEW.original_unit_price   := v_item.unit_price;
        NEW.original_unit_cost    := v_item.unit_cost;
    END IF;

    IF v_replaced + NEW.quantity > v_limit THEN
        RAISE EXCEPTION 'Se sustituyen % unidades pero solo se vendieron % (ya sustituidas: %)',
            NEW.quantity, v_limit, v_replaced
            USING ERRCODE = 'check_violation';
    END IF;

    NEW.price_difference := (NEW.substitute_unit_price - NEW.original_unit_price) * NEW.quantity;
    NEW.cost_difference  := (NEW.substitute_unit_cost  - NEW.original_unit_cost)  * NEW.quantity;
    RETURN NEW;
END;
$$;

-- Reemplaza la del archivo 06: lo vendido vuelve a la ubicacion donde se
-- desconto (en un combo, el producto sustituido) y lo entregado sale de
-- la barra que lo entrega.
CREATE OR REPLACE FUNCTION private.substitution_creates_movements()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_sale_location uuid;
BEGIN
    SELECT m.location_id INTO v_sale_location
      FROM public.inventory_movements m
     WHERE m.sale_item_id = NEW.sale_item_id
       AND m.product_id = NEW.original_product_id
       AND m.movement_type = 'sale';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El item % no tiene movimiento de venta', NEW.sale_item_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    INSERT INTO public.inventory_movements
        (club_id, location_id, product_id, movement_type, quantity, substitution_id, occurred_at)
    VALUES
        (NEW.club_id, v_sale_location, NEW.original_product_id,
         'substitution_reversal', NEW.quantity, NEW.id, NEW.occurred_at),
        (NEW.club_id, NEW.location_id, NEW.substitute_product_id,
         'substitution_delivery', -NEW.quantity, NEW.id, NEW.occurred_at);
    RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------
-- G) Seguridad (mismo patron que 08, 15 y 16)
-- ---------------------------------------------------------------------
ALTER TABLE public.combo_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_item_components ENABLE ROW LEVEL SECURITY;

CREATE POLICY combo_items_select ON public.combo_items
    FOR SELECT TO authenticated USING (club_id IN (SELECT private.visible_club_ids()));
CREATE POLICY combo_items_insert ON public.combo_items
    FOR INSERT TO authenticated WITH CHECK (club_id IN (SELECT private.visible_club_ids()));
CREATE POLICY combo_items_update ON public.combo_items
    FOR UPDATE TO authenticated
    USING      (club_id IN (SELECT private.visible_club_ids()))
    WITH CHECK (club_id IN (SELECT private.visible_club_ids()));
CREATE POLICY combo_items_delete ON public.combo_items
    FOR DELETE TO authenticated USING (club_id IN (SELECT private.visible_club_ids()));

CREATE POLICY sale_item_components_select ON public.sale_item_components
    FOR SELECT TO authenticated USING (club_id IN (SELECT private.visible_club_ids()));

REVOKE ALL ON public.combo_items          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.sale_item_components FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.combo_items          TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_item_components TO service_role;
GRANT SELECT, DELETE ON public.combo_items TO authenticated;
GRANT INSERT (club_id, combo_id, product_id, quantity, unit_price) ON public.combo_items TO authenticated;
GRANT UPDATE (quantity, unit_price) ON public.combo_items TO authenticated;
GRANT SELECT ON public.sale_item_components TO authenticated;
-- El panel elige si crea un producto o un combo; despues no cambia.
GRANT INSERT (kind) ON public.products TO authenticated;

DO $$
DECLARE
    f text;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'private.product_kind_fixed()', 'private.combo_item_check()',
        'private.combo_price_guard()', 'private.combo_items_after_change()',
        'private.product_cost_to_combos()', 'private.combo_item_audit()', 'private.movement_not_on_combo()']
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END LOOP;
END;
$$;

-- El posnet necesita la composicion para mostrar el combo y para la
-- sustitucion en barra. sale_item_components la arma el servidor: no baja.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync')
       AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                        WHERE pubname = 'powersync' AND schemaname = 'public' AND tablename = 'combo_items') THEN
        ALTER PUBLICATION powersync ADD TABLE public.combo_items;
    END IF;
END;
$$;

COMMIT;
