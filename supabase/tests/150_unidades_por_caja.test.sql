-- PRUEBA 150: unidades por caja (archivo 22).
-- El panel lo escribe al crear y editar un producto; limites; solo
-- productos comunes (no combos); auditado; el libro guarda unidades;
-- aislamiento y anon.
BEGIN;
\ir fixture.sql

SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a1');   -- Ana

-- Alta con caja y edicion
INSERT INTO public.products (club_id, name, cost, price, units_per_box)
VALUES ('c0000000-0000-0000-0000-00000000000a', 'Quilmes', 900, 4000, 6)
RETURNING name, units_per_box;
UPDATE public.products SET units_per_box = 24 WHERE id = '40000000-0000-0000-0000-000000000001';
DO $$ BEGIN
    ASSERT (SELECT units_per_box FROM public.products WHERE name = 'Quilmes') = 6, 'Alta con 6 por caja';
    ASSERT (SELECT units_per_box FROM public.products WHERE id = '40000000-0000-0000-0000-000000000001') = 24,
           'Editar: 24 por caja';
END $$;

-- Limites: de 2 a 1000; NULL = suelto
SELECT public.t_expect_error($$UPDATE public.products SET units_per_box = 1
    WHERE id = '40000000-0000-0000-0000-000000000001'$$, 'products_units_per_box_check');
SELECT public.t_expect_error($$UPDATE public.products SET units_per_box = 1001
    WHERE id = '40000000-0000-0000-0000-000000000001'$$, 'products_units_per_box_check');
UPDATE public.products SET units_per_box = NULL WHERE id = '40000000-0000-0000-0000-000000000002';

-- Un combo no viene por caja
SELECT public.t_expect_error($$INSERT INTO public.products (club_id, name, cost, price, kind, units_per_box)
    VALUES ('c0000000-0000-0000-0000-00000000000a', 'Combo en caja', 0, 0, 'combo', 6)$$,
    'products_units_per_box_kind_check');

-- Compra de 2 cajas de 24: el libro guarda unidades
INSERT INTO public.inventory_movements (club_id, location_id, product_id, movement_type, quantity, note)
VALUES ('c0000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a',
        '40000000-0000-0000-0000-000000000001', 'purchase', 48, '2 cajas x 24');

-- Producto de otro club: no lo ve ni lo cambia
UPDATE public.products SET units_per_box = 12 WHERE id = '40000000-0000-0000-0000-00000000000b';
SELECT public.t_logout();

DO $$ BEGIN
    ASSERT (SELECT units_per_box FROM public.products WHERE id = '40000000-0000-0000-0000-00000000000b') IS NULL,
           'Ana no cambia productos del club B';
    ASSERT EXISTS (SELECT 1 FROM public.audit_log
                    WHERE action = 'product.updated' AND entity_id = '40000000-0000-0000-0000-000000000001'
                      AND (details -> 'units_per_box' ->> 'to')::int = 24),
           'El cambio de unidades por caja queda auditado';
    ASSERT (SELECT quantity FROM public.inventory_movements
             WHERE product_id = '40000000-0000-0000-0000-000000000001' AND movement_type = 'purchase'
               AND note = '2 cajas x 24') = 48,
           'La compra por cajas entra en unidades';
END $$;

-- El encargado tambien lo edita en su club
SELECT public.t_login_as('bbbbbbbb-0000-0000-0000-0000000000b4');
UPDATE public.products SET units_per_box = 12 WHERE id = '40000000-0000-0000-0000-000000000002';
SELECT public.t_logout();
DO $$ BEGIN
    ASSERT (SELECT units_per_box FROM public.products WHERE id = '40000000-0000-0000-0000-000000000002') = 12,
           'El encargado carga las unidades por caja';
END $$;

SET LOCAL ROLE anon;
SELECT public.t_expect_error('SELECT units_per_box FROM public.products', 'permission denied');
RESET ROLE;

ROLLBACK;
