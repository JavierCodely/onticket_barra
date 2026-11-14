-- PRUEBA 100: precio de un producto por barra (archivo 16).
-- Una caja cobra el precio de su barra, o el general si no hay; solo en
-- barras; uno por producto y barra; no cambia de producto, barra ni club;
-- auditoria; aislamiento entre clubs; encargado; anon sin acceso.
BEGIN;
\ir fixture.sql

-- Barra VIP con su caja (datos de la prueba: ids fijos)
INSERT INTO public.inventory_locations (id, club_id, name, kind) VALUES
    ('10000000-0000-0000-0000-0000000000f1', 'c0000000-0000-0000-0000-00000000000a', 'Barra VIP', 'bar');
INSERT INTO public.cash_registers (id, club_id, name, inventory_location_id) VALUES
    ('20000000-0000-0000-0000-0000000000f1', 'c0000000-0000-0000-0000-00000000000a', 'Caja VIP', '10000000-0000-0000-0000-0000000000f1');

SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a1');   -- Ana, club A

-- Corona a 7000 en la barra VIP (con RETURNING, como supabase-js)
INSERT INTO public.product_location_prices (club_id, product_id, location_id, price) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000f1', 7000)
RETURNING id, price;

DO $$ BEGIN
    ASSERT (SELECT effective_price FROM public.v_register_product_prices
             WHERE cash_register_id = '20000000-0000-0000-0000-0000000000f1'
               AND product_id = '40000000-0000-0000-0000-000000000001') = 7000,
           'La Caja VIP cobra Corona al precio de su barra';
    ASSERT (SELECT effective_price FROM public.v_register_product_prices
             WHERE cash_register_id = '20000000-0000-0000-0000-000000000001'
               AND product_id = '40000000-0000-0000-0000-000000000001') = 5000,
           'La Caja 1 (Barra A, sin precio especial) cobra el precio general';
    ASSERT (SELECT effective_price FROM public.v_register_product_prices
             WHERE cash_register_id = '20000000-0000-0000-0000-0000000000f1'
               AND product_id = '40000000-0000-0000-0000-000000000002') = 6000,
           'Heineken sin precio VIP: la Caja VIP cobra el general';
    ASSERT (SELECT bar_price FROM public.v_register_product_prices
             WHERE cash_register_id = '20000000-0000-0000-0000-000000000001'
               AND product_id = '40000000-0000-0000-0000-000000000001') IS NULL,
           'Sin precio de barra, bar_price es NULL';
END $$;

-- Uno por producto y barra
SELECT public.t_expect_error($$INSERT INTO public.product_location_prices (club_id, product_id, location_id, price) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000f1', 8000)$$,
    'product_location_prices_one_per_bar');
-- Un deposito no vende: no lleva precio
SELECT public.t_expect_error($$INSERT INTO public.product_location_prices (club_id, product_id, location_id, price) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000ad', 8000)$$,
    'solo se asigna a una barra');
-- Precio negativo, no
SELECT public.t_expect_error($$INSERT INTO public.product_location_prices (club_id, product_id, location_id, price) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a', -1)$$,
    'product_location_prices_price_check');
-- Ni la barra ni el producto de otro club (regla y clave compuesta)
SELECT public.t_expect_error($$INSERT INTO public.product_location_prices (club_id, product_id, location_id, price) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000b', 8000)$$,
    'solo se asigna a una barra');
SELECT public.t_expect_error($$INSERT INTO public.product_location_prices (club_id, product_id, location_id, price) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000a', 8000)$$,
    'product_location_prices_product_fk');
-- El panel solo cambia el precio: ni producto, ni barra, ni club
SELECT public.t_expect_error($$UPDATE public.product_location_prices SET product_id = '40000000-0000-0000-0000-000000000002'$$, 'permission denied');
SELECT public.t_expect_error($$UPDATE public.product_location_prices SET location_id = '10000000-0000-0000-0000-00000000000a'$$, 'permission denied');
SELECT public.t_expect_error($$UPDATE public.product_location_prices SET club_id = 'c0000000-0000-0000-0000-00000000000b'$$, 'permission denied');

-- Cambiar y quitar
UPDATE public.product_location_prices SET price = 7500
 WHERE product_id = '40000000-0000-0000-0000-000000000001' RETURNING price;
DO $$ BEGIN
    ASSERT (SELECT effective_price FROM public.v_register_product_prices
             WHERE cash_register_id = '20000000-0000-0000-0000-0000000000f1'
               AND product_id = '40000000-0000-0000-0000-000000000001') = 7500, 'El precio VIP cambio a 7500';
END $$;
DELETE FROM public.product_location_prices WHERE product_id = '40000000-0000-0000-0000-000000000001';
DO $$ BEGIN
    ASSERT (SELECT effective_price FROM public.v_register_product_prices
             WHERE cash_register_id = '20000000-0000-0000-0000-0000000000f1'
               AND product_id = '40000000-0000-0000-0000-000000000001') = 5000,
           'Sin precio de barra vuelve el general';
END $$;
SELECT public.t_logout();

DO $$ BEGIN
    ASSERT (SELECT array_agg(action ORDER BY created_at, action) FROM public.audit_log
             WHERE entity_type = 'product' AND action LIKE 'product_price.%')
           @> ARRAY['product_price.bar_set', 'product_price.bar_changed', 'product_price.bar_removed'],
           'Asignar, cambiar y quitar un precio de barra quedan auditados';
    ASSERT EXISTS (SELECT 1 FROM public.audit_log
                    WHERE action = 'product_price.bar_changed'
                      AND (details ->> 'old_price')::numeric = 7000 AND (details ->> 'new_price')::numeric = 7500
                      AND actor_type = 'platform_admin'),
           'El cambio guarda precio anterior, nuevo y autor';
END $$;

-- Tampoco un service_role puede mover un precio a otra barra o producto
SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a1');
INSERT INTO public.product_location_prices (club_id, product_id, location_id, price) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000f1', 9000);
SELECT public.t_logout();
SELECT public.t_as_service();
SELECT public.t_expect_error($$UPDATE public.product_location_prices SET location_id = '10000000-0000-0000-0000-00000000000a'$$,
    'no cambia de producto ni de barra');
SELECT public.t_expect_error($$UPDATE public.product_location_prices SET club_id = 'c0000000-0000-0000-0000-00000000000b'$$,
    'otro club');
SELECT public.t_logout();

-- Luis (club B) no ve, no cambia ni borra precios del club A, ni crea
SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a2');
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM public.product_location_prices) = 0, 'Luis no ve precios del club A';
    ASSERT (SELECT count(*) FROM public.v_register_product_prices
             WHERE club_id = 'c0000000-0000-0000-0000-00000000000a') = 0, 'Luis no ve precios por caja del club A';
END $$;
UPDATE public.product_location_prices SET price = 1;
DELETE FROM public.product_location_prices;
SELECT public.t_expect_error($$INSERT INTO public.product_location_prices (club_id, product_id, location_id, price) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 1)$$,
    'solo se asigna a una barra');   -- por RLS no ve la barra ajena (y si no, lo frena la politica)
SELECT public.t_logout();
DO $$ BEGIN
    ASSERT (SELECT price FROM public.product_location_prices
             WHERE product_id = '40000000-0000-0000-0000-000000000002') = 9000, 'El precio del club A sigue intacto';
END $$;

-- El encargado del club A tambien asigna precios de barra
SELECT public.t_login_as('bbbbbbbb-0000-0000-0000-0000000000b4');
INSERT INTO public.product_location_prices (club_id, product_id, location_id, price) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 5500)
RETURNING id;
SELECT public.t_logout();

SET LOCAL ROLE anon;
SELECT public.t_expect_error('SELECT * FROM public.product_location_prices', 'permission denied');
SELECT public.t_expect_error('SELECT * FROM public.v_register_product_prices', 'permission denied');
RESET ROLE;

ROLLBACK;
