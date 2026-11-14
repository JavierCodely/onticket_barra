-- PRUEBA 040: calidad del esquema. No prueba datos: revisa el CATALOGO
-- de Postgres para que ninguna tabla, vista o funcion nueva se escape de
-- las convenciones (CLAUDE.md, seccion "Convenciones de SQL").
-- Si agregas algo y esta prueba falla, el mensaje dice que falta.
BEGIN;

DO $$
DECLARE
    v_missing text;
BEGIN
    -- 1) RLS activo en TODAS las tablas de public
    SELECT string_agg(c.relname, ', ') INTO v_missing
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
       AND NOT c.relrowsecurity;
    ASSERT v_missing IS NULL, 'Tablas sin RLS: ' || v_missing;

    -- 2) Toda tabla con RLS tiene al menos una politica (si no, nadie la lee)
    SELECT string_agg(c.relname, ', ') INTO v_missing
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
       AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid);
    ASSERT v_missing IS NULL, 'Tablas sin ninguna politica RLS: ' || v_missing;

    -- 3) Toda clave foranea tiene un indice que la cubre
    SELECT string_agg(fk.conrelid::regclass || '.' || fk.conname, ', ') INTO v_missing
      FROM pg_constraint fk
     WHERE fk.contype = 'f' AND fk.connamespace = 'public'::regnamespace
       AND NOT EXISTS (
           SELECT 1
             FROM pg_index i
            WHERE i.indrelid = fk.conrelid
              AND i.indisvalid
              AND i.indpred IS NULL                                   -- los indices parciales no cuentan
              AND i.indnatts >= cardinality(fk.conkey)
              AND (SELECT array_agg(k ORDER BY k)
                     FROM unnest((i.indkey::int2[])[0:cardinality(fk.conkey) - 1]) k)
                = (SELECT array_agg(k ORDER BY k) FROM unnest(fk.conkey) k));
    ASSERT v_missing IS NULL, 'Claves foraneas sin indice: ' || v_missing;

    -- 4) Toda tabla con club_id lo referencia contra clubs
    SELECT string_agg(c.relname, ', ') INTO v_missing
      FROM pg_class c
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'club_id' AND NOT a.attisdropped
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
       AND NOT EXISTS (
           SELECT 1 FROM pg_constraint fk
            WHERE fk.conrelid = c.oid AND fk.contype = 'f'
              AND fk.confrelid = 'public.clubs'::regclass
              AND fk.conkey = ARRAY[a.attnum]);
    ASSERT v_missing IS NULL, 'Tablas con club_id sin clave foranea a clubs: ' || v_missing;

    -- 5) Toda funcion propia fija su search_path
    SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_missing
      FROM pg_proc p
     WHERE p.pronamespace IN ('public'::regnamespace, 'private'::regnamespace)
       AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%');
    ASSERT v_missing IS NULL, 'Funciones sin SET search_path: ' || v_missing;

    -- 6) Ninguna funcion queda ejecutable por anon (ni por PUBLIC)
    SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_missing
      FROM pg_proc p
     WHERE p.pronamespace IN ('public'::regnamespace, 'private'::regnamespace)
       AND has_function_privilege('anon', p.oid, 'EXECUTE');
    ASSERT v_missing IS NULL, 'Funciones ejecutables por anon: ' || v_missing;

    -- 7) Del esquema private, el panel solo ejecuta las 3 funciones de identidad
    SELECT string_agg(p.proname, ', ') INTO v_missing
      FROM pg_proc p
     WHERE p.pronamespace = 'private'::regnamespace
       AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
       AND p.proname NOT IN ('current_admin_id', 'visible_club_ids', 'current_actor',
                             'promotion_in_schedule');   -- pura: no lee tablas
    ASSERT v_missing IS NULL, 'Funciones privadas ejecutables por el panel: ' || v_missing;

    -- 8) anon no tiene NINGUN permiso sobre tablas ni vistas
    SELECT string_agg(c.relname, ', ') INTO v_missing
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v')
       AND (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
            OR has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE'));
    ASSERT v_missing IS NULL, 'anon tiene permisos sobre: ' || v_missing;

    -- 9) service_role (Edge Functions) accede a todas las tablas y vistas
    SELECT string_agg(c.relname, ', ') INTO v_missing
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v')
       AND NOT has_table_privilege('service_role', c.oid, 'SELECT');
    ASSERT v_missing IS NULL, 'service_role no puede leer: ' || v_missing;

    SELECT string_agg(c.relname, ', ') INTO v_missing
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
       AND NOT (has_table_privilege('service_role', c.oid, 'INSERT')
                AND has_table_privilege('service_role', c.oid, 'UPDATE')
                AND has_table_privilege('service_role', c.oid, 'DELETE'));
    ASSERT v_missing IS NULL, 'service_role no puede escribir: ' || v_missing;

    -- 10) El panel puede leer todas las tablas y vistas (RLS filtra filas)
    SELECT string_agg(c.relname, ', ') INTO v_missing
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v')
       AND NOT (has_table_privilege('authenticated', c.oid, 'SELECT')
                OR has_any_column_privilege('authenticated', c.oid, 'SELECT'));
    ASSERT v_missing IS NULL, 'El panel no puede leer: ' || v_missing;

    -- 11) Los secretos de users no son legibles desde el panel
    ASSERT NOT has_column_privilege('authenticated', 'public.users', 'pin_hash', 'SELECT'),        'pin_hash expuesto al panel';
    ASSERT NOT has_column_privilege('authenticated', 'public.users', 'failed_attempts', 'SELECT'), 'failed_attempts expuesto al panel';
    ASSERT NOT has_column_privilege('authenticated', 'public.users', 'locked_until', 'SELECT'),    'locked_until expuesto al panel';

    -- 12) El panel no puede BORRAR nada, salvo metodos de pago de un impuesto
    --     asignaciones de personal (15), precios de barra (16) y productos
    --     de un combo (17): quitar = borrar, queda auditado
    SELECT string_agg(c.relname, ', ') INTO v_missing
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
       AND c.relname NOT IN ('tax_payment_methods', 'staff_assignments', 'product_location_prices', 'combo_items', 'promotion_locations')
       AND has_table_privilege('authenticated', c.oid, 'DELETE, TRUNCATE');
    ASSERT v_missing IS NULL, 'El panel puede borrar en: ' || v_missing;

    -- 13) Todas las vistas respetan RLS (security_invoker)
    SELECT string_agg(c.relname, ', ') INTO v_missing
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v'
       AND NOT COALESCE(c.reloptions @> ARRAY['security_invoker=true'], false);
    ASSERT v_missing IS NULL, 'Vistas sin security_invoker: ' || v_missing;

    -- 14) Los libros de solo agregar tienen su candado
    SELECT string_agg(t.name, ', ') INTO v_missing
      FROM unnest(ARRAY['sale_items', 'sale_payments', 'sale_status_events', 'sale_item_substitutions',
                        'sale_item_taxes', 'inventory_movements', 'audit_log',
                        'cash_register_floats', 'night_stock_snapshots']) AS t(name)
     WHERE NOT EXISTS (
           SELECT 1 FROM pg_trigger tg
            WHERE tg.tgrelid = ('public.' || t.name)::regclass
              AND tg.tgfoid = 'private.forbid_update_delete()'::regprocedure
              AND NOT tg.tgisinternal);
    ASSERT v_missing IS NULL, 'Libros sin trigger de solo agregar: ' || v_missing;

    -- 15) Toda tabla con updated_at lo mantiene sola
    --     (inventory_balances lo actualiza el trigger de stock)
    SELECT string_agg(c.relname, ', ') INTO v_missing
      FROM pg_class c
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'updated_at' AND NOT a.attisdropped
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
       AND c.relname <> 'inventory_balances'
       AND NOT EXISTS (
           SELECT 1 FROM pg_trigger tg
            WHERE tg.tgrelid = c.oid
              AND tg.tgfoid = 'private.set_updated_at()'::regprocedure);
    ASSERT v_missing IS NULL, 'Tablas con updated_at sin trigger: ' || v_missing;

    -- 16) Tipos que no viajan bien a SQLite: ni ENUM, ni DOMAIN, ni columnas generadas
    SELECT string_agg(c.relname || '.' || a.attname, ', ') INTO v_missing
      FROM pg_class c
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      JOIN pg_type ty ON ty.oid = a.atttypid
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
       AND (ty.typtype IN ('e', 'd') OR a.attgenerated <> '');
    ASSERT v_missing IS NULL, 'Columnas ENUM / DOMAIN / GENERATED: ' || v_missing;

    -- 17) Dinero siempre numeric (nunca real ni double precision)
    SELECT string_agg(c.relname || '.' || a.attname, ', ') INTO v_missing
      FROM pg_class c
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
       AND a.atttypid IN ('real'::regtype, 'double precision'::regtype, 'money'::regtype);
    ASSERT v_missing IS NULL, 'Columnas con tipos de punto flotante: ' || v_missing;

    -- 18) Fechas siempre con zona horaria
    SELECT string_agg(c.relname || '.' || a.attname, ', ') INTO v_missing
      FROM pg_class c
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
       AND a.atttypid = 'timestamp without time zone'::regtype;
    ASSERT v_missing IS NULL, 'Columnas timestamp SIN zona horaria: ' || v_missing;

    -- 19) Publicacion de PowerSync: existe, con nombre exacto, sin tablas internas
    ASSERT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync'), 'Falta la publicacion powersync';
    ASSERT NOT (SELECT puballtables FROM pg_publication WHERE pubname = 'powersync'),
           'La publicacion debe listar tablas, no FOR ALL TABLES';
    SELECT string_agg(pt.tablename, ', ') INTO v_missing
      FROM pg_publication_tables pt
     WHERE pt.pubname = 'powersync'
       AND pt.tablename IN ('platform_admins', 'audit_log', 'inventory_movements', 'stock_alerts');
    ASSERT v_missing IS NULL, 'Tablas internas publicadas a PowerSync: ' || v_missing;
    ASSERT (SELECT count(*) FROM pg_publication_tables WHERE pubname = 'powersync') = 24,
           'La publicacion powersync debe tener 24 tablas (actualizar 09, 12, 13, 15, 16, 17, 18 y esta prueba juntos)';

    -- 19 bis) Realtime: el panel ve en vivo ventas, pagos, noches y cambio
    SELECT string_agg(t.name, ', ') INTO v_missing
      FROM unnest(ARRAY['sales', 'sale_payments', 'club_nights', 'cash_register_floats']) AS t(name)
     WHERE NOT EXISTS (SELECT 1 FROM pg_publication_tables pt
                        WHERE pt.pubname = 'supabase_realtime' AND pt.schemaname = 'public' AND pt.tablename = t.name);
    ASSERT v_missing IS NULL, 'Tablas sin Realtime: ' || v_missing;
    SELECT string_agg(pt.tablename, ', ') INTO v_missing
      FROM pg_publication_tables pt
     WHERE pt.pubname = 'supabase_realtime'
       AND pt.tablename IN ('users', 'platform_admins', 'audit_log');
    ASSERT v_missing IS NULL, 'Tablas con secretos o internas en Realtime: ' || v_missing;

    -- 20) Toda tabla y vista esta documentada (COMMENT ON)
    SELECT string_agg(c.relname, ', ') INTO v_missing
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v')
       AND obj_description(c.oid, 'pg_class') IS NULL;
    ASSERT v_missing IS NULL, 'Tablas o vistas sin COMMENT: ' || v_missing;
END;
$$;

ROLLBACK;
