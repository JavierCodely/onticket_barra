-- =====================================================================
-- ONTICKET - 08 de 09: SEGURIDAD (RLS + PERMISOS)
-- Requiere: 01 a 07
--
-- QUIEN ENTRA POR DONDE
--   anon           : visitante sin sesion            -> NADA.
--   authenticated  : panel web (administrador o club_admin con sesion de
--                    Supabase Auth) -> lo que permiten los GRANT de este
--                    archivo, filtrado fila por fila con RLS.
--   service_role   : Edge Functions (clave secreta). Saltea RLS: cada
--                    funcion valida por su cuenta. La usa el posnet.
--   powersync_role : replicacion de PowerSync (archivo 09). Solo lee.
--
-- DOS CANDADOS, LOS DOS OBLIGATORIOS
--   1) GRANT   : que operaciones y que COLUMNAS puede tocar un rol.
--   2) RLS     : sobre que FILAS (solo los clubs que gestiona).
--   Supabase ya no expone las tablas nuevas automaticamente: sin GRANT
--   explicito una tabla no es accesible por la API. Por eso aca se
--   otorga TODO de forma explicita, incluido service_role.
--
-- AL AGREGAR UNA TABLA: sumarla a las listas de este archivo (o repetir
-- el patron en su migracion): RLS + politicas + GRANT. La prueba
-- 040_calidad_esquema falla si falta algo.
-- =====================================================================
BEGIN;

-- =====================================================================
-- A) RLS ACTIVO EN TODAS LAS TABLAS  (sin politica = nadie accede)
-- =====================================================================
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'payment_methods', 'platform_admins', 'clubs', 'users',
        'products', 'inventory_locations', 'cash_registers', 'cash_shifts',
        'taxes', 'tax_payment_methods',
        'sales', 'sale_items', 'sale_payments', 'sale_status_events',
        'sale_item_substitutions', 'sale_item_taxes',
        'inventory_movements', 'inventory_balances', 'stock_alerts',
        'audit_log', 'sync_errors']
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END LOOP;
END;
$$;


-- =====================================================================
-- B) POLITICAS DE LECTURA
-- =====================================================================

-- Catalogo global: cualquier usuario con sesion lo lee.
CREATE POLICY payment_methods_select ON public.payment_methods
    FOR SELECT TO authenticated
    USING (true);

-- Un administrador solo ve su propia ficha.
CREATE POLICY platform_admins_select_self ON public.platform_admins
    FOR SELECT TO authenticated
    USING (auth_user_id = (SELECT auth.uid()));

-- La segunda condicion cubre al club RECIEN creado: dentro de la misma
-- sentencia (INSERT ... RETURNING, que es lo que envia supabase-js con
-- .insert().select()) visible_club_ids() todavia no lo ve y, sin ella,
-- crear un club desde el panel falla.
CREATE POLICY clubs_select ON public.clubs
    FOR SELECT TO authenticated
    USING (
        id IN (SELECT private.visible_club_ids())
        OR (created_by_admin_id = (SELECT private.current_admin_id()) AND deleted_at IS NULL)
    );

-- Tablas con club_id: solo filas de los clubs que gestiona.
-- "(SELECT private.visible_club_ids())" se evalua UNA vez por consulta.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'users', 'products', 'inventory_locations', 'cash_registers', 'cash_shifts',
        'taxes', 'tax_payment_methods',
        'sales', 'sale_items', 'sale_payments', 'sale_status_events',
        'sale_item_substitutions', 'sale_item_taxes',
        'inventory_movements', 'inventory_balances', 'stock_alerts',
        'audit_log', 'sync_errors']
    LOOP
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
             USING (club_id IN (SELECT private.visible_club_ids()))',
            t || '_select', t);
    END LOOP;
END;
$$;


-- =====================================================================
-- C) POLITICAS DE ESCRITURA (lo que el panel puede cambiar directo)
-- =====================================================================

-- Clubs: los crea y edita SOLO su administrador (no un club_admin).
CREATE POLICY clubs_insert ON public.clubs
    FOR INSERT TO authenticated
    WITH CHECK (created_by_admin_id = (SELECT private.current_admin_id()));
CREATE POLICY clubs_update ON public.clubs
    FOR UPDATE TO authenticated
    USING      (created_by_admin_id = (SELECT private.current_admin_id()))
    WITH CHECK (created_by_admin_id = (SELECT private.current_admin_id()));

-- Catalogo del club: alta y edicion.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['products', 'inventory_locations', 'cash_registers', 'taxes']
    LOOP
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
             WITH CHECK (club_id IN (SELECT private.visible_club_ids()))',
            t || '_insert', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
             USING      (club_id IN (SELECT private.visible_club_ids()))
             WITH CHECK (club_id IN (SELECT private.visible_club_ids()))',
            t || '_update', t);
    END LOOP;
END;
$$;

-- Metodos de pago de un impuesto: se agregan y se quitan filas.
CREATE POLICY tax_payment_methods_insert ON public.tax_payment_methods
    FOR INSERT TO authenticated
    WITH CHECK (club_id IN (SELECT private.visible_club_ids()));
CREATE POLICY tax_payment_methods_delete ON public.tax_payment_methods
    FOR DELETE TO authenticated
    USING (club_id IN (SELECT private.visible_club_ids()));

-- Stock: solo movimientos manuales. Las ventas y sustituciones las
-- generan los triggers, nunca el panel.
CREATE POLICY inventory_movements_insert_manual ON public.inventory_movements
    FOR INSERT TO authenticated
    WITH CHECK (
        club_id IN (SELECT private.visible_club_ids())
        AND movement_type IN ('initial', 'purchase', 'adjustment', 'transfer_in', 'transfer_out')
    );

-- Errores de sincronizacion: el panel los marca como resueltos.
CREATE POLICY sync_errors_update ON public.sync_errors
    FOR UPDATE TO authenticated
    USING      (club_id IN (SELECT private.visible_club_ids()))
    WITH CHECK (club_id IN (SELECT private.visible_club_ids()));


-- =====================================================================
-- D) PERMISOS SOBRE TABLAS Y VISTAS
-- =====================================================================

-- D1) Punto de partida: nadie tiene nada.
DO $$
DECLARE
    r text;
BEGIN
    FOREACH r IN ARRAY ARRAY[
        'payment_methods', 'platform_admins', 'clubs', 'users',
        'products', 'inventory_locations', 'cash_registers', 'cash_shifts',
        'taxes', 'tax_payment_methods',
        'sales', 'sale_items', 'sale_payments', 'sale_status_events',
        'sale_item_substitutions', 'sale_item_taxes',
        'inventory_movements', 'inventory_balances', 'stock_alerts',
        'audit_log', 'sync_errors',
        'v_sale_item_financials', 'v_club_daily_stats', 'v_sale_taxes_detail',
        'v_sales_integrity_issues', 'v_ticket_number_conflicts', 'v_sale_tax_issues']
    LOOP
        EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', r);
        -- Edge Functions: acceso completo (validan en su codigo).
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', r);
    END LOOP;
END;
$$;

-- D2) Panel web: LECTURA (RLS filtra las filas).
GRANT SELECT ON
    public.payment_methods, public.platform_admins, public.clubs,
    public.products, public.inventory_locations, public.cash_registers, public.cash_shifts,
    public.taxes, public.tax_payment_methods,
    public.sales, public.sale_items, public.sale_payments, public.sale_status_events,
    public.sale_item_substitutions, public.sale_item_taxes,
    public.inventory_movements, public.inventory_balances, public.stock_alerts,
    public.audit_log, public.sync_errors,
    public.v_sale_item_financials, public.v_club_daily_stats, public.v_sale_taxes_detail,
    public.v_sales_integrity_issues, public.v_ticket_number_conflicts, public.v_sale_tax_issues
TO authenticated;

-- users: lectura SIN secretos (pin_hash, failed_attempts, locked_until).
GRANT SELECT (id, club_id, full_name, role, active, email, auth_user_id,
              username, pin_changed_at, created_at, updated_at, deleted_at)
    ON public.users TO authenticated;

-- D3) Panel web: ESCRITURA, columna por columna. Lo que no esta en la
--     lista no se puede enviar (id, club_id en cambios, fechas, actor).
GRANT INSERT (name, slug, timezone, business_day_start_hour, created_by_admin_id)
    ON public.clubs TO authenticated;
-- Un club se desactiva con "active"; el borrado logico (deleted_at) lo
-- oculta de su propio administrador, asi que queda fuera del panel.
GRANT UPDATE (name, slug, timezone, business_day_start_hour, active)
    ON public.clubs TO authenticated;

GRANT INSERT (club_id, name, sku, category, cost, price, image_url, active)
    ON public.products TO authenticated;
GRANT UPDATE (name, sku, category, cost, price, image_url, active, deleted_at)
    ON public.products TO authenticated;

GRANT INSERT (club_id, name, kind, active)
    ON public.inventory_locations TO authenticated;
GRANT UPDATE (name, kind, active, deleted_at)
    ON public.inventory_locations TO authenticated;

GRANT INSERT (club_id, name, inventory_location_id, active)
    ON public.cash_registers TO authenticated;
GRANT UPDATE (name, inventory_location_id, active, deleted_at)
    ON public.cash_registers TO authenticated;

-- Impuestos: se crean, se editan y se activan/desactivan. Sin DELETE.
GRANT INSERT (club_id, name, kind, percentage, fixed_amount, active)
    ON public.taxes TO authenticated;
GRANT UPDATE (name, kind, percentage, fixed_amount, active)
    ON public.taxes TO authenticated;

GRANT INSERT (club_id, tax_id, method)
    ON public.tax_payment_methods TO authenticated;
GRANT DELETE ON public.tax_payment_methods TO authenticated;

-- Movimientos manuales: sin columnas de actor ni referencias a ventas.
GRANT INSERT (club_id, location_id, product_id, movement_type, quantity, note, occurred_at)
    ON public.inventory_movements TO authenticated;

GRANT UPDATE (resolved_at, resolved_note)
    ON public.sync_errors TO authenticated;

-- NO se otorga al panel (va por Edge Function o por trigger):
--   users (altas, roles, PIN), ventas y sus libros, saldos, alertas,
--   auditoria, platform_admins.


-- =====================================================================
-- E) PERMISOS SOBRE FUNCIONES
-- Postgres deja ejecutar toda funcion nueva a cualquiera (PUBLIC):
-- se retira y se otorga solo lo necesario.
-- =====================================================================
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO service_role;

-- Las politicas RLS y los triggers del panel necesitan estas tres:
GRANT EXECUTE ON FUNCTION
    private.current_admin_id(),
    private.visible_club_ids(),
    private.current_actor()
TO authenticated;

-- Funciones publicas (se llaman con supabase.rpc):
REVOKE EXECUTE ON FUNCTION
    public.can_manage_club(uuid),
    public.product_tax_preview(uuid, numeric, numeric)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
    public.can_manage_club(uuid),
    public.product_tax_preview(uuid, numeric, numeric)
TO authenticated, service_role;

COMMIT;
