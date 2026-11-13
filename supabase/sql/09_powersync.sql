-- =====================================================================
-- ONTICKET - 09 de 09: REPLICACION PARA POWERSYNC
-- Requiere: 01 a 08
--
-- PowerSync lee los cambios de Postgres por replicacion logica y los
-- reparte a los posnets segun los Sync Streams (carpeta powersync/).
--
-- La publicacion DEBE llamarse "powersync". Se listan solo las tablas
-- que el posnet necesita: PowerSync procesa TODO lo publicado, se use o
-- no, asi que publicar de mas cuesta memoria y demora.
--
-- NO se publican (el posnet no las necesita):
--   platform_admins, inventory_movements (el posnet usa el saldo de
--   inventory_balances), stock_alerts, audit_log.
--
-- OJO con users: se publica porque el posnet valida el PIN sin conexion
-- (necesita pin_hash). Los Sync Streams deben enviar SOLO las columnas
-- necesarias y nunca failed_attempts ni locked_until.
--
-- Como llegan los tipos al SQLite del posnet:
--   numeric -> texto (no perder decimales: usar BigDecimal, nunca Double)
--   boolean -> entero 0/1       uuid, timestamptz -> texto
--
-- AL AGREGAR UNA TABLA que el posnet deba recibir:
--   ALTER PUBLICATION powersync ADD TABLE public.<tabla>;
--   GRANT SELECT ON public.<tabla> TO powersync_role;
-- =====================================================================
BEGIN;

CREATE PUBLICATION powersync FOR TABLE
    public.payment_methods,
    public.clubs,
    public.users,
    public.products,
    public.inventory_locations,
    public.cash_registers,
    public.cash_shifts,
    public.taxes,
    public.tax_payment_methods,
    public.inventory_balances,
    public.sales,
    public.sale_items,
    public.sale_payments,
    public.sale_status_events,
    public.sale_item_substitutions,
    public.sale_item_taxes,
    public.sync_errors;

COMMIT;

-- ---------------------------------------------------------------------
-- ROL DE REPLICACION  (ejecutar aparte, UNA vez por proyecto)
-- 1) Reemplazar CAMBIAR_ESTA_CLAVE por una clave larga y aleatoria.
--    Guardarla en un gestor de claves; NUNCA en el repositorio.
-- 2) Quitar los "-- " de las lineas de abajo y ejecutar.
-- 3) En PowerSync, conectar la base con este usuario.
-- (El panel de PowerSync tambien ofrece una configuracion guiada para
--  Supabase; si se usa, respetar igualmente la lista de tablas.)
-- ---------------------------------------------------------------------
-- CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN PASSWORD 'CAMBIAR_ESTA_CLAVE';
-- GRANT USAGE ON SCHEMA public TO powersync_role;
-- GRANT SELECT ON
--     public.payment_methods, public.clubs, public.users, public.products,
--     public.inventory_locations, public.cash_registers, public.cash_shifts,
--     public.taxes, public.tax_payment_methods, public.inventory_balances,
--     public.sales, public.sale_items, public.sale_payments,
--     public.sale_status_events, public.sale_item_substitutions,
--     public.sale_item_taxes, public.sync_errors
-- TO powersync_role;
