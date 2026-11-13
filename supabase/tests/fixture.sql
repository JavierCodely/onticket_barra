-- Datos y ayudas comunes de las pruebas. Cada prueba lo incluye DENTRO
-- de su transaccion (BEGIN ... ROLLBACK): no deja nada en la base.
--
--   Ana  (admin, auth ...0a1) -> Club A        Luis (admin, auth ...0a2) -> Club B
--   Club A: Barra A y Deposito A; Caja 1 y Caja 2 (venden desde Barra A);
--           juan y maria (cajeros), pedro (barra),
--           Encargado A (club_admin por web, auth ...0b4);
--           Corona   (costo 1000, precio 5000)  stock inicial 1
--           Heineken (costo 2000, precio 6000)  stock inicial 10
--           un turno abierto por caja.
--   Club B: Barra B y un producto propio.

-- ---- Ayudas ----------------------------------------------------------
-- Ejecuta p_sql y exige que falle con un mensaje que contenga p_fragment.
CREATE FUNCTION public.t_expect_error(p_sql text, p_fragment text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        IF position(lower(p_fragment) IN lower(SQLERRM)) = 0 THEN
            RAISE EXCEPTION 'Error inesperado. Se esperaba "%" y fue: %', p_fragment, SQLERRM;
        END IF;
        RETURN;
    END;
    RAISE EXCEPTION 'DEBIA FALLAR y no fallo: %', p_sql;
END;
$$;

-- Devuelve el SQLSTATE con que falla p_sql ('00000' si no falla).
CREATE FUNCTION public.t_sqlstate(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN '00000';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
END;
$$;

-- Simula una sesion del panel web (rol authenticated + JWT con ese sub).
CREATE FUNCTION public.t_login_as(p_auth_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', p_auth_uid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
END;
$$;

-- Simula una Edge Function (clave secreta -> rol service_role, sin usuario).
CREATE FUNCTION public.t_as_service() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    SET LOCAL ROLE service_role;
END;
$$;

-- Vuelve al rol que corre las pruebas (dueno de la base).
CREATE FUNCTION public.t_logout() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
END;
$$;

-- ---- Datos -----------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
    ('aaaaaaaa-0000-0000-0000-0000000000a1', 'ana@test.com'),
    ('aaaaaaaa-0000-0000-0000-0000000000a2', 'luis@test.com'),
    ('bbbbbbbb-0000-0000-0000-0000000000b4', 'encargado@test.com'),
    ('cccccccc-0000-0000-0000-000000000099', 'desconocido@test.com');

INSERT INTO public.platform_admins (id, email, full_name, auth_user_id) VALUES
    ('a0000000-0000-0000-0000-000000000001', 'ana@test.com',  'Ana',  'aaaaaaaa-0000-0000-0000-0000000000a1'),
    ('a0000000-0000-0000-0000-000000000002', 'luis@test.com', 'Luis', 'aaaaaaaa-0000-0000-0000-0000000000a2');

INSERT INTO public.clubs (id, name, slug, created_by_admin_id) VALUES
    ('c0000000-0000-0000-0000-00000000000a', 'Club A', 'club-a', 'a0000000-0000-0000-0000-000000000001'),
    ('c0000000-0000-0000-0000-00000000000b', 'Club B', 'club-b', 'a0000000-0000-0000-0000-000000000002');

INSERT INTO public.inventory_locations (id, club_id, name, kind) VALUES
    ('10000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', 'Barra A',    'bar'),
    ('10000000-0000-0000-0000-0000000000ad', 'c0000000-0000-0000-0000-00000000000a', 'Deposito A', 'storage'),
    ('10000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-00000000000b', 'Barra B',    'bar');

INSERT INTO public.cash_registers (id, club_id, name, inventory_location_id) VALUES
    ('20000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000a', 'Caja 1', '10000000-0000-0000-0000-00000000000a'),
    ('20000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000000a', 'Caja 2', '10000000-0000-0000-0000-00000000000a');

INSERT INTO public.users (id, club_id, full_name, role, username, pin_hash, email, auth_user_id) VALUES
    ('30000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000a', 'Juan',  'cashier',   'juan',  '$hash', NULL, NULL),
    ('30000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000000a', 'Maria', 'cashier',   'maria', '$hash', NULL, NULL),
    ('30000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-00000000000a', 'Pedro', 'bartender', 'pedro', '$hash', NULL, NULL),
    ('30000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-00000000000a', 'Encargado A', 'club_admin', NULL, NULL,
        'encargado@test.com', 'bbbbbbbb-0000-0000-0000-0000000000b4');

INSERT INTO public.products (id, club_id, name, cost, price) VALUES
    ('40000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000a', 'Corona',   1000, 5000),
    ('40000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000000a', 'Heineken', 2000, 6000),
    ('40000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-00000000000b', 'Producto de B', 1, 2);

INSERT INTO public.cash_shifts (id, club_id, cash_register_id, opened_by_user_id, opened_at) VALUES
    ('50000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '2026-11-06 22:00-03'),
    ('50000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '2026-11-06 22:00-03');

INSERT INTO public.inventory_movements (club_id, location_id, product_id, movement_type, quantity) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', 'initial', 1),
    ('c0000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000002', 'initial', 10);
