-- PRUEBA 030: aislamiento entre clubs, secretos, permisos por columna,
-- auditoria y lo que cada rol puede o no puede hacer.
BEGIN;
\ir fixture.sql

-- Un error de sincronizacion pendiente en cada club (los crea pos-upload)
SELECT public.t_as_service();
INSERT INTO public.sync_errors (id, club_id, user_id, table_name, operation, error_code, error_message) VALUES
 ('e0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-000000000001','sale_item_substitutions','PUT','23514','Se sustituyen 2 unidades pero solo se vendio 1'),
 ('e0000000-0000-0000-0000-00000000000b','c0000000-0000-0000-0000-00000000000b',NULL,'sales','PUT','23514','Error del club B');
SELECT public.t_logout();

-- =====================================================================
-- ANA: administradora del Club A
-- =====================================================================
SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a1');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.clubs) = 1 AND (SELECT name FROM public.clubs) = 'Club A', 'Ana ve solo su club';
  ASSERT (SELECT count(*) FROM public.products) = 2, 'Ana ve solo productos del Club A';
  ASSERT (SELECT count(*) FROM public.users) = 4, 'Ana ve los usuarios de su club';
  ASSERT (SELECT count(*) FROM public.platform_admins) = 1, 'Ana ve solo su propia ficha de administradora';
  ASSERT (SELECT count(*) FROM public.payment_methods) = 5, 'El catalogo de metodos de pago es de lectura comun';
  ASSERT (SELECT count(*) FROM public.sync_errors) = 1, 'Ana ve solo los errores de su club';
  ASSERT public.can_manage_club('c0000000-0000-0000-0000-00000000000a'), 'Ana gestiona el Club A';
  ASSERT NOT public.can_manage_club('c0000000-0000-0000-0000-00000000000b'), 'Ana NO gestiona el Club B';
END $$;

-- Secretos: ni el hash del PIN ni los contadores de bloqueo
SELECT public.t_expect_error('SELECT pin_hash FROM public.users', 'permission denied');
SELECT public.t_expect_error('SELECT failed_attempts FROM public.users', 'permission denied');
SELECT public.t_expect_error('SELECT * FROM public.users', 'permission denied');

-- Lo que va por Edge Function o por trigger, nunca directo desde el panel
SELECT public.t_expect_error($$INSERT INTO public.users (club_id, full_name, role, username, pin_hash) VALUES ('c0000000-0000-0000-0000-00000000000a','Nuevo','cashier','nuevo','x')$$, 'permission denied');
SELECT public.t_expect_error($$UPDATE public.users SET role = 'club_admin'$$, 'permission denied');
SELECT public.t_expect_error($$INSERT INTO public.sales (id, club_id, cash_register_id, cash_shift_id, cashier_user_id, ticket_number, total, created_at_device)
   VALUES (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','X-1',1,now())$$, 'permission denied');
SELECT public.t_expect_error('UPDATE public.inventory_balances SET quantity = 999', 'permission denied');
SELECT public.t_expect_error('DELETE FROM public.products', 'permission denied');
SELECT public.t_expect_error($$INSERT INTO public.audit_log (actor_type, actor_id, action, entity_type) VALUES ('user', gen_random_uuid(), 'a.b', 'x')$$, 'permission denied');
SELECT public.t_expect_error($$INSERT INTO public.platform_admins (email, full_name) VALUES ('otro@test.com','Otro')$$, 'permission denied');

-- Precios: los cambia y queda auditado con el valor anterior y el nuevo
UPDATE public.products SET price = 5500 WHERE id = '40000000-0000-0000-0000-000000000001';
DO $$ BEGIN
  ASSERT (SELECT price FROM public.products WHERE id='40000000-0000-0000-0000-000000000001') = 5500, 'Ana debe poder cambiar precios';
  ASSERT (SELECT count(*) FROM public.audit_log WHERE action='product.updated' AND actor_type='platform_admin'
            AND details -> 'price' ->> 'from' = '5000.00' AND details -> 'price' ->> 'to' = '5500.00') = 1,
         'El cambio de precio se audita con valor anterior y nuevo';
  ASSERT (SELECT updated_at FROM public.products WHERE id='40000000-0000-0000-0000-000000000001') IS NOT NULL, 'updated_at se mantiene solo';
END $$;
-- Un UPDATE que no cambia nada no ensucia la auditoria
UPDATE public.products SET price = 5500 WHERE id = '40000000-0000-0000-0000-000000000001';
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.audit_log WHERE action='product.updated') = 1, 'Sin cambios reales no se audita';
END $$;

-- Alta de producto, y columnas que el panel no puede enviar
INSERT INTO public.products (club_id, name, cost, price) VALUES ('c0000000-0000-0000-0000-00000000000a','Quilmes',900,4000);
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.audit_log WHERE action='product.created' AND details ->> 'name' = 'Quilmes') = 1, 'Alta de producto auditada';
END $$;
SELECT public.t_expect_error($$UPDATE public.products SET club_id = 'c0000000-0000-0000-0000-00000000000b'$$, 'permission denied');
SELECT public.t_expect_error($$UPDATE public.products SET created_at = now()$$, 'permission denied');
SELECT public.t_expect_error($$INSERT INTO public.products (club_id, name, price) VALUES ('c0000000-0000-0000-0000-00000000000b','Colado',1)$$, 'row-level security');
SELECT public.t_expect_error($$INSERT INTO public.products (club_id, name, price) VALUES ('c0000000-0000-0000-0000-00000000000a','corona',1)$$, 'uq_products_club_name');
-- Productos de otro club: ni se ven, ni se tocan
DO $$
DECLARE n integer;
BEGIN
  UPDATE public.products SET price = 99 WHERE id = '40000000-0000-0000-0000-00000000000b';
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'Ana NO debe poder modificar productos de otro club';
END $$;

-- Stock: ajustes manuales si, y quedan firmados con su autor
INSERT INTO public.inventory_movements (club_id, location_id, product_id, movement_type, quantity, note)
VALUES ('c0000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a','40000000-0000-0000-0000-000000000001','adjustment',3,'conteo fisico');
DO $$ BEGIN
  ASSERT (SELECT quantity FROM public.inventory_balances WHERE product_id='40000000-0000-0000-0000-000000000001') = 4, 'El ajuste suma al saldo (1 + 3)';
  ASSERT (SELECT actor_type FROM public.inventory_movements WHERE movement_type='adjustment') = 'platform_admin', 'El ajuste queda firmado (tipo)';
  ASSERT (SELECT actor_id FROM public.inventory_movements WHERE movement_type='adjustment') = 'a0000000-0000-0000-0000-000000000001', 'El ajuste queda firmado (quien)';
END $$;
-- no puede firmar a nombre de otro, ni inventar ventas, ni cargar en otro club
SELECT public.t_expect_error($$INSERT INTO public.inventory_movements (club_id, location_id, product_id, movement_type, quantity, actor_type, actor_id)
   VALUES ('c0000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a','40000000-0000-0000-0000-000000000001','adjustment',1,'user','30000000-0000-0000-0000-000000000004')$$, 'permission denied');
SELECT public.t_expect_error($$INSERT INTO public.inventory_movements (club_id, location_id, product_id, movement_type, quantity, sale_item_id)
   VALUES ('c0000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a','40000000-0000-0000-0000-000000000001','sale',-1,gen_random_uuid())$$, 'permission denied');
SELECT public.t_expect_error($$INSERT INTO public.inventory_movements (club_id, location_id, product_id, movement_type, quantity)
   VALUES ('c0000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a','40000000-0000-0000-0000-000000000001','sale',-1)$$, 'movimientos manuales');
SELECT public.t_expect_error($$INSERT INTO public.inventory_movements (club_id, location_id, product_id, movement_type, quantity)
   VALUES ('c0000000-0000-0000-0000-00000000000b','10000000-0000-0000-0000-00000000000b','40000000-0000-0000-0000-00000000000b','adjustment',5)$$, 'row-level security');

-- Cajas y ubicaciones
INSERT INTO public.inventory_locations (club_id, name, kind) VALUES ('c0000000-0000-0000-0000-00000000000a','Barra VIP','bar');
UPDATE public.cash_registers SET name = 'Caja principal' WHERE id = '20000000-0000-0000-0000-000000000001';
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.audit_log WHERE action='inventory_location.created') = 1, 'Alta de ubicacion auditada';
  ASSERT (SELECT count(*) FROM public.audit_log WHERE action='cash_register.updated') = 1, 'Cambio de caja auditado';
END $$;
-- una caja no puede apuntar a una ubicacion de otro club
SELECT public.t_expect_error($$UPDATE public.cash_registers SET inventory_location_id = '10000000-0000-0000-0000-00000000000b' WHERE id = '20000000-0000-0000-0000-000000000001'$$, 'foreign key');

-- Clubs: crea los suyos, nunca a nombre de otro administrador
-- Con RETURNING, como lo envia supabase-js con .insert().select(): la
-- fila recien creada debe poder leerse en la misma sentencia.
DO $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.clubs (name, slug, created_by_admin_id)
  VALUES ('Club nuevo de Ana','nuevo-ana','a0000000-0000-0000-0000-000000000001')
  RETURNING id INTO v_id;
  ASSERT v_id IS NOT NULL, 'Crear un club debe devolver la fila creada';
  INSERT INTO public.products (club_id, name, price) VALUES (v_id, 'Primer producto', 100) RETURNING id INTO v_id;
  ASSERT v_id IS NOT NULL, 'Se puede cargar un producto en el club recien creado';
  UPDATE public.products SET deleted_at = now() WHERE id = v_id RETURNING id INTO v_id;
  ASSERT v_id IS NOT NULL, 'El borrado logico de un producto devuelve la fila';
END $$;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.clubs) = 2, 'Ana ahora ve 2 clubs';
  ASSERT (SELECT count(*) FROM public.audit_log WHERE action='club.created' AND details ->> 'name' = 'Club nuevo de Ana') = 1, 'Alta de club auditada';
  ASSERT (SELECT business_day_start_hour FROM public.clubs WHERE slug='nuevo-ana') = 12, 'La jornada empieza a las 12 por defecto';
END $$;
SELECT public.t_expect_error($$INSERT INTO public.clubs (name, slug, created_by_admin_id) VALUES ('Falso','falso','a0000000-0000-0000-0000-000000000002')$$, 'row-level security');
SELECT public.t_expect_error($$INSERT INTO public.clubs (name, slug, created_by_admin_id, timezone) VALUES ('Marte','marte','a0000000-0000-0000-0000-000000000001','Marte/Olimpo')$$, 'Zona horaria desconocida');
SELECT public.t_expect_error($$INSERT INTO public.clubs (name, slug, created_by_admin_id) VALUES ('Mal slug','Mal Slug','a0000000-0000-0000-0000-000000000001')$$, 'clubs_slug_format');
SELECT public.t_expect_error($$UPDATE public.clubs SET business_day_start_hour = 30$$, 'clubs_business_day_start_hour_range');
SELECT public.t_expect_error($$UPDATE public.clubs SET created_by_admin_id = 'a0000000-0000-0000-0000-000000000002'$$, 'permission denied');

-- Errores de sincronizacion: los marca resueltos, no los reescribe
UPDATE public.sync_errors SET resolved_at = now(), resolved_note = 'Revisado con el encargado' WHERE id = 'e0000000-0000-0000-0000-00000000000a';
DO $$
DECLARE n integer;
BEGIN
  ASSERT (SELECT resolved_note FROM public.sync_errors WHERE id='e0000000-0000-0000-0000-00000000000a') = 'Revisado con el encargado', 'Ana resuelve errores de su club';
  UPDATE public.sync_errors SET resolved_at = now() WHERE id = 'e0000000-0000-0000-0000-00000000000b';
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'Ana no toca errores de otro club';
END $$;
SELECT public.t_expect_error($$UPDATE public.sync_errors SET error_message = 'borrado'$$, 'permission denied');
SELECT public.t_logout();

-- =====================================================================
-- LUIS: administrador del Club B
-- =====================================================================
SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a2');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.clubs) = 1 AND (SELECT name FROM public.clubs) = 'Club B', 'Luis ve solo su club';
  ASSERT (SELECT count(*) FROM public.products) = 1, 'Luis ve solo el producto del Club B';
  ASSERT (SELECT count(*) FROM public.users) = 0, 'Luis no ve usuarios del Club A';
  ASSERT (SELECT count(*) FROM public.audit_log) = 0, 'Luis no ve la auditoria del Club A';
  ASSERT (SELECT count(*) FROM public.inventory_movements) = 0, 'Luis no ve el stock del Club A';
  ASSERT (SELECT count(*) FROM public.platform_admins) = 1, 'Luis no ve la ficha de Ana';
END $$;
SELECT public.t_logout();

-- =====================================================================
-- ENCARGADO A: club_admin del Club A (entra por el panel web)
-- =====================================================================
SELECT public.t_login_as('bbbbbbbb-0000-0000-0000-0000000000b4');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.clubs) = 1 AND (SELECT name FROM public.clubs) = 'Club A', 'El encargado ve solo su club';
  ASSERT (SELECT count(*) FROM public.products) = 3, 'El encargado ve los productos de su club';
  ASSERT (SELECT count(*) FROM public.platform_admins) = 0, 'El encargado no ve administradores';
  ASSERT public.can_manage_club('c0000000-0000-0000-0000-00000000000a'), 'El encargado gestiona su club';
END $$;
UPDATE public.products SET price = 5600 WHERE id = '40000000-0000-0000-0000-000000000001';
DO $$
DECLARE n integer;
BEGIN
  ASSERT (SELECT count(*) FROM public.audit_log WHERE action='product.updated' AND actor_type='user'
            AND actor_id='30000000-0000-0000-0000-000000000004' AND details -> 'price' ->> 'to' = '5600.00') = 1,
         'El cambio del encargado se audita a su nombre';
  -- un encargado no edita los datos del club (eso es del administrador)
  UPDATE public.clubs SET name = 'Tomado';
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'El encargado NO puede editar el club';
END $$;
SELECT public.t_expect_error($$INSERT INTO public.clubs (name, slug, created_by_admin_id) VALUES ('X','x','a0000000-0000-0000-0000-000000000001')$$, 'row-level security');
SELECT public.t_logout();

-- =====================================================================
-- DESCONOCIDO: tiene sesion pero no es administrador ni usuario
-- =====================================================================
SELECT public.t_login_as('cccccccc-0000-0000-0000-000000000099');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.clubs) = 0, 'Un desconocido no ve clubs';
  ASSERT (SELECT count(*) FROM public.products) = 0, 'Un desconocido no ve productos';
  ASSERT (SELECT count(*) FROM public.v_club_daily_stats) = 0, 'Un desconocido no ve estadisticas';
  ASSERT NOT public.can_manage_club('c0000000-0000-0000-0000-00000000000a'), 'Un desconocido no gestiona nada';
END $$;
SELECT public.t_expect_error($$INSERT INTO public.products (club_id, name, price) VALUES ('c0000000-0000-0000-0000-00000000000a','Colado',1)$$, 'row-level security');
SELECT public.t_logout();

-- =====================================================================
-- ANONIMO: sin sesion
-- =====================================================================
SET LOCAL ROLE anon;
SELECT public.t_expect_error('SELECT * FROM public.clubs', 'permission denied');
SELECT public.t_expect_error('SELECT * FROM public.products', 'permission denied');
SELECT public.t_expect_error('SELECT * FROM public.taxes', 'permission denied');
SELECT public.t_expect_error('SELECT * FROM public.payment_methods', 'permission denied');
SELECT public.t_expect_error('SELECT * FROM public.v_club_daily_stats', 'permission denied');
SELECT public.t_expect_error($$SELECT public.can_manage_club('c0000000-0000-0000-0000-00000000000a')$$, 'permission denied');
SELECT public.t_expect_error($$SELECT * FROM public.product_tax_preview('c0000000-0000-0000-0000-00000000000a', 1, 1)$$, 'permission denied');
SELECT public.t_expect_error('SELECT private.visible_club_ids()', 'permission denied');
RESET ROLE;

-- =====================================================================
-- EDGE FUNCTIONS (service_role): pueden lo que el panel no
-- =====================================================================
SELECT public.t_as_service();
INSERT INTO public.users (club_id, full_name, role, username, pin_hash)
VALUES ('c0000000-0000-0000-0000-00000000000a','Cajero nuevo','cashier','nuevo','$2b$hash');
UPDATE public.users SET failed_attempts = failed_attempts + 1 WHERE username = 'nuevo';
DO $$ BEGIN
  ASSERT (SELECT failed_attempts FROM public.users WHERE username='nuevo') = 1, 'pos-login lleva la cuenta de intentos';
END $$;
-- reglas que valen tambien para service_role (son de la base, no de permisos)
SELECT public.t_expect_error($$UPDATE public.users SET club_id = 'c0000000-0000-0000-0000-00000000000b' WHERE username = 'nuevo'$$, 'otro club');
SELECT public.t_expect_error($$UPDATE public.products SET club_id = 'c0000000-0000-0000-0000-00000000000b'$$, 'otro club');
SELECT public.t_expect_error($$INSERT INTO public.users (club_id, full_name, role, username) VALUES ('c0000000-0000-0000-0000-00000000000a','Sin PIN','cashier','sinpin')$$, 'users_login_check');
SELECT public.t_expect_error($$INSERT INTO public.users (club_id, full_name, role, username, pin_hash) VALUES ('c0000000-0000-0000-0000-00000000000a','Otro Juan','cashier','juan','x')$$, 'uq_users_club_username');
SELECT public.t_expect_error($$INSERT INTO public.users (club_id, full_name, role, username, pin_hash) VALUES ('c0000000-0000-0000-0000-00000000000a','Mayus','cashier','JUAN','x')$$, 'users_username_format');
SELECT public.t_expect_error($$INSERT INTO public.users (club_id, full_name, role, email) VALUES ('c0000000-0000-0000-0000-00000000000a','Falso','club_admin','ana@test.com')$$, 'ya pertenece a un administrador');
SELECT public.t_expect_error($$INSERT INTO public.platform_admins (email, full_name) VALUES ('encargado@test.com','Falso')$$, 'ya pertenece a un usuario');
SELECT public.t_expect_error($$INSERT INTO public.users (club_id, full_name, role, username, pin_hash) VALUES ('c0000000-0000-0000-0000-00000000000a','Rol raro','jefe','jefe1','x')$$, 'violates check constraint');
SELECT public.t_expect_error($$INSERT INTO public.clubs (name, slug) VALUES ('Huerfano','huerfano')$$, 'created_by_admin_id');
-- "juan" puede existir en otro club
INSERT INTO public.users (club_id, full_name, role, username, pin_hash)
VALUES ('c0000000-0000-0000-0000-00000000000b','Juan B','cashier','juan','$2b$hash');
SELECT public.t_logout();

ROLLBACK;
