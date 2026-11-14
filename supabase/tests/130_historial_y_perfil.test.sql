-- PRUEBA 130: perfil del administrador e historial de cambios (archivo 19).
-- Perfil: nombre, apellido y telefono propios, full_name armado por la
-- base, columnas fijas, auditoria sin telefono. Nombres: el encargado ve
-- solo el nombre del administrador de su club. Historial: auditoria,
-- stock manual y cambio en efectivo con quien y cuando; dias en la zona
-- horaria del club; conteo por dia; limite; aislamiento; anon.
BEGIN;
\ir fixture.sql

-- ---- A) Perfil -------------------------------------------------------
SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a1');   -- Ana
UPDATE public.platform_admins
   SET first_name = '  Ana ', last_name = 'Perez', phone = '+54 9 11 5555-0000'
 WHERE id = 'a0000000-0000-0000-0000-000000000001'
RETURNING full_name, first_name, phone;
DO $$ BEGIN
    ASSERT (SELECT full_name FROM public.platform_admins WHERE id = 'a0000000-0000-0000-0000-000000000001') = 'Ana Perez',
           'full_name = nombre + apellido (sin espacios de mas)';
END $$;
SELECT public.t_expect_error($$UPDATE public.platform_admins SET phone = 'llamame' WHERE id = 'a0000000-0000-0000-0000-000000000001'$$,
    'platform_admins_phone_check');
-- Solo nombre, apellido y telefono: ni email, ni activo, ni el usuario de Auth, ni full_name a mano
SELECT public.t_expect_error($$UPDATE public.platform_admins SET email = 'otra@test.com'$$, 'permission denied');
SELECT public.t_expect_error($$UPDATE public.platform_admins SET active = false$$, 'permission denied');
SELECT public.t_expect_error($$UPDATE public.platform_admins SET auth_user_id = NULL$$, 'permission denied');
SELECT public.t_expect_error($$UPDATE public.platform_admins SET full_name = 'Otra'$$, 'permission denied');
-- La ficha de Luis no se toca (no la ve)
UPDATE public.platform_admins SET first_name = 'Hackeado' WHERE id = 'a0000000-0000-0000-0000-000000000002';
SELECT public.t_logout();
DO $$ BEGIN
    ASSERT (SELECT full_name FROM public.platform_admins WHERE id = 'a0000000-0000-0000-0000-000000000002') = 'Luis',
           'Ana no cambia la ficha de Luis';
    ASSERT EXISTS (SELECT 1 FROM public.audit_log
                    WHERE action = 'platform_admin.updated' AND actor_id = 'a0000000-0000-0000-0000-000000000001'
                      AND details -> 'full_name' ->> 'to' = 'Ana Perez' AND (details ->> 'phone_changed')::boolean),
           'El cambio de perfil queda auditado';
    ASSERT NOT EXISTS (SELECT 1 FROM public.audit_log WHERE details::text LIKE '%5555%'),
           'La auditoria nunca guarda el telefono';
END $$;

-- El encargado no ve ni cambia fichas de administradores
SELECT public.t_login_as('bbbbbbbb-0000-0000-0000-0000000000b4');
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM public.platform_admins) = 0, 'El encargado no ve fichas de administradores';
END $$;
UPDATE public.platform_admins SET first_name = 'X';
SELECT public.t_logout();
DO $$ BEGIN
    ASSERT (SELECT first_name FROM public.platform_admins WHERE id = 'a0000000-0000-0000-0000-000000000001') = 'Ana',
           'El encargado no cambio la ficha de Ana';
END $$;


-- ---- B) Nombre del administrador del club ----------------------------
SELECT public.t_login_as('bbbbbbbb-0000-0000-0000-0000000000b4');   -- Encargado del club A
DO $$ BEGIN
    ASSERT (SELECT full_name FROM public.club_admin_names('c0000000-0000-0000-0000-00000000000a')) = 'Ana Perez',
           'El encargado ve el nombre del administrador de su club';
    ASSERT (SELECT count(*) FROM public.club_admin_names('c0000000-0000-0000-0000-00000000000b')) = 0,
           'Del club B no ve nada';
END $$;
SELECT public.t_logout();
SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a2');   -- Luis
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM public.club_admin_names('c0000000-0000-0000-0000-00000000000a')) = 0,
           'Luis no ve el nombre del administrador del club A';
END $$;
SELECT public.t_logout();
DO $$ BEGIN
    -- Solo id y nombre: nunca email ni telefono
    ASSERT (SELECT array_agg(a ORDER BY a) FROM unnest((SELECT proargnames FROM pg_proc
             WHERE oid = 'public.club_admin_names(uuid)'::regprocedure)) a WHERE a <> 'p_club_id')
           = ARRAY['admin_id', 'full_name'], 'club_admin_names devuelve solo id y nombre';
END $$;


-- ---- C) Historial ----------------------------------------------------
-- Ana: cambia un precio, carga stock, inicia la noche y agrega cambio
SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a1');
UPDATE public.products SET price = 5500 WHERE id = '40000000-0000-0000-0000-000000000001';
INSERT INTO public.inventory_movements (club_id, location_id, product_id, movement_type, quantity, note) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000002', 'purchase', 24, 'Proveedor');
INSERT INTO public.club_nights (club_id) VALUES ('c0000000-0000-0000-0000-00000000000a') RETURNING id;
INSERT INTO public.cash_register_floats (club_id, night_id, cash_register_id, kind, amount)
SELECT 'c0000000-0000-0000-0000-00000000000a', n.id, '20000000-0000-0000-0000-000000000001', 'top_up', 20000
  FROM public.club_nights n WHERE n.club_id = 'c0000000-0000-0000-0000-00000000000a' AND n.ended_at IS NULL;
SELECT public.t_logout();

-- Como duenio: dos entradas viejas, a cada lado de la medianoche LOCAL
-- (el club esta en America/Argentina/Buenos_Aires, UTC-3)
INSERT INTO public.audit_log (club_id, actor_type, actor_id, action, entity_type, entity_id, details, created_at) VALUES
    ('c0000000-0000-0000-0000-00000000000a', 'platform_admin', 'a0000000-0000-0000-0000-000000000001', 'tax.updated', 'tax', NULL, '{}',
     '2026-01-14 23:30-03'),   -- 02:30 UTC del 15, pero el 14 en el club
    ('c0000000-0000-0000-0000-00000000000a', 'platform_admin', 'a0000000-0000-0000-0000-000000000001', 'tax.updated', 'tax', NULL, '{}',
     '2026-01-15 00:30-03'),
    ('c0000000-0000-0000-0000-00000000000b', 'platform_admin', 'a0000000-0000-0000-0000-000000000002', 'tax.updated', 'tax', NULL, '{}',
     '2026-01-15 00:30-03');

CREATE TEMP TABLE t_hoy AS
SELECT (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS dia;
GRANT SELECT ON t_hoy TO authenticated;

SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a1');
DO $$
DECLARE
    v_hoy date := (SELECT dia FROM t_hoy);
    c CONSTANT uuid := 'c0000000-0000-0000-0000-00000000000a';
BEGIN
    ASSERT EXISTS (SELECT 1 FROM public.club_activity(c, v_hoy, v_hoy)
                    WHERE action = 'product.updated' AND entity_name = 'Corona' AND actor_name = 'Ana Perez'
                      AND (details -> 'price' ->> 'to')::numeric = 5500 AND local_date = v_hoy),
           'El cambio de precio aparece con producto, quien y el precio nuevo';
    ASSERT EXISTS (SELECT 1 FROM public.club_activity(c, v_hoy, v_hoy)
                    WHERE action = 'stock.purchase' AND entity_name = 'Heineken'
                      AND (details ->> 'quantity')::int = 24 AND details ->> 'note' = 'Proveedor' AND actor_type = 'platform_admin'),
           'La compra de stock aparece con producto, cantidad y nota';
    ASSERT (SELECT count(*) FROM public.club_activity(c, v_hoy, v_hoy) WHERE action LIKE 'stock.%') = 1,
           'Los movimientos sin autor (carga inicial del duenio, ventas del posnet) no aparecen';
    ASSERT EXISTS (SELECT 1 FROM public.club_activity(c, v_hoy, v_hoy) WHERE action = 'night.started'),
           'Iniciar la noche aparece';
    ASSERT EXISTS (SELECT 1 FROM public.club_activity(c, v_hoy, v_hoy)
                    WHERE action = 'cash_float.top_up' AND entity_name = 'Caja 1' AND (details ->> 'amount')::numeric = 20000),
           'El refuerzo de cambio aparece con la caja y el monto';

    -- Dias en la zona horaria del club
    ASSERT (SELECT array_agg(row(day, changes)::text ORDER BY day)
              FROM public.club_activity_by_day(c, '2026-01-14', '2026-01-15'))
           = ARRAY[row(DATE '2026-01-14', 1::bigint)::text, row(DATE '2026-01-15', 1::bigint)::text],
           'Un cambio por dia: las 23:30 del 14 son del 14 aunque en UTC ya sea el 15';
    ASSERT (SELECT count(*) FROM public.club_activity(c, '2026-01-15', '2026-01-15')) = 1,
           'El dia 15 tiene un solo cambio (el del club B no se cuenta)';
    ASSERT (SELECT changes FROM public.club_activity_by_day(c, v_hoy, v_hoy)) >= 4,
           'Hoy cuenta al menos los 4 cambios de Ana';
    ASSERT (SELECT count(*) FROM public.club_activity_by_day(c, '2024-01-01', '2026-01-15')) = 0,
           'Mas de 400 dias: no devuelve nada';

    -- Orden y limite
    ASSERT (SELECT count(*) FROM public.club_activity(c, '2026-01-01', v_hoy, 2)) = 2, 'Respeta el limite';
    ASSERT (SELECT local_date FROM public.club_activity(c, '2026-01-01', v_hoy, 1)) = v_hoy, 'Lo mas nuevo primero';
END $$;
SELECT public.t_logout();

-- El encargado ve el historial de su club; el nombre de Ana lo saca de club_admin_names
SELECT public.t_login_as('bbbbbbbb-0000-0000-0000-0000000000b4');
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM public.club_activity('c0000000-0000-0000-0000-00000000000a', '2026-01-14', '2026-01-15')) = 2,
           'El encargado ve el historial de su club';
    ASSERT (SELECT actor_name FROM public.club_activity('c0000000-0000-0000-0000-00000000000a', '2026-01-15', '2026-01-15')) IS NULL,
           'En la vista no lee el nombre del administrador (no ve platform_admins)';
    ASSERT (SELECT count(*) FROM public.club_activity('c0000000-0000-0000-0000-00000000000b', '2026-01-15', '2026-01-15')) = 0,
           'Del club B no ve nada';
END $$;
SELECT public.t_logout();

-- Luis no ve el historial del club A
SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a2');
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM public.club_activity('c0000000-0000-0000-0000-00000000000a', '2026-01-01', (SELECT dia FROM t_hoy))) = 0,
           'Luis no ve el historial del club A';
    ASSERT (SELECT count(*) FROM public.club_activity_by_day('c0000000-0000-0000-0000-00000000000a', '2026-01-01', (SELECT dia FROM t_hoy))) = 0,
           'Ni su conteo por dia';
    ASSERT (SELECT count(*) FROM public.v_club_activity WHERE club_id = 'c0000000-0000-0000-0000-00000000000a') = 0,
           'Ni la vista';
END $$;
SELECT public.t_logout();

SET LOCAL ROLE anon;
SELECT public.t_expect_error('SELECT * FROM public.v_club_activity', 'permission denied');
SELECT public.t_expect_error($$SELECT * FROM public.club_activity('c0000000-0000-0000-0000-00000000000a', '2026-01-01', '2026-01-31')$$, 'permission denied');
SELECT public.t_expect_error($$SELECT * FROM public.club_activity_by_day('c0000000-0000-0000-0000-00000000000a', '2026-01-01', '2026-01-31')$$, 'permission denied');
SELECT public.t_expect_error($$SELECT * FROM public.club_admin_names('c0000000-0000-0000-0000-00000000000a')$$, 'permission denied');
RESET ROLE;

ROLLBACK;
