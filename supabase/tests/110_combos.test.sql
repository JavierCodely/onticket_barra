-- PRUEBA 110: combos (archivo 17).
-- Precio y costo = suma de sus productos (nadie los escribe), el costo de
-- un producto llega a sus combos, sin combos dentro de combos, sin stock
-- propio; al venderse descuenta sus productos y guarda la foto de la
-- composicion; sustitucion de un producto del combo con sus limites y su
-- reversa; auditoria; aislamiento; encargado; anon.
BEGIN;
\ir fixture.sql

-- Datos de la prueba (ids fijos): el combo y un producto que no esta en el
--   Combo = 1 Corona a 4000 + 2 Heineken a 5000 c/u
INSERT INTO public.products (id, club_id, name, kind, price, cost) VALUES
    ('40000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-00000000000a', 'Combo Corona + 2 Heineken', 'combo', 0, 0);
INSERT INTO public.products (id, club_id, name, price, cost) VALUES
    ('40000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-00000000000a', 'Agua', 1500, 300);

SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a1');   -- Ana, club A
INSERT INTO public.combo_items (club_id, combo_id, product_id, quantity, unit_price) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-000000000001', 1, 4000),
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-000000000002', 2, 5000)
RETURNING id;

DO $$ BEGIN
    ASSERT (SELECT price FROM public.products WHERE id = '40000000-0000-0000-0000-0000000000c1') = 14000,
           'Precio del combo = 4000 + 2 x 5000';
    ASSERT (SELECT cost FROM public.products WHERE id = '40000000-0000-0000-0000-0000000000c1') = 5000,
           'Costo del combo = 1000 + 2 x 2000';
END $$;

-- El panel crea un combo (con RETURNING): arranca en 0
INSERT INTO public.products (club_id, name, kind, price, cost) VALUES
    ('c0000000-0000-0000-0000-00000000000a', 'Combo vacio', 'combo', 0, 0) RETURNING id, kind;

-- Nadie escribe el precio ni el costo de un combo
SELECT public.t_expect_error($$INSERT INTO public.products (club_id, name, kind, price, cost) VALUES
    ('c0000000-0000-0000-0000-00000000000a', 'Combo trucho', 'combo', 100, 0)$$, 'suma de sus productos');
SELECT public.t_expect_error($$UPDATE public.products SET price = 1 WHERE id = '40000000-0000-0000-0000-0000000000c1'$$,
    'suma de sus productos');
SELECT public.t_expect_error($$UPDATE public.products SET cost = 1 WHERE id = '40000000-0000-0000-0000-0000000000c1'$$,
    'suma de sus productos');
-- Un producto no se vuelve combo (ni el panel puede intentarlo)
SELECT public.t_expect_error($$UPDATE public.products SET kind = 'combo' WHERE id = '40000000-0000-0000-0000-000000000001'$$,
    'permission denied');
-- Editar otras cosas del combo si se puede
UPDATE public.products SET name = 'Combo Birras' WHERE id = '40000000-0000-0000-0000-0000000000c1';

-- Composicion: sin combos dentro de combos, solo un combo lleva productos,
-- nada de otro club, cantidades validas, uno por producto
SELECT public.t_expect_error($$INSERT INTO public.combo_items (club_id, combo_id, product_id, quantity, unit_price)
    SELECT 'c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000c1', id, 1, 1
      FROM public.products WHERE name = 'Combo vacio'$$, 'no otros combos');
SELECT public.t_expect_error($$INSERT INTO public.combo_items (club_id, combo_id, product_id, quantity, unit_price) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', 1, 1)$$,
    'Solo un combo lleva productos');
SELECT public.t_expect_error($$INSERT INTO public.combo_items (club_id, combo_id, product_id, quantity, unit_price) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-00000000000b', 1, 1)$$,
    'no otros combos');
SELECT public.t_expect_error($$INSERT INTO public.combo_items (club_id, combo_id, product_id, quantity, unit_price) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-0000000000a1', 0, 1)$$,
    'combo_items_quantity_check');
SELECT public.t_expect_error($$INSERT INTO public.combo_items (club_id, combo_id, product_id, quantity, unit_price) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-0000000000a1', 1, -1)$$,
    'combo_items_unit_price_check');
SELECT public.t_expect_error($$INSERT INTO public.combo_items (club_id, combo_id, product_id, quantity, unit_price) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-000000000001', 1, 1)$$,
    'combo_items_one_per_product');
SELECT public.t_expect_error($$UPDATE public.combo_items SET product_id = '40000000-0000-0000-0000-0000000000a1'$$, 'permission denied');

-- Cambiar cantidad o precio individual recalcula el combo; quitar tambien
UPDATE public.combo_items SET quantity = 3 WHERE product_id = '40000000-0000-0000-0000-000000000002';
DO $$ BEGIN
    ASSERT (SELECT price FROM public.products WHERE id = '40000000-0000-0000-0000-0000000000c1') = 19000, 'Con 3 Heineken: 19000';
    ASSERT (SELECT cost  FROM public.products WHERE id = '40000000-0000-0000-0000-0000000000c1') = 7000,  'Con 3 Heineken: costo 7000';
END $$;
INSERT INTO public.combo_items (club_id, combo_id, product_id, quantity, unit_price) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-0000000000a1', 1, 1000);
DELETE FROM public.combo_items WHERE product_id = '40000000-0000-0000-0000-0000000000a1';
UPDATE public.combo_items SET quantity = 2 WHERE product_id = '40000000-0000-0000-0000-000000000002';
DO $$ BEGIN
    ASSERT (SELECT price FROM public.products WHERE id = '40000000-0000-0000-0000-0000000000c1') = 14000, 'De vuelta a 14000';
END $$;

-- El costo de un producto llega a sus combos (no el precio de lista)
UPDATE public.products SET cost = 2500, price = 6500 WHERE id = '40000000-0000-0000-0000-000000000002';
DO $$ BEGIN
    ASSERT (SELECT cost  FROM public.products WHERE id = '40000000-0000-0000-0000-0000000000c1') = 6000,
           'Heineken a costo 2500: el combo cuesta 1000 + 2 x 2500';
    ASSERT (SELECT price FROM public.products WHERE id = '40000000-0000-0000-0000-0000000000c1') = 14000,
           'El precio del combo sale de sus precios individuales, no del precio de lista';
END $$;

-- Un combo no tiene stock propio
SELECT public.t_expect_error($$INSERT INTO public.inventory_movements (club_id, location_id, product_id, movement_type, quantity) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000ad', '40000000-0000-0000-0000-0000000000c1', 'purchase', 10)$$,
    'no tiene stock propio');
-- Ni el panel escribe la foto de una venta
SELECT public.t_expect_error($$INSERT INTO public.sale_item_components (club_id, sale_item_id, product_id, product_name, quantity, unit_price, unit_cost)
    VALUES ('c0000000-0000-0000-0000-00000000000a', gen_random_uuid(), '40000000-0000-0000-0000-000000000001', 'x', 1, 1, 1)$$,
    'permission denied');
SELECT public.t_logout();

DO $$ BEGIN
    ASSERT (SELECT count(*) FROM public.audit_log WHERE entity_type = 'product'
             AND entity_id = '40000000-0000-0000-0000-0000000000c1' AND action LIKE 'combo.item_%') >= 6,
           'Agregar, cambiar y quitar productos del combo queda auditado';
    ASSERT EXISTS (SELECT 1 FROM public.audit_log WHERE action = 'combo.item_removed' AND actor_type = 'platform_admin'),
           'Quitar un producto del combo guarda quien fue';
END $$;


-- ---- El posnet vende 2 combos (como pos-upload: service_role) --------
SELECT public.t_as_service();
INSERT INTO public.sales (id, club_id, cash_register_id, cash_shift_id, cashier_user_id, ticket_number, total, created_at_device) VALUES
 ('60000000-0000-0000-0000-0000000000c1','c0000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','C1-000100',28000,'2026-11-06 23:30-03'),
 ('60000000-0000-0000-0000-0000000000c2','c0000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','C1-000101',5000,'2026-11-06 23:31-03');
INSERT INTO public.sale_items (id, club_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total) VALUES
 ('70000000-0000-0000-0000-0000000000c1','c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-0000000000c1','40000000-0000-0000-0000-0000000000c1','Combo Birras',2,14000,6000,28000),
 ('70000000-0000-0000-0000-0000000000c2','c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-0000000000c2','40000000-0000-0000-0000-000000000001','Corona',1,5000,1000,5000);
-- Reintento del mismo envio: no duplica
INSERT INTO public.sale_items (id, club_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total) VALUES
 ('70000000-0000-0000-0000-0000000000c1','c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-0000000000c1','40000000-0000-0000-0000-0000000000c1','Combo Birras',2,14000,6000,28000)
 ON CONFLICT (id) DO NOTHING;

-- Cambiar el combo despues de vender no toca la foto de la venta
UPDATE public.combo_items SET unit_price = 1 WHERE product_id = '40000000-0000-0000-0000-000000000001';

DO $$ BEGIN
    ASSERT (SELECT count(*) FROM public.sale_item_components WHERE sale_item_id = '70000000-0000-0000-0000-0000000000c1') = 2,
           'La foto del combo tiene sus 2 productos';
    ASSERT (SELECT row(quantity, unit_price, unit_cost, product_name)::text FROM public.sale_item_components
             WHERE sale_item_id = '70000000-0000-0000-0000-0000000000c1' AND product_id = '40000000-0000-0000-0000-000000000002')
           = row(2, 5000.00, 2500.00, 'Heineken')::text, 'Foto de Heineken: 2 por combo, a 5000, costo 2500';
    ASSERT (SELECT unit_price FROM public.sale_item_components WHERE product_id = '40000000-0000-0000-0000-000000000001') = 4000,
           'La foto conserva el precio individual del momento de la venta';
    ASSERT (SELECT count(*) FROM public.sale_item_components WHERE sale_item_id = '70000000-0000-0000-0000-0000000000c2') = 0,
           'Un producto comun no tiene foto de composicion';
    -- Stock: 2 combos = 2 Corona y 4 Heineken en la Barra A; el combo no se mueve
    ASSERT (SELECT -quantity FROM public.inventory_movements WHERE sale_item_id = '70000000-0000-0000-0000-0000000000c1'
             AND product_id = '40000000-0000-0000-0000-000000000001') = 2, '2 combos descuentan 2 Corona';
    ASSERT (SELECT -quantity FROM public.inventory_movements WHERE sale_item_id = '70000000-0000-0000-0000-0000000000c1'
             AND product_id = '40000000-0000-0000-0000-000000000002') = 4, '2 combos descuentan 4 Heineken';
    ASSERT (SELECT count(*) FROM public.inventory_movements WHERE product_id = '40000000-0000-0000-0000-0000000000c1') = 0,
           'El combo no tiene movimientos propios';
    ASSERT (SELECT count(*) FROM public.inventory_movements WHERE movement_type = 'sale') = 3,
           'El reintento no duplica movimientos (2 del combo + 1 Corona suelta)';
    ASSERT (SELECT quantity FROM public.inventory_balances WHERE product_id = '40000000-0000-0000-0000-000000000001'
             AND location_id = '10000000-0000-0000-0000-00000000000a') = -2, 'Corona: 1 - 2 (combo) - 1 (suelta)';
    ASSERT (SELECT quantity FROM public.inventory_balances WHERE product_id = '40000000-0000-0000-0000-000000000002'
             AND location_id = '10000000-0000-0000-0000-00000000000a') = 6, 'Heineken: 10 - 4';
END $$;

-- ---- Sustitucion en barra dentro del combo ---------------------------
-- Falta decir que producto del combo
SELECT public.t_expect_error($$INSERT INTO public.sale_item_substitutions (id, club_id, sale_id, sale_item_id, quantity,
   substitute_product_id, substitute_product_name, substitute_unit_price, substitute_unit_cost,
   location_id, authorized_by_user_id, occurred_at) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-0000000000c1','70000000-0000-0000-0000-0000000000c1',1,
   '40000000-0000-0000-0000-0000000000a1','Agua',1500,300,'10000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-000000000003',now())$$,
   'hay que indicar que producto');
-- Un producto que no esta en el combo
SELECT public.t_expect_error($$INSERT INTO public.sale_item_substitutions (id, club_id, sale_id, sale_item_id, quantity, component_product_id,
   substitute_product_id, substitute_product_name, substitute_unit_price, substitute_unit_cost,
   location_id, authorized_by_user_id, occurred_at) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-0000000000c1','70000000-0000-0000-0000-0000000000c1',1,
   '40000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000001','Corona',5000,1000,'10000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-000000000003',now())$$,
   'no es parte de ese combo');
-- Mas Heineken de las vendidas (2 combos x 2 = 4)
SELECT public.t_expect_error($$INSERT INTO public.sale_item_substitutions (id, club_id, sale_id, sale_item_id, quantity, component_product_id,
   substitute_product_id, substitute_product_name, substitute_unit_price, substitute_unit_cost,
   location_id, authorized_by_user_id, occurred_at) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-0000000000c1','70000000-0000-0000-0000-0000000000c1',5,
   '40000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-0000000000a1','Agua',1500,300,'10000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-000000000003',now())$$,
   'solo se vendieron 4');
-- Se entrega un producto, no un combo
SELECT public.t_expect_error($$INSERT INTO public.sale_item_substitutions (id, club_id, sale_id, sale_item_id, quantity, component_product_id,
   substitute_product_id, substitute_product_name, substitute_unit_price, substitute_unit_cost,
   location_id, authorized_by_user_id, occurred_at) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-0000000000c1','70000000-0000-0000-0000-0000000000c1',1,
   '40000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-0000000000c1','Combo',14000,6000,'10000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-000000000003',now())$$,
   'no un combo');
-- En un producto comun no se indica producto del combo
SELECT public.t_expect_error($$INSERT INTO public.sale_item_substitutions (id, club_id, sale_id, sale_item_id, quantity, component_product_id,
   substitute_product_id, substitute_product_name, substitute_unit_price, substitute_unit_cost,
   location_id, authorized_by_user_id, occurred_at) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-0000000000c2','70000000-0000-0000-0000-0000000000c2',1,
   '40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','Heineken',6500,2500,'10000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-000000000003',now())$$,
   'Solo en un combo');

-- Valida: faltan 3 Heineken y se entregan 3 Agua
INSERT INTO public.sale_item_substitutions (id, club_id, sale_id, sale_item_id, quantity, component_product_id,
   substitute_product_id, substitute_product_name, substitute_unit_price, substitute_unit_cost,
   location_id, authorized_by_user_id, occurred_at) VALUES
 ('80000000-0000-0000-0000-0000000000c1','c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-0000000000c1','70000000-0000-0000-0000-0000000000c1',3,
   '40000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-0000000000a1','Agua',1500,300,
   '10000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-000000000003','2026-11-06 23:45-03');

DO $$ BEGIN
    ASSERT (SELECT row(original_product_name, original_unit_price, original_unit_cost, price_difference, cost_difference)::text
              FROM public.sale_item_substitutions WHERE id = '80000000-0000-0000-0000-0000000000c1')
           = row('Heineken', 5000.00, 2500.00, -10500.00, -6600.00)::text,
           'Lo vendido es la Heineken del combo a su precio individual; diferencias x 3';
    ASSERT (SELECT quantity FROM public.inventory_balances WHERE product_id = '40000000-0000-0000-0000-000000000002'
             AND location_id = '10000000-0000-0000-0000-00000000000a') = 9, 'Heineken vuelve: 6 + 3';
    ASSERT (SELECT quantity FROM public.inventory_balances WHERE product_id = '40000000-0000-0000-0000-0000000000a1'
             AND location_id = '10000000-0000-0000-0000-00000000000a') = -3, 'Salen 3 Agua de la barra';
END $$;
-- Queda 1 Heineken por sustituir: 2 ya no entran
SELECT public.t_expect_error($$INSERT INTO public.sale_item_substitutions (id, club_id, sale_id, sale_item_id, quantity, component_product_id,
   substitute_product_id, substitute_product_name, substitute_unit_price, substitute_unit_cost,
   location_id, authorized_by_user_id, occurred_at) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-0000000000c1','70000000-0000-0000-0000-0000000000c1',2,
   '40000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-0000000000a1','Agua',1500,300,'10000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-000000000003',now())$$,
   'ya sustituidas: 3');
-- La Corona del combo se cuenta aparte (2 vendidas)
INSERT INTO public.sale_item_substitutions (id, club_id, sale_id, sale_item_id, quantity, component_product_id,
   substitute_product_id, substitute_product_name, substitute_unit_price, substitute_unit_cost,
   location_id, authorized_by_user_id, occurred_at) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-0000000000c1','70000000-0000-0000-0000-0000000000c1',2,
   '40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-0000000000a1','Agua',1500,300,
   '10000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-000000000003','2026-11-06 23:46-03');
SELECT public.t_logout();


-- ---- Aislamiento -----------------------------------------------------
SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a2');   -- Luis, club B
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM public.combo_items) = 0, 'Luis no ve combos del club A';
    ASSERT (SELECT count(*) FROM public.sale_item_components) = 0, 'Luis no ve fotos de combos del club A';
END $$;
UPDATE public.combo_items SET unit_price = 0;
DELETE FROM public.combo_items;
SELECT public.t_expect_error($$INSERT INTO public.combo_items (club_id, combo_id, product_id, quantity, unit_price) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-0000000000a1', 1, 1)$$,
    'Solo un combo lleva productos');   -- por RLS no ve el combo ajeno (y si no, lo frena la politica)
SELECT public.t_logout();
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM public.combo_items WHERE combo_id = '40000000-0000-0000-0000-0000000000c1') = 2,
           'Los productos del combo del club A siguen intactos';
END $$;

-- El encargado del club A tambien arma combos
SELECT public.t_login_as('bbbbbbbb-0000-0000-0000-0000000000b4');
INSERT INTO public.combo_items (club_id, combo_id, product_id, quantity, unit_price) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-0000000000a1', 1, 1000)
RETURNING id;
SELECT public.t_logout();

SET LOCAL ROLE anon;
SELECT public.t_expect_error('SELECT * FROM public.combo_items', 'permission denied');
SELECT public.t_expect_error('SELECT * FROM public.sale_item_components', 'permission denied');
RESET ROLE;

ROLLBACK;
