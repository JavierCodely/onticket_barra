-- PRUEBA 050: estado del personal desde el panel (archivo 10).
-- El panel ve si alguien esta bloqueado, pero nunca los contadores, y
-- solo del club que gestiona.
BEGIN;
\ir fixture.sql

-- Pedro (Club A) bloqueado hasta dentro de una hora; Maria con un bloqueo
-- ya vencido; Juan con intentos fallidos pero sin bloqueo.
UPDATE public.users SET locked_until = now() + interval '1 hour', failed_attempts = 5
 WHERE id = '30000000-0000-0000-0000-000000000003';
UPDATE public.users SET locked_until = now() - interval '1 minute', failed_attempts = 5
 WHERE id = '30000000-0000-0000-0000-000000000002';
UPDATE public.users SET failed_attempts = 3
 WHERE id = '30000000-0000-0000-0000-000000000001';
-- Una persona del Club B, para comprobar el aislamiento
INSERT INTO public.users (id, club_id, full_name, role, username, pin_hash, locked_until) VALUES
    ('30000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-00000000000b', 'Bruno', 'cashier', 'bruno', '$hash', now() + interval '1 hour');

-- =====================================================================
-- Ana, administradora del Club A
-- =====================================================================
SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a1');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.club_staff_status('c0000000-0000-0000-0000-00000000000a')) = 4,
         'Ana ve el estado de las 4 personas del Club A';
  ASSERT (SELECT is_locked FROM public.club_staff_status('c0000000-0000-0000-0000-00000000000a')
           WHERE user_id = '30000000-0000-0000-0000-000000000003'), 'Pedro figura bloqueado';
  ASSERT NOT (SELECT is_locked FROM public.club_staff_status('c0000000-0000-0000-0000-00000000000a')
               WHERE user_id = '30000000-0000-0000-0000-000000000002'), 'Un bloqueo vencido ya no cuenta';
  ASSERT NOT (SELECT is_locked FROM public.club_staff_status('c0000000-0000-0000-0000-00000000000a')
               WHERE user_id = '30000000-0000-0000-0000-000000000001'), 'Intentos fallidos sin bloqueo no es bloqueo';
  ASSERT NOT (SELECT is_locked FROM public.club_staff_status('c0000000-0000-0000-0000-00000000000a')
               WHERE user_id = '30000000-0000-0000-0000-000000000004'), 'Sin locked_until no esta bloqueado';
  ASSERT (SELECT count(*) FROM public.club_staff_status('c0000000-0000-0000-0000-00000000000b')) = 0,
         'Ana NO ve el estado del personal del Club B';
END $$;

-- La funcion solo devuelve (user_id, is_locked): nada de contadores
DO $$ BEGIN
  ASSERT (SELECT array_agg(a ORDER BY a)
            FROM unnest((SELECT proargnames FROM pg_proc
                          WHERE oid = 'public.club_staff_status(uuid)'::regprocedure)) a)
         = ARRAY['is_locked', 'p_club_id', 'user_id'],
         'club_staff_status expone columnas de mas';
END $$;

-- Los secretos siguen cerrados en la tabla
SELECT public.t_expect_error('SELECT locked_until FROM public.users', 'permission denied');
SELECT public.t_expect_error('SELECT failed_attempts FROM public.users', 'permission denied');
SELECT public.t_logout();

-- =====================================================================
-- Luis, administrador del Club B: ve solo el suyo
-- =====================================================================
SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a2');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.club_staff_status('c0000000-0000-0000-0000-00000000000a')) = 0,
         'Luis NO ve el estado del personal del Club A';
  ASSERT (SELECT count(*) FROM public.club_staff_status('c0000000-0000-0000-0000-00000000000b')) = 1
         AND (SELECT is_locked FROM public.club_staff_status('c0000000-0000-0000-0000-00000000000b')),
         'Luis ve a Bruno bloqueado';
END $$;
SELECT public.t_logout();

-- =====================================================================
-- Encargado del Club A (club_admin por web): ve su club
-- =====================================================================
SELECT public.t_login_as('bbbbbbbb-0000-0000-0000-0000000000b4');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.club_staff_status('c0000000-0000-0000-0000-00000000000a')) = 4,
         'El encargado ve el estado del personal de su club';
  ASSERT (SELECT count(*) FROM public.club_staff_status('c0000000-0000-0000-0000-00000000000b')) = 0,
         'El encargado NO ve otro club';
END $$;
SELECT public.t_logout();

-- =====================================================================
-- Un usuario logueado sin club y anon: nada
-- =====================================================================
SELECT public.t_login_as('cccccccc-0000-0000-0000-000000000099');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.club_staff_status('c0000000-0000-0000-0000-00000000000a')) = 0,
         'Un usuario sin club no ve nada';
END $$;
SELECT public.t_logout();

SET LOCAL ROLE anon;
SELECT public.t_expect_error($$SELECT * FROM public.club_staff_status('c0000000-0000-0000-0000-00000000000a')$$,
                             'permission denied');
RESET ROLE;

ROLLBACK;
