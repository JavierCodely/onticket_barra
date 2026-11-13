-- =====================================================================
-- ONTICKET - 99: REINICIO DE DESARROLLO        *** DESTRUCTIVO ***
--
-- BORRA todas las tablas, vistas, funciones y la publicacion de Onticket
-- CON TODOS SUS DATOS. Solo para un proyecto de desarrollo.
-- NUNCA ejecutar en produccion.
--
-- * Sirve tambien para pasar de la version anterior del esquema
--   (archivos 01 a 10, funciones en "public") a esta.
-- * No toca los usuarios de Authentication ni el rol powersync_role.
-- * Despues: volver a ejecutar 01 a 09 (y 90 si queres datos demo).
--
-- Al agregar una tabla, vista o funcion al esquema, sumarla aca.
-- =====================================================================
BEGIN;

DROP PUBLICATION IF EXISTS powersync;

DROP VIEW IF EXISTS
    public.v_sale_tax_issues,
    public.v_ticket_number_conflicts,
    public.v_sales_integrity_issues,
    public.v_sale_taxes_detail,
    public.v_club_daily_stats,
    public.v_sale_item_financials_net,     -- version anterior
    public.v_sale_item_financials;

DROP TABLE IF EXISTS
    public.sync_errors,
    public.audit_log,
    public.stock_alerts,
    public.inventory_balances,
    public.inventory_movements,
    public.sale_item_taxes,
    public.sale_item_substitutions,
    public.sale_status_events,
    public.sale_payments,
    public.sale_items,
    public.sales,
    public.tax_payment_methods,
    public.taxes,
    public.cash_shifts,
    public.cash_registers,
    public.inventory_locations,
    public.products,
    public.users,
    public.clubs,
    public.platform_admins,
    public.payment_methods
CASCADE;

-- Funciones publicas
DROP FUNCTION IF EXISTS public.product_tax_preview(uuid, numeric, numeric);
DROP FUNCTION IF EXISTS public.can_manage_club(uuid);

-- Funciones internas
DROP FUNCTION IF EXISTS private.audit_tax_method_change();
DROP FUNCTION IF EXISTS private.audit_catalog_change();
DROP FUNCTION IF EXISTS private.guard_sale_changes();
DROP FUNCTION IF EXISTS private.sale_event_after_insert();
DROP FUNCTION IF EXISTS private.sale_event_before_insert();
DROP FUNCTION IF EXISTS private.substitution_creates_movements();
DROP FUNCTION IF EXISTS private.substitution_before_insert();
DROP FUNCTION IF EXISTS private.sale_item_creates_movement();
DROP FUNCTION IF EXISTS private.apply_inventory_movement();
DROP FUNCTION IF EXISTS private.stamp_manual_movement();
DROP FUNCTION IF EXISTS private.current_actor();
DROP FUNCTION IF EXISTS private.visible_club_ids();
DROP FUNCTION IF EXISTS private.current_admin_id();
DROP FUNCTION IF EXISTS private.enforce_unique_email_across_actors();
DROP FUNCTION IF EXISTS private.validate_club_timezone();
DROP FUNCTION IF EXISTS private.forbid_club_change();
DROP FUNCTION IF EXISTS private.forbid_update_delete();
DROP FUNCTION IF EXISTS private.set_updated_at();

-- Funciones de la version anterior (vivian en "public")
DROP FUNCTION IF EXISTS public.audit_tax_methods_change();
DROP FUNCTION IF EXISTS public.audit_catalog_change();
DROP FUNCTION IF EXISTS public.app_current_actor();
DROP FUNCTION IF EXISTS public.app_visible_club_ids();
DROP FUNCTION IF EXISTS public.app_current_admin_id();
DROP FUNCTION IF EXISTS public.admin_owns_club(uuid, uuid);
DROP FUNCTION IF EXISTS public.enforce_unique_email_across_actors();
DROP FUNCTION IF EXISTS public.apply_inventory_movement();
DROP FUNCTION IF EXISTS public.sale_item_creates_movement();
DROP FUNCTION IF EXISTS public.substitution_before_insert();
DROP FUNCTION IF EXISTS public.substitution_creates_movements();
DROP FUNCTION IF EXISTS public.sale_event_before_insert();
DROP FUNCTION IF EXISTS public.sale_event_after_insert();
DROP FUNCTION IF EXISTS public.forbid_update_delete();
DROP FUNCTION IF EXISTS public.set_updated_at();

-- El esquema "private" se borra solo si quedo vacio (por si lo usas
-- tambien para otras cosas).
DO $$
BEGIN
    DROP SCHEMA IF EXISTS private;
EXCEPTION
    WHEN dependent_objects_still_exist THEN
        RAISE NOTICE 'El esquema "private" tiene otros objetos: no se borra.';
END;
$$;

COMMIT;
