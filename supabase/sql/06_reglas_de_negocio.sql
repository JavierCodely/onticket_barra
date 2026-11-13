-- =====================================================================
-- ONTICKET - 06 de 09: REGLAS DE NEGOCIO (TRIGGERS)
-- Requiere: 01 a 05
--
-- Que hace cada bloque:
--   A) Stock      : cada movimiento actualiza el saldo y las alertas.
--   B) Ventas     : cada item vendido descuenta stock una sola vez.
--   C) Sustitucion: valida, calcula diferencias y mueve el stock.
--   D) Retiro     : el primer escaneo del QR marca el ticket entregado.
--   E) Inmutables : libros de solo agregar, ventas, club_id.
--   F) Auditoria  : lo que el panel cambia queda registrado.
--   G) updated_at.
--
-- SECURITY DEFINER se usa SOLO donde el trigger debe escribir tablas
-- que quien dispara la accion no puede tocar (saldos, libro, auditoria).
-- Todas las funciones viven en "private" y llevan search_path = ''.
-- =====================================================================
BEGIN;

-- =====================================================================
-- A) STOCK
-- =====================================================================

-- A1) Los movimientos cargados desde el panel quedan firmados con quien
--     los hizo: no se puede cargar un ajuste a nombre de otro.
CREATE OR REPLACE FUNCTION private.stamp_manual_movement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_actor_type text;
    v_actor_id   uuid;
BEGIN
    SELECT a.actor_type, a.actor_id
      INTO v_actor_type, v_actor_id
      FROM private.current_actor() a;

    IF v_actor_id IS NOT NULL THEN               -- la operacion viene del panel
        IF NEW.movement_type NOT IN ('initial', 'purchase', 'adjustment', 'transfer_in', 'transfer_out') THEN
            RAISE EXCEPTION 'El panel solo puede cargar movimientos manuales (no %)', NEW.movement_type
                USING ERRCODE = 'check_violation';
        END IF;
        NEW.actor_type := v_actor_type;
        NEW.actor_id   := v_actor_id;
        NEW.created_at := now();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_inventory_movements_stamp
    BEFORE INSERT ON public.inventory_movements
    FOR EACH ROW EXECUTE FUNCTION private.stamp_manual_movement();

-- A2) Cada movimiento suma al saldo. Si el saldo queda negativo abre (o
--     actualiza) una alerta; si vuelve a ser >= 0, la cierra.
CREATE OR REPLACE FUNCTION private.apply_inventory_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_balance integer;
BEGIN
    INSERT INTO public.inventory_balances AS b (club_id, location_id, product_id, quantity)
    VALUES (NEW.club_id, NEW.location_id, NEW.product_id, NEW.quantity)
    ON CONFLICT (location_id, product_id)
    DO UPDATE SET quantity   = b.quantity + EXCLUDED.quantity,
                  updated_at = now()
    RETURNING b.quantity INTO v_balance;

    IF v_balance < 0 THEN
        INSERT INTO public.stock_alerts AS a (club_id, location_id, product_id, quantity_at_detection)
        VALUES (NEW.club_id, NEW.location_id, NEW.product_id, v_balance)
        ON CONFLICT (location_id, product_id) WHERE status = 'open'
        DO UPDATE SET quantity_at_detection = LEAST(a.quantity_at_detection, EXCLUDED.quantity_at_detection);
    ELSE
        UPDATE public.stock_alerts a
           SET status        = 'resolved',
               resolved_at   = now(),
               resolved_note = 'El stock volvio a ser >= 0'
         WHERE a.location_id = NEW.location_id
           AND a.product_id  = NEW.product_id
           AND a.status      = 'open';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_inventory_movements_apply
    AFTER INSERT ON public.inventory_movements
    FOR EACH ROW EXECUTE FUNCTION private.apply_inventory_movement();


-- =====================================================================
-- B) VENTAS: cada item descuenta stock en la ubicacion de su caja
-- (El indice unico uq_inventory_movements_sale_item garantiza "una sola vez".)
-- =====================================================================
CREATE OR REPLACE FUNCTION private.sale_item_creates_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.inventory_movements
        (club_id, location_id, product_id, movement_type, quantity, sale_item_id, occurred_at)
    SELECT NEW.club_id, cr.inventory_location_id, NEW.product_id, 'sale',
           -NEW.quantity, NEW.id, s.created_at_device
      FROM public.sales s
      JOIN public.cash_registers cr
        ON cr.id = s.cash_register_id AND cr.club_id = s.club_id
     WHERE s.id = NEW.sale_id
       AND s.club_id = NEW.club_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'La venta % todavia no existe', NEW.sale_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sale_items_movement
    AFTER INSERT ON public.sale_items
    FOR EACH ROW EXECUTE FUNCTION private.sale_item_creates_movement();


-- =====================================================================
-- C) SUSTITUCIONES
-- =====================================================================

-- C1) Antes de insertar: copia lo vendido, valida la cantidad y calcula
--     las diferencias. El posnet no puede falsear esos datos.
CREATE OR REPLACE FUNCTION private.substitution_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_item      public.sale_items%ROWTYPE;
    v_replaced  integer;
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

    SELECT COALESCE(SUM(s.quantity), 0) INTO v_replaced
      FROM public.sale_item_substitutions s
     WHERE s.sale_item_id = NEW.sale_item_id;

    IF v_replaced + NEW.quantity > v_item.quantity THEN
        RAISE EXCEPTION 'Se sustituyen % unidades pero solo se vendieron % (ya sustituidas: %)',
            NEW.quantity, v_item.quantity, v_replaced
            USING ERRCODE = 'check_violation';
    END IF;

    NEW.original_product_id   := v_item.product_id;
    NEW.original_product_name := v_item.product_name;
    NEW.original_unit_price   := v_item.unit_price;
    NEW.original_unit_cost    := v_item.unit_cost;
    NEW.price_difference := (NEW.substitute_unit_price - v_item.unit_price) * NEW.quantity;
    NEW.cost_difference  := (NEW.substitute_unit_cost  - v_item.unit_cost)  * NEW.quantity;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sale_item_substitutions_before_insert
    BEFORE INSERT ON public.sale_item_substitutions
    FOR EACH ROW EXECUTE FUNCTION private.substitution_before_insert();

-- C2) Despues de insertar: el stock vuelve a reflejar la realidad.
--       + producto vendido  (no se entrego) en la ubicacion donde se
--                           desconto al vender
--       - producto entregado en la barra que lo entrego
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

CREATE TRIGGER trg_sale_item_substitutions_after_insert
    AFTER INSERT ON public.sale_item_substitutions
    FOR EACH ROW EXECUTE FUNCTION private.substitution_creates_movements();


-- =====================================================================
-- D) RETIRO DEL TICKET (escaneo del QR)
-- =====================================================================

-- D1) Marca como duplicado todo retiro que llega despues del primero.
CREATE OR REPLACE FUNCTION private.sale_event_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    -- Bloquea la venta: dos escaneos simultaneos se procesan de a uno.
    PERFORM 1
       FROM public.sales s
      WHERE s.id = NEW.sale_id
        AND s.club_id = NEW.club_id
        FOR UPDATE;

    NEW.is_duplicate := EXISTS (
        SELECT 1
          FROM public.sale_status_events e
         WHERE e.sale_id = NEW.sale_id
           AND e.event_type = NEW.event_type
           AND NOT e.is_duplicate
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sale_status_events_before_insert
    BEFORE INSERT ON public.sale_status_events
    FOR EACH ROW EXECUTE FUNCTION private.sale_event_before_insert();

-- D2) El primer retiro valido marca la venta como entregada.
CREATE OR REPLACE FUNCTION private.sale_event_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.event_type = 'delivered' AND NOT NEW.is_duplicate THEN
        UPDATE public.sales s
           SET status               = 'delivered',
               delivered_at         = NEW.occurred_at,
               delivered_by_user_id = NEW.scanned_by_user_id
         WHERE s.id = NEW.sale_id
           AND s.club_id = NEW.club_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sale_status_events_after_insert
    AFTER INSERT ON public.sale_status_events
    FOR EACH ROW EXECUTE FUNCTION private.sale_event_after_insert();


-- =====================================================================
-- E) INMUTABLES
-- =====================================================================

-- E1) Una venta no se borra, y de ella solo puede cambiar el retiro
--     (pending -> delivered). Total, caja, cajero y numero quedan fijos.
CREATE OR REPLACE FUNCTION private.guard_sale_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    c_mutable CONSTANT text[] := ARRAY['status', 'delivered_at', 'delivered_by_user_id', 'updated_at'];
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Las ventas no se borran'
            USING ERRCODE = 'check_violation';
    END IF;
    IF (to_jsonb(NEW) - c_mutable) IS DISTINCT FROM (to_jsonb(OLD) - c_mutable) THEN
        RAISE EXCEPTION 'De una venta solo puede cambiar el estado de retiro'
            USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'delivered' AND NEW.status <> 'delivered' THEN
        RAISE EXCEPTION 'Un ticket entregado no vuelve a pendiente'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sales_guard
    BEFORE UPDATE OR DELETE ON public.sales
    FOR EACH ROW EXECUTE FUNCTION private.guard_sale_changes();

-- E2) Libros de solo agregar.
CREATE TRIGGER trg_sale_items_append_only
    BEFORE UPDATE OR DELETE ON public.sale_items
    FOR EACH ROW EXECUTE FUNCTION private.forbid_update_delete();
CREATE TRIGGER trg_sale_payments_append_only
    BEFORE UPDATE OR DELETE ON public.sale_payments
    FOR EACH ROW EXECUTE FUNCTION private.forbid_update_delete();
CREATE TRIGGER trg_sale_status_events_append_only
    BEFORE UPDATE OR DELETE ON public.sale_status_events
    FOR EACH ROW EXECUTE FUNCTION private.forbid_update_delete();
CREATE TRIGGER trg_sale_item_substitutions_append_only
    BEFORE UPDATE OR DELETE ON public.sale_item_substitutions
    FOR EACH ROW EXECUTE FUNCTION private.forbid_update_delete();
CREATE TRIGGER trg_sale_item_taxes_append_only
    BEFORE UPDATE OR DELETE ON public.sale_item_taxes
    FOR EACH ROW EXECUTE FUNCTION private.forbid_update_delete();
CREATE TRIGGER trg_inventory_movements_append_only
    BEFORE UPDATE OR DELETE ON public.inventory_movements
    FOR EACH ROW EXECUTE FUNCTION private.forbid_update_delete();
CREATE TRIGGER trg_audit_log_append_only
    BEFORE UPDATE OR DELETE ON public.audit_log
    FOR EACH ROW EXECUTE FUNCTION private.forbid_update_delete();

-- E3) Una fila nunca cambia de club.
CREATE TRIGGER trg_users_club_fixed
    BEFORE UPDATE OF club_id ON public.users
    FOR EACH ROW EXECUTE FUNCTION private.forbid_club_change();
CREATE TRIGGER trg_products_club_fixed
    BEFORE UPDATE OF club_id ON public.products
    FOR EACH ROW EXECUTE FUNCTION private.forbid_club_change();
CREATE TRIGGER trg_inventory_locations_club_fixed
    BEFORE UPDATE OF club_id ON public.inventory_locations
    FOR EACH ROW EXECUTE FUNCTION private.forbid_club_change();
CREATE TRIGGER trg_cash_registers_club_fixed
    BEFORE UPDATE OF club_id ON public.cash_registers
    FOR EACH ROW EXECUTE FUNCTION private.forbid_club_change();
CREATE TRIGGER trg_cash_shifts_club_fixed
    BEFORE UPDATE OF club_id ON public.cash_shifts
    FOR EACH ROW EXECUTE FUNCTION private.forbid_club_change();
CREATE TRIGGER trg_taxes_club_fixed
    BEFORE UPDATE OF club_id ON public.taxes
    FOR EACH ROW EXECUTE FUNCTION private.forbid_club_change();


-- =====================================================================
-- F) AUDITORIA de lo que el panel cambia directo
-- Solo audita cuando hay alguien logueado en el panel; las Edge
-- Functions auditan lo suyo por su cuenta.
-- =====================================================================

-- F1) Altas y cambios de catalogo. Argumento: nombre de la entidad.
--     En cambios guarda SOLO las columnas que cambiaron (valor anterior
--     y nuevo). Si lo unico que cambia es "active" lo registra como
--     .activated / .deactivated.
CREATE OR REPLACE FUNCTION private.audit_catalog_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_entity     CONSTANT text  := TG_ARGV[0];
    v_new        CONSTANT jsonb := to_jsonb(NEW);
    v_actor_type text;
    v_actor_id   uuid;
    v_action     text;
    v_details    jsonb;
BEGIN
    SELECT a.actor_type, a.actor_id
      INTO v_actor_type, v_actor_id
      FROM private.current_actor() a;

    IF v_actor_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_action  := v_entity || '.created';
        v_details := jsonb_build_object('name', v_new ->> 'name');
    ELSE
        SELECT jsonb_object_agg(o.key, jsonb_build_object('from', o.value, 'to', n.value))
          INTO v_details
          FROM jsonb_each(to_jsonb(OLD)) o
          JOIN jsonb_each(v_new) n USING (key)
         WHERE o.value IS DISTINCT FROM n.value
           AND o.key <> 'updated_at';

        IF v_details IS NULL THEN                -- no cambio nada real
            RETURN NEW;
        END IF;

        v_action := v_entity || CASE
            WHEN v_details = jsonb_build_object('active', v_details -> 'active')
                 THEN CASE WHEN (v_new ->> 'active')::boolean THEN '.activated' ELSE '.deactivated' END
            ELSE '.updated'
        END;
    END IF;

    INSERT INTO public.audit_log (club_id, actor_type, actor_id, action, entity_type, entity_id, details)
    VALUES (
        -- en "clubs" la propia fila es el club
        COALESCE(v_new ->> 'club_id', v_new ->> 'id')::uuid,
        v_actor_type, v_actor_id, v_action, v_entity, (v_new ->> 'id')::uuid, v_details
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_clubs_audit
    AFTER INSERT OR UPDATE ON public.clubs
    FOR EACH ROW EXECUTE FUNCTION private.audit_catalog_change('club');
CREATE TRIGGER trg_products_audit
    AFTER INSERT OR UPDATE ON public.products
    FOR EACH ROW EXECUTE FUNCTION private.audit_catalog_change('product');
CREATE TRIGGER trg_taxes_audit
    AFTER INSERT OR UPDATE ON public.taxes
    FOR EACH ROW EXECUTE FUNCTION private.audit_catalog_change('tax');
CREATE TRIGGER trg_inventory_locations_audit
    AFTER INSERT OR UPDATE ON public.inventory_locations
    FOR EACH ROW EXECUTE FUNCTION private.audit_catalog_change('inventory_location');
CREATE TRIGGER trg_cash_registers_audit
    AFTER INSERT OR UPDATE ON public.cash_registers
    FOR EACH ROW EXECUTE FUNCTION private.audit_catalog_change('cash_register');

-- F2) Metodos de pago de un impuesto (se agregan y se quitan filas).
CREATE OR REPLACE FUNCTION private.audit_tax_method_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row        public.tax_payment_methods%ROWTYPE;
    v_actor_type text;
    v_actor_id   uuid;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_row := OLD;
    ELSE
        v_row := NEW;
    END IF;

    SELECT a.actor_type, a.actor_id
      INTO v_actor_type, v_actor_id
      FROM private.current_actor() a;

    IF v_actor_id IS NOT NULL THEN
        INSERT INTO public.audit_log (club_id, actor_type, actor_id, action, entity_type, entity_id, details)
        VALUES (v_row.club_id, v_actor_type, v_actor_id,
                CASE TG_OP WHEN 'DELETE' THEN 'tax.method_removed' ELSE 'tax.method_added' END,
                'tax', v_row.tax_id, jsonb_build_object('method', v_row.method));
    END IF;
    RETURN v_row;
END;
$$;

CREATE TRIGGER trg_tax_payment_methods_audit
    AFTER INSERT OR DELETE ON public.tax_payment_methods
    FOR EACH ROW EXECUTE FUNCTION private.audit_tax_method_change();


-- =====================================================================
-- G) updated_at AUTOMATICO
-- =====================================================================
CREATE TRIGGER trg_platform_admins_updated_at
    BEFORE UPDATE ON public.platform_admins
    FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_clubs_updated_at
    BEFORE UPDATE ON public.clubs
    FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON public.products
    FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_inventory_locations_updated_at
    BEFORE UPDATE ON public.inventory_locations
    FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_cash_registers_updated_at
    BEFORE UPDATE ON public.cash_registers
    FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_cash_shifts_updated_at
    BEFORE UPDATE ON public.cash_shifts
    FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_taxes_updated_at
    BEFORE UPDATE ON public.taxes
    FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_sales_updated_at
    BEFORE UPDATE ON public.sales
    FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

COMMIT;
