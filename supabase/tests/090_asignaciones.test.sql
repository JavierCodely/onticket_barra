-- PRUEBA 090: asignacion de personal a una caja (cajero) o a una barra
-- (bartender). Una por persona; el destino corresponde al rol; aislamiento
-- entre clubs; auditoria; al cambiar el rol la asignacion vieja se borra.
BEGIN;
\ir fixture.sql

SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a1');   -- Ana, club A

-- Juan (cajero) a la Caja 1; Pedro (barra) a la Barra A
INSERT INTO public.staff_assignments (club_id, user_id, cash_register_id) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001')
RETURNING id;
INSERT INTO public.staff_assignments (club_id, user_id, location_id) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-00000000000a')
RETURNING id;

-- Una sola asignacion por persona
SELECT public.t_expect_error($$INSERT INTO public.staff_assignments (club_id, user_id, cash_register_id) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002')$$,
    'staff_assignments_one_per_user');
-- Caja y barra a la vez, o ninguna: no
SELECT public.t_expect_error($$INSERT INTO public.staff_assignments (club_id, user_id, cash_register_id, location_id) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a')$$,
    'staff_assignments_one_target');
SELECT public.t_expect_error($$INSERT INTO public.staff_assignments (club_id, user_id) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000002')$$,
    'A un cajero se le asigna una caja');
-- El destino corresponde al rol
SELECT public.t_expect_error($$INSERT INTO public.staff_assignments (club_id, user_id, location_id) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a')$$,
    'A un cajero se le asigna una caja');
SELECT public.t_expect_error($$UPDATE public.staff_assignments SET location_id = NULL, cash_register_id = '20000000-0000-0000-0000-000000000002'
    WHERE user_id = '30000000-0000-0000-0000-000000000003'$$, 'A la barra se le asigna una barra');
-- Un deposito no es una barra
SELECT public.t_expect_error($$UPDATE public.staff_assignments SET location_id = '10000000-0000-0000-0000-0000000000ad'
    WHERE user_id = '30000000-0000-0000-0000-000000000003'$$, 'no es una barra activa');
-- El encargado no se asigna
SELECT public.t_expect_error($$INSERT INTO public.staff_assignments (club_id, user_id, cash_register_id) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002')$$,
    'El encargado no se asigna');
-- Ni la barra de otro club (la frena la regla, y si no, la clave compuesta)
SELECT public.t_expect_error($$UPDATE public.staff_assignments SET location_id = '10000000-0000-0000-0000-00000000000b'
    WHERE user_id = '30000000-0000-0000-0000-000000000003'$$, 'no es una barra activa');
-- La asignacion no cambia de persona ni de club
SELECT public.t_expect_error($$UPDATE public.staff_assignments SET user_id = '30000000-0000-0000-0000-000000000002'
    WHERE user_id = '30000000-0000-0000-0000-000000000001'$$, 'permission denied');
SELECT public.t_expect_error($$UPDATE public.staff_assignments SET club_id = 'c0000000-0000-0000-0000-00000000000b'$$, 'permission denied');

-- Cambiar de caja y quitar
UPDATE public.staff_assignments SET cash_register_id = '20000000-0000-0000-0000-000000000002'
 WHERE user_id = '30000000-0000-0000-0000-000000000001';
DELETE FROM public.staff_assignments WHERE user_id = '30000000-0000-0000-0000-000000000003';
DO $$ BEGIN
    ASSERT (SELECT cash_register_id FROM public.staff_assignments WHERE user_id = '30000000-0000-0000-0000-000000000001')
           = '20000000-0000-0000-0000-000000000002', 'Juan paso a la Caja 2';
    ASSERT (SELECT count(*) FROM public.staff_assignments WHERE user_id = '30000000-0000-0000-0000-000000000003') = 0,
           'A Pedro se le quito la barra';
    ASSERT (SELECT array_agg(action ORDER BY created_at, action) FROM public.audit_log WHERE entity_type = 'user'
             AND action LIKE 'staff_assignment.%')
           @> ARRAY['staff_assignment.assigned', 'staff_assignment.changed', 'staff_assignment.removed'],
           'Asignar, cambiar y quitar quedan auditados';
END $$;
SELECT public.t_logout();

-- Una caja inactiva no se asigna
UPDATE public.cash_registers SET active = false WHERE id = '20000000-0000-0000-0000-000000000001';
SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a1');
SELECT public.t_expect_error($$UPDATE public.staff_assignments SET cash_register_id = '20000000-0000-0000-0000-000000000001'
    WHERE user_id = '30000000-0000-0000-0000-000000000001'$$, 'La caja no esta activa');
SELECT public.t_logout();

-- Luis (club B) no ve, no cambia, no borra ni asigna en el club A
SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a2');
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM public.staff_assignments) = 0, 'Luis no ve asignaciones del club A';
END $$;
UPDATE public.staff_assignments SET cash_register_id = '20000000-0000-0000-0000-000000000001';
DELETE FROM public.staff_assignments;
SELECT public.t_expect_error($$INSERT INTO public.staff_assignments (club_id, user_id, cash_register_id) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002')$$,
    'La persona no existe en este club');   -- por RLS no ve al personal ajeno (y si no, lo frena la politica)
SELECT public.t_logout();
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM public.staff_assignments) = 1, 'La asignacion de Juan sigue intacta';
END $$;

-- El encargado del club A tambien asigna
SELECT public.t_login_as('bbbbbbbb-0000-0000-0000-0000000000b4');
INSERT INTO public.staff_assignments (club_id, user_id, cash_register_id) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002');
SELECT public.t_logout();

-- Si cambia el rol (Edge Function = service_role), la asignacion vieja se borra
SELECT public.t_as_service();
UPDATE public.users SET role = 'bartender' WHERE id = '30000000-0000-0000-0000-000000000002';
UPDATE public.users SET full_name = 'Juan Perez' WHERE id = '30000000-0000-0000-0000-000000000001';
SELECT public.t_logout();
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM public.staff_assignments WHERE user_id = '30000000-0000-0000-0000-000000000002') = 0,
           'Maria paso a barra: se le quito la caja';
    ASSERT (SELECT count(*) FROM public.staff_assignments WHERE user_id = '30000000-0000-0000-0000-000000000001') = 1,
           'Cambiar solo el nombre no toca la asignacion';
END $$;

SET LOCAL ROLE anon;
SELECT public.t_expect_error('SELECT * FROM public.staff_assignments', 'permission denied');
RESET ROLE;

ROLLBACK;
