-- PRUEBA 060: INICIAR / PARAR NOCHE, cambio en efectivo por caja, foto de
-- stock, ventas de la noche (lista, pago mixto, retiro, resumen con el
-- cambio) y ventas fuera de noche (posnet sin conexion).
BEGIN;
\ir fixture.sql

-- ---- 1) INICIAR NOCHE desde el panel ---------------------------------
SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a1');   -- Ana
-- el panel no elige la hora ni el autor
SELECT public.t_expect_error($$INSERT INTO public.club_nights (club_id, started_at) VALUES ('c0000000-0000-0000-0000-00000000000a', '2000-01-01')$$, 'permission denied');
INSERT INTO public.club_nights (club_id) VALUES ('c0000000-0000-0000-0000-00000000000a') RETURNING id;
DO $$
DECLARE
    c CONSTANT uuid := 'c0000000-0000-0000-0000-00000000000a';
    n uuid := (SELECT id FROM public.club_nights WHERE club_id = c AND ended_at IS NULL);
BEGIN
    ASSERT n IS NOT NULL, 'La noche quedo abierta';
    ASSERT (SELECT started_by_type = 'platform_admin' AND started_by_id = 'a0000000-0000-0000-0000-000000000001'
              FROM public.club_nights WHERE id = n), 'La noche queda firmada por Ana';
    ASSERT (SELECT started_at = now() FROM public.club_nights WHERE id = n), 'Hora del servidor';
    -- foto del stock de cada barra al iniciar
    ASSERT (SELECT count(*) FROM public.night_stock_snapshots WHERE night_id = n AND kind = 'opening') = 2, 'Foto: 2 productos en Barra A';
    ASSERT (SELECT quantity FROM public.night_stock_snapshots WHERE night_id = n AND kind = 'opening'
             AND product_id = '40000000-0000-0000-0000-000000000002') = 10, 'Foto: Heineken 10';
    ASSERT (SELECT count(*) FROM public.audit_log WHERE action = 'night.started' AND entity_id = n) = 1, 'Se audita night.started';
END $$;
-- una sola noche abierta por club
SELECT public.t_expect_error($$INSERT INTO public.club_nights (club_id) VALUES ('c0000000-0000-0000-0000-00000000000a')$$, 'uq_club_nights_one_open');
-- el panel no escribe la foto
SELECT public.t_expect_error($$INSERT INTO public.night_stock_snapshots (club_id, night_id, location_id, product_id, kind, quantity)
    SELECT club_id, id, '10000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', 'closing', 99 FROM public.club_nights$$, 'permission denied');

-- ---- 2) CAMBIO en efectivo por caja ----------------------------------
INSERT INTO public.cash_register_floats (club_id, night_id, cash_register_id, kind, amount)
SELECT club_id, id, '20000000-0000-0000-0000-000000000001', 'opening', 10000 FROM public.club_nights WHERE ended_at IS NULL;
INSERT INTO public.cash_register_floats (club_id, night_id, cash_register_id, kind, amount, note)
SELECT club_id, id, '20000000-0000-0000-0000-000000000001', 'top_up', 5000, 'Refuerzo 01:00' FROM public.club_nights WHERE ended_at IS NULL;
INSERT INTO public.cash_register_floats (club_id, night_id, cash_register_id, kind, amount, note)
SELECT club_id, id, '20000000-0000-0000-0000-000000000001', 'correction', -1000, 'Se cargo de mas' FROM public.club_nights WHERE ended_at IS NULL;
SELECT public.t_expect_error($$INSERT INTO public.cash_register_floats (club_id, night_id, cash_register_id, kind, amount)
    SELECT club_id, id, '20000000-0000-0000-0000-000000000001', 'opening', 2000 FROM public.club_nights WHERE ended_at IS NULL$$, 'uq_cash_register_floats_opening');
SELECT public.t_expect_error($$INSERT INTO public.cash_register_floats (club_id, night_id, cash_register_id, kind, amount)
    SELECT club_id, id, '20000000-0000-0000-0000-000000000002', 'top_up', -5 FROM public.club_nights WHERE ended_at IS NULL$$, 'cash_register_floats_amount_check');
SELECT public.t_expect_error($$INSERT INTO public.cash_register_floats (club_id, night_id, cash_register_id, kind, amount, actor_id)
    SELECT club_id, id, '20000000-0000-0000-0000-000000000002', 'top_up', 5, gen_random_uuid() FROM public.club_nights WHERE ended_at IS NULL$$, 'permission denied');
SELECT public.t_expect_error('UPDATE public.cash_register_floats SET amount = 1', 'permission denied');
SELECT public.t_expect_error('DELETE FROM public.cash_register_floats', 'permission denied');
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM public.cash_register_floats
             WHERE actor_type = 'platform_admin' AND actor_id = 'a0000000-0000-0000-0000-000000000001') = 3,
           'Cada cambio queda firmado con quien lo cargo';
END $$;
SELECT public.t_logout();

-- Aislamiento: Luis (Club B) no ve ni opera la noche del Club A
SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a2');
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM public.club_nights) = 0, 'Luis no ve noches del Club A';
    ASSERT (SELECT count(*) FROM public.cash_register_floats) = 0, 'Luis no ve el cambio del Club A';
    ASSERT (SELECT count(*) FROM public.night_stock_snapshots) = 0, 'Luis no ve la foto del Club A';
END $$;
SELECT public.t_expect_error($$INSERT INTO public.club_nights (club_id) VALUES ('c0000000-0000-0000-0000-00000000000a')$$, 'row-level security');
UPDATE public.club_nights SET ended_at = now();   -- RLS: no toca ninguna fila
SELECT public.t_logout();
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM public.club_nights WHERE ended_at IS NULL) = 1, 'Luis no pudo parar la noche del Club A';
END $$;

-- El encargado del club tambien ve la noche
SELECT public.t_login_as('bbbbbbbb-0000-0000-0000-0000000000b4');
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM public.club_nights WHERE ended_at IS NULL) = 1, 'El encargado ve la noche abierta';
END $$;
SELECT public.t_logout();

-- anon: nada
SET LOCAL ROLE anon;
SELECT public.t_expect_error('SELECT * FROM public.club_nights', 'permission denied');
SELECT public.t_expect_error('SELECT * FROM public.v_sales_list', 'permission denied');
RESET ROLE;

-- ---- 3) VENTAS DE LA NOCHE (las sube el posnet) ----------------------
SELECT public.t_as_service();
-- V1: Caja 1, Juan, Corona 5000 en pago MIXTO: 2000 PIX + 3000 efectivo
INSERT INTO public.sales (id, club_id, cash_register_id, cash_shift_id, cashier_user_id, ticket_number, total, created_at_device, night_id)
SELECT '62000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','C1-1',5000, now(), id
  FROM public.club_nights WHERE ended_at IS NULL;
INSERT INTO public.sale_items (id, club_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total) VALUES
 ('72000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','62000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Corona',1,5000,1000,5000);
INSERT INTO public.sale_payments (id, club_id, sale_id, method, amount) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','62000000-0000-0000-0000-000000000001','cash',3000),
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','62000000-0000-0000-0000-000000000001','pix',2000);
-- V2: Caja 2, Maria, Heineken 6000 por transferencia
INSERT INTO public.sales (id, club_id, cash_register_id, cash_shift_id, cashier_user_id, ticket_number, total, created_at_device, night_id)
SELECT '62000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','C2-1',6000, now(), id
  FROM public.club_nights WHERE ended_at IS NULL;
INSERT INTO public.sale_items (id, club_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total) VALUES
 ('72000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-00000000000a','62000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','Heineken',1,6000,2000,6000);
INSERT INTO public.sale_payments (id, club_id, sale_id, method, amount) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','62000000-0000-0000-0000-000000000002','transfer',6000);
-- V3: posnet viejo, sin noche (no se rechaza)
INSERT INTO public.sales (id, club_id, cash_register_id, cash_shift_id, cashier_user_id, ticket_number, total, created_at_device) VALUES
 ('62000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','C2-2',6000, now());
INSERT INTO public.sale_items (id, club_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total) VALUES
 ('72000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-00000000000a','62000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000002','Heineken',1,6000,2000,6000);
INSERT INTO public.sale_payments (id, club_id, sale_id, method, amount) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','62000000-0000-0000-0000-000000000003','cash',6000);
-- Pedro escanea el QR de V1: retirado
INSERT INTO public.sale_status_events (id, club_id, sale_id, scanned_by_user_id, occurred_at) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','62000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003', now());
-- la noche de una venta no cambia
SELECT public.t_expect_error($$UPDATE public.sales SET night_id = NULL WHERE id = '62000000-0000-0000-0000-000000000001'$$, 'solo puede cambiar el estado');
SELECT public.t_logout();

SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a1');   -- Ana, en el panel
DO $$
DECLARE
    v1 CONSTANT uuid := '62000000-0000-0000-0000-000000000001';
    v2 CONSTANT uuid := '62000000-0000-0000-0000-000000000002';
    v3 CONSTANT uuid := '62000000-0000-0000-0000-000000000003';
BEGIN
    -- lista: cajero, caja, metodos en orden, monto por metodo y estado
    ASSERT (SELECT cashier_name FROM public.v_sales_list WHERE id = v1) = 'Juan', 'Nombre del cajero';
    ASSERT (SELECT cash_register_name FROM public.v_sales_list WHERE id = v1) = 'Caja 1', 'Nombre de la caja';
    ASSERT (SELECT payment_methods FROM public.v_sales_list WHERE id = v1) = ARRAY['pix','cash'], 'Metodos del pago mixto, en orden';
    ASSERT (SELECT is_mixed FROM public.v_sales_list WHERE id = v1), 'V1 es pago mixto';
    ASSERT NOT (SELECT is_mixed FROM public.v_sales_list WHERE id = v2), 'V2 no es mixto';
    ASSERT (SELECT cash_amount = 3000 AND pix_amount = 2000 AND transfer_amount = 0 AND paid_total = 5000
              FROM public.v_sales_list WHERE id = v1), 'Cuanto se pago con cada metodo';
    ASSERT (SELECT status = 'delivered' AND delivered_by_name = 'Pedro' FROM public.v_sales_list WHERE id = v1), 'V1 retirada por Pedro';
    ASSERT (SELECT status = 'pending' AND delivered_by_name IS NULL FROM public.v_sales_list WHERE id = v2), 'V2 pendiente';
    -- filtros que usa el panel
    ASSERT (SELECT count(*) FROM public.v_sales_list WHERE payment_methods @> ARRAY['cash']) = 2, 'Filtro por metodo: efectivo';
    ASSERT (SELECT count(*) FROM public.v_sales_list WHERE cashier_user_id = '30000000-0000-0000-0000-000000000002') = 2, 'Filtro por cajera';
    -- fuera de noche: solo la del posnet viejo
    ASSERT (SELECT outside_night FROM public.v_sales_list WHERE id = v3), 'V3 sin noche queda marcada';
    ASSERT NOT (SELECT outside_night FROM public.v_sales_list WHERE id = v1), 'V1 dentro de la noche';
    ASSERT (SELECT count(*) FROM public.v_sales_outside_night) = 1, 'Una venta para revisar';

    -- resumen por caja: efectivo = cambio + ventas en efectivo
    ASSERT (SELECT opening_float = 10000 AND added_float = 4000 AND float_total = 14000
              FROM public.v_night_register_summary WHERE cash_register_id = '20000000-0000-0000-0000-000000000001'),
           'Caja 1: cambio 10000 + 5000 - 1000';
    ASSERT (SELECT cash_sales = 3000 AND pix_sales = 2000 AND transfer_sales = 0 AND expected_cash = 17000 AND tickets = 1 AND sales_total = 5000
              FROM public.v_night_register_summary WHERE cash_register_id = '20000000-0000-0000-0000-000000000001'),
           'Caja 1: efectivo esperado 14000 + 3000 = 17000';
    ASSERT (SELECT float_total = 0 AND transfer_sales = 6000 AND expected_cash = 0 AND tickets = 1
              FROM public.v_night_register_summary WHERE cash_register_id = '20000000-0000-0000-0000-000000000002'),
           'Caja 2: sin cambio, solo transferencia; la venta sin noche no cuenta';
END $$;

-- ---- 4) PARAR NOCHE ---------------------------------------------------
UPDATE public.club_nights SET ended_at = '2000-01-01' WHERE ended_at IS NULL;
DO $$
DECLARE
    n uuid := (SELECT id FROM public.club_nights ORDER BY started_at DESC LIMIT 1);
BEGIN
    ASSERT (SELECT ended_at = now() AND ended_by_id = 'a0000000-0000-0000-0000-000000000001'
              FROM public.club_nights WHERE id = n), 'Al parar: hora del servidor y autor';
    ASSERT (SELECT count(*) FROM public.night_stock_snapshots WHERE night_id = n AND kind = 'closing') = 2, 'Foto de cierre';
    ASSERT (SELECT count(*) FROM public.cash_shifts WHERE closed_at IS NULL) = 0, 'Todas las cajas quedan cerradas';
    ASSERT (SELECT count(*) FROM public.audit_log WHERE action = 'night.ended' AND entity_id = n) = 1, 'Se audita night.ended';
    -- stock de la noche: apertura, vendido y cierre (Barra A)
    ASSERT (SELECT opening_quantity = 1 AND sold_quantity = 1 AND closing_quantity = 0
              FROM public.v_night_stock_summary WHERE night_id = n AND product_name = 'Corona'), 'Corona: 1 - 1 = 0';
    ASSERT (SELECT opening_quantity = 10 AND sold_quantity = 1 AND closing_quantity = 8
              FROM public.v_night_stock_summary WHERE night_id = n AND product_name = 'Heineken'),
           'Heineken: vendida 1 en la noche (la venta sin noche descuenta stock pero no cuenta como vendida en la noche)';
END $$;
-- una noche cerrada no se reabre ni se edita
SELECT public.t_expect_error('UPDATE public.club_nights SET ended_at = NULL', 'ya esta cerrada');
SELECT public.t_expect_error('UPDATE public.club_nights SET started_at = now()', 'permission denied');
SELECT public.t_expect_error('DELETE FROM public.club_nights', 'permission denied');
-- sin noche abierta no se carga cambio
SELECT public.t_expect_error($$INSERT INTO public.cash_register_floats (club_id, night_id, cash_register_id, kind, amount)
    SELECT club_id, id, '20000000-0000-0000-0000-000000000002', 'top_up', 100 FROM public.club_nights$$, 'no esta abierta');
SELECT public.t_logout();

-- Un posnet sin conexion siguio vendiendo despues de PARAR: se acepta y se marca
SELECT public.t_as_service();
INSERT INTO public.sales (id, club_id, cash_register_id, cash_shift_id, cashier_user_id, ticket_number, total, created_at_device, night_id)
SELECT '62000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','C1-2',5000, now() + interval '1 hour', id
  FROM public.club_nights;
SELECT public.t_logout();
DO $$ BEGIN
    ASSERT (SELECT outside_night FROM public.v_sales_list WHERE id = '62000000-0000-0000-0000-000000000004'), 'Venta despues de parar: marcada';
    ASSERT (SELECT count(*) FROM public.v_sales_outside_night) = 2, 'Dos ventas para revisar';
END $$;
-- como duenio de la base, la foto y el cambio tampoco se tocan
SELECT public.t_expect_error('UPDATE public.night_stock_snapshots SET quantity = 0', 'solo agregar');
SELECT public.t_expect_error('DELETE FROM public.cash_register_floats', 'solo agregar');
SELECT public.t_expect_error('DELETE FROM public.club_nights', 'solo agregar');

-- ---- 5) Se puede iniciar otra noche -----------------------------------
SELECT public.t_login_as('bbbbbbbb-0000-0000-0000-0000000000b4');   -- el encargado
INSERT INTO public.club_nights (club_id) VALUES ('c0000000-0000-0000-0000-00000000000a');
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM public.club_nights) = 2, 'Segunda noche';
    ASSERT (SELECT started_by_type = 'user' AND started_by_id = '30000000-0000-0000-0000-000000000004'
              FROM public.club_nights WHERE ended_at IS NULL), 'La inicio el encargado';
END $$;
SELECT public.t_logout();

ROLLBACK;
