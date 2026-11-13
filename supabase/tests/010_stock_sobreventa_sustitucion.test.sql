-- PRUEBA 010: ventas sin conexion, sobreventa, sustitucion en barra,
-- retiro por QR, ventas inmutables y libro de stock.
-- Todo lo que hace el posnet se ejecuta como service_role, igual que la
-- Edge Function pos-upload: asi tambien se prueban sus permisos.
BEGIN;
\ir fixture.sql
SELECT public.t_as_service();

-- ---- 1) Dos cajas venden la ULTIMA Corona (sin internet) -------------
INSERT INTO public.sales (id, club_id, cash_register_id, cash_shift_id, cashier_user_id, ticket_number, total, created_at_device) VALUES
 ('60000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','C1-000001',5000,'2026-11-06 23:30-03'),
 ('60000000-0000-0000-0000-00000000000b','c0000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','C2-000001',5000,'2026-11-06 23:31-03');
INSERT INTO public.sale_items (id, club_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total) VALUES
 ('70000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-00000000000a','40000000-0000-0000-0000-000000000001','Corona',1,5000,1000,5000),
 ('70000000-0000-0000-0000-00000000000b','c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-00000000000b','40000000-0000-0000-0000-000000000001','Corona',1,5000,1000,5000);
INSERT INTO public.sale_payments (id, club_id, sale_id, method, amount) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-00000000000a','cash',5000),
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-00000000000b','transfer',5000);

DO $$ BEGIN
  ASSERT (SELECT quantity FROM public.inventory_balances WHERE product_id='40000000-0000-0000-0000-000000000001') = -1,
         'El stock de Corona debia quedar en -1 (la sobreventa no se rechaza)';
  ASSERT (SELECT count(*) FROM public.stock_alerts WHERE status='open' AND product_id='40000000-0000-0000-0000-000000000001') = 1,
         'Debia abrirse UNA alerta de stock negativo';
  ASSERT (SELECT quantity_at_detection FROM public.stock_alerts WHERE status='open') = -1, 'La alerta guarda el saldo -1';
END $$;

-- ---- 2) Reintento del mismo envio: no duplica nada -------------------
INSERT INTO public.sale_items (id, club_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total) VALUES
 ('70000000-0000-0000-0000-00000000000b','c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-00000000000b','40000000-0000-0000-0000-000000000001','Corona',1,5000,1000,5000)
 ON CONFLICT (id) DO NOTHING;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.inventory_movements WHERE movement_type='sale') = 2,
         'Un reintento del mismo item NO debe crear otro movimiento de venta';
  ASSERT (SELECT quantity FROM public.inventory_balances WHERE product_id='40000000-0000-0000-0000-000000000001') = -1,
         'El reintento no debe volver a descontar stock';
END $$;

-- ---- 3) La barra escanea el ticket B y sustituye Corona por Heineken -
INSERT INTO public.sale_status_events (id, club_id, sale_id, scanned_by_user_id, occurred_at) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-00000000000b','30000000-0000-0000-0000-000000000003','2026-11-06 23:40-03');
INSERT INTO public.sale_item_substitutions (id, club_id, sale_id, sale_item_id, quantity, reason,
   substitute_product_id, substitute_product_name, substitute_unit_price, substitute_unit_cost,
   location_id, authorized_by_user_id, occurred_at) VALUES
 ('80000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-00000000000b','70000000-0000-0000-0000-00000000000b',1,'out_of_stock',
   '40000000-0000-0000-0000-000000000002','Heineken',6000,2000,
   '10000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-000000000003','2026-11-06 23:40-03');

DO $$ BEGIN
  ASSERT (SELECT quantity FROM public.inventory_balances WHERE product_id='40000000-0000-0000-0000-000000000001') = 0,
         'Corona debia volver a 0 (reversa: no se entrego)';
  ASSERT (SELECT quantity FROM public.inventory_balances WHERE product_id='40000000-0000-0000-0000-000000000002') = 9,
         'Heineken debia bajar de 10 a 9';
  ASSERT (SELECT status FROM public.stock_alerts WHERE product_id='40000000-0000-0000-0000-000000000001') = 'resolved',
         'La alerta de sobreventa debia cerrarse sola';
  -- El trigger copia lo vendido y calcula las diferencias
  ASSERT (SELECT original_product_name FROM public.sale_item_substitutions) = 'Corona', 'Debe copiar el producto vendido';
  ASSERT (SELECT price_difference FROM public.sale_item_substitutions) = 1000, 'Descuento por sustitucion = 1000';
  ASSERT (SELECT cost_difference  FROM public.sale_item_substitutions) = 1000, 'Costo extra = 1000';
  -- El retiro marco la venta
  ASSERT (SELECT status FROM public.sales WHERE id='60000000-0000-0000-0000-00000000000b') = 'delivered', 'El ticket debia quedar retirado';
  ASSERT (SELECT delivered_by_user_id FROM public.sales WHERE id='60000000-0000-0000-0000-00000000000b') = '30000000-0000-0000-0000-000000000003', 'Debe registrar quien entrego';
  -- Finanzas del item sustituido: se cobro 5000, costo real 2000 (Heineken)
  ASSERT (SELECT revenue               FROM public.v_sale_item_financials WHERE sale_item_id='70000000-0000-0000-0000-00000000000b') = 5000, 'Ingreso 5000';
  ASSERT (SELECT cost_effective        FROM public.v_sale_item_financials WHERE sale_item_id='70000000-0000-0000-0000-00000000000b') = 2000, 'Costo real 2000';
  ASSERT (SELECT substitution_discount FROM public.v_sale_item_financials WHERE sale_item_id='70000000-0000-0000-0000-00000000000b') = 1000, 'Descuento 1000';
  ASSERT (SELECT gross_margin          FROM public.v_sale_item_financials WHERE sale_item_id='70000000-0000-0000-0000-00000000000b') = 3000, 'Margen 3000';
  -- El item NO sustituido conserva su costo original
  ASSERT (SELECT gross_margin FROM public.v_sale_item_financials WHERE sale_item_id='70000000-0000-0000-0000-00000000000a') = 4000, 'Margen normal 4000';
END $$;

-- ---- 4) Retiro duplicado: vale el primero ----------------------------
INSERT INTO public.sale_status_events (id, club_id, sale_id, scanned_by_user_id, occurred_at) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-00000000000b','30000000-0000-0000-0000-000000000003','2026-11-06 23:55-03');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.sale_status_events WHERE is_duplicate) = 1, 'El segundo retiro debia marcarse duplicado';
  ASSERT (SELECT count(*) FROM public.sale_status_events WHERE NOT is_duplicate) = 1, 'Un solo retiro valido por ticket';
  ASSERT (SELECT delivered_at FROM public.sales WHERE id='60000000-0000-0000-0000-00000000000b') = '2026-11-06 23:40-03'::timestamptz,
         'La hora de retiro es la del PRIMER escaneo';
END $$;

-- ---- 5) Reglas que DEBEN rechazar ------------------------------------
-- sustituir mas de lo vendido
SELECT public.t_expect_error($$INSERT INTO public.sale_item_substitutions (id, club_id, sale_id, sale_item_id, quantity, substitute_product_id, substitute_product_name, substitute_unit_price, substitute_unit_cost, location_id, authorized_by_user_id, occurred_at)
  VALUES (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-00000000000b','70000000-0000-0000-0000-00000000000b',1,'40000000-0000-0000-0000-000000000002','Heineken',6000,2000,'10000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-000000000003',now())$$,
  'solo se vendieron');
-- sustituir por el mismo producto
SELECT public.t_expect_error($$INSERT INTO public.sale_item_substitutions (id, club_id, sale_id, sale_item_id, quantity, substitute_product_id, substitute_product_name, substitute_unit_price, substitute_unit_cost, location_id, authorized_by_user_id, occurred_at)
  VALUES (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-00000000000a','70000000-0000-0000-0000-00000000000a',1,'40000000-0000-0000-0000-000000000001','Corona',5000,1000,'10000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-000000000003',now())$$,
  'different_product');
-- producto de OTRO club en una venta
SELECT public.t_expect_error($$INSERT INTO public.sale_items (id, club_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total)
  VALUES (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-00000000000a','40000000-0000-0000-0000-00000000000b','X',1,2,1,2)$$,
  'foreign key');
-- total de linea mal calculado
SELECT public.t_expect_error($$INSERT INTO public.sale_items (id, club_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total)
  VALUES (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-00000000000a','40000000-0000-0000-0000-000000000001','Corona',2,5000,1000,5000)$$,
  'line_total_check');
-- metodo de pago inexistente
SELECT public.t_expect_error($$INSERT INTO public.sale_payments (id, club_id, sale_id, method, amount)
  VALUES (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-00000000000a','bitcoin',10)$$,
  'foreign key');
-- libros de solo agregar
SELECT public.t_expect_error('UPDATE public.sale_items SET quantity = 5', 'solo agregar');
SELECT public.t_expect_error('DELETE FROM public.sale_payments', 'solo agregar');
SELECT public.t_expect_error('DELETE FROM public.inventory_movements', 'solo agregar');
SELECT public.t_expect_error('UPDATE public.sale_item_substitutions SET quantity = 9', 'solo agregar');
SELECT public.t_expect_error('DELETE FROM public.sale_status_events', 'solo agregar');
INSERT INTO public.audit_log (club_id, actor_type, actor_id, action, entity_type) VALUES
 ('c0000000-0000-0000-0000-00000000000a','user','30000000-0000-0000-0000-000000000004','test.created','test');
SELECT public.t_expect_error('UPDATE public.audit_log SET action = ''test.changed''', 'solo agregar');
SELECT public.t_expect_error('DELETE FROM public.audit_log', 'solo agregar');

-- ---- 6) Una venta es inmutable (salvo el retiro) ---------------------
SELECT public.t_expect_error('UPDATE public.sales SET total = 1', 'solo puede cambiar');
SELECT public.t_expect_error($$UPDATE public.sales SET cashier_user_id = '30000000-0000-0000-0000-000000000002' WHERE id = '60000000-0000-0000-0000-00000000000a'$$, 'solo puede cambiar');
SELECT public.t_expect_error('DELETE FROM public.sales', 'no se borran');
SELECT public.t_expect_error($$UPDATE public.sales SET status = 'pending', delivered_at = NULL, delivered_by_user_id = NULL WHERE id = '60000000-0000-0000-0000-00000000000b'$$, 'no vuelve a pendiente');

-- ---- 7) Codigos de error que usa pos-upload para decidir -------------
-- 23503 = todavia no llego el padre (reintentar)   23514 = regla de negocio (a sync_errors)
DO $$ BEGIN
  ASSERT public.t_sqlstate($q$INSERT INTO public.sale_status_events (id, club_id, sale_id, scanned_by_user_id, occurred_at)
     VALUES (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a',gen_random_uuid(),'30000000-0000-0000-0000-000000000003',now())$q$) = '23503',
     'Un retiro que llega antes que su venta debe dar 23503';
  ASSERT public.t_sqlstate($q$INSERT INTO public.sale_items (id, club_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total)
     VALUES (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a',gen_random_uuid(),'40000000-0000-0000-0000-000000000001','Corona',1,5000,1000,5000)$q$) = '23503',
     'Un item que llega antes que su venta debe dar 23503';
  ASSERT public.t_sqlstate($q$INSERT INTO public.sale_item_substitutions (id, club_id, sale_id, sale_item_id, quantity, substitute_product_id, substitute_product_name, substitute_unit_price, substitute_unit_cost, location_id, authorized_by_user_id, occurred_at)
     VALUES (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-00000000000a',gen_random_uuid(),1,'40000000-0000-0000-0000-000000000002','Heineken',6000,2000,'10000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-000000000003',now())$q$) = '23503',
     'Una sustitucion que llega antes que su item debe dar 23503';
  ASSERT public.t_sqlstate($q$INSERT INTO public.sale_item_substitutions (id, club_id, sale_id, sale_item_id, quantity, substitute_product_id, substitute_product_name, substitute_unit_price, substitute_unit_cost, location_id, authorized_by_user_id, occurred_at)
     VALUES (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-00000000000b','70000000-0000-0000-0000-00000000000b',1,'40000000-0000-0000-0000-000000000002','Heineken',6000,2000,'10000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-000000000003',now())$q$) = '23514',
     'Sustituir de mas es una regla de negocio: 23514';
  ASSERT public.t_sqlstate('UPDATE public.sale_items SET quantity = 5') = '23514', 'Tocar un libro de solo agregar: 23514';
END $$;

-- ---- 8) Control: ventas cuyo total no cierra -------------------------
INSERT INTO public.sales (id, club_id, cash_register_id, cash_shift_id, cashier_user_id, ticket_number, total, created_at_device) VALUES
 ('60000000-0000-0000-0000-00000000000c','c0000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','C1-000002',3000,'2026-11-07 00:10-03');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.v_sales_integrity_issues WHERE ticket_number='C1-000002') = 1,
         'La venta sin items ni pagos debia aparecer en v_sales_integrity_issues';
  ASSERT (SELECT count(*) FROM public.v_sales_integrity_issues WHERE ticket_number IN ('C1-000001','C2-000001')) = 0,
         'Las ventas correctas NO deben aparecer';
END $$;
-- Dos posnets sin conexion repiten un numero de ticket: la venta NO se
-- rechaza (ya se cobro) y el conflicto queda listado para revisar.
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.v_ticket_number_conflicts) = 0, 'Sin numeros repetidos todavia';
END $$;
INSERT INTO public.sales (id, club_id, cash_register_id, cash_shift_id, cashier_user_id, ticket_number, total, created_at_device) VALUES
 ('60000000-0000-0000-0000-00000000000e','c0000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','C1-000001',0,'2026-11-07 00:15-03');
DO $$ BEGIN
  ASSERT (SELECT sales_count FROM public.v_ticket_number_conflicts WHERE ticket_number='C1-000001') = 2,
         'El numero repetido debia quedar listado con sus 2 ventas';
END $$;

-- ---- 9) La reversa vuelve a la ubicacion donde se desconto -----------
-- Venta D: 1 Heineken desde Caja 1 (Barra A). Despues el encargado mueve
-- la Caja 1 al Deposito. La barra sustituye la Heineken por una Corona
-- (mas barata): la Heineken debe volver a Barra A, no al Deposito.
INSERT INTO public.sales (id, club_id, cash_register_id, cash_shift_id, cashier_user_id, ticket_number, total, created_at_device) VALUES
 ('60000000-0000-0000-0000-00000000000d','c0000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','C1-000003',6000,'2026-11-07 00:20-03');
INSERT INTO public.sale_items (id, club_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total) VALUES
 ('70000000-0000-0000-0000-00000000000d','c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-00000000000d','40000000-0000-0000-0000-000000000002','Heineken',1,6000,2000,6000);
UPDATE public.cash_registers SET inventory_location_id = '10000000-0000-0000-0000-0000000000ad'
 WHERE id = '20000000-0000-0000-0000-000000000001';
INSERT INTO public.sale_item_substitutions (id, club_id, sale_id, sale_item_id, quantity, reason,
   substitute_product_id, substitute_product_name, substitute_unit_price, substitute_unit_cost,
   location_id, authorized_by_user_id, occurred_at) VALUES
 ('80000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-00000000000d','70000000-0000-0000-0000-00000000000d',1,'customer_request',
   '40000000-0000-0000-0000-000000000001','Corona',5000,1000,
   '10000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-000000000003','2026-11-07 00:30-03');
DO $$ BEGIN
  ASSERT (SELECT quantity FROM public.inventory_balances
           WHERE location_id='10000000-0000-0000-0000-00000000000a' AND product_id='40000000-0000-0000-0000-000000000002') = 9,
         'La Heineken debe volver a Barra A (10 -1 -1 +1 = 9)';
  ASSERT NOT EXISTS (SELECT 1 FROM public.inventory_balances WHERE location_id='10000000-0000-0000-0000-0000000000ad'),
         'El Deposito no debe recibir la reversa';
  ASSERT (SELECT quantity FROM public.inventory_balances
           WHERE location_id='10000000-0000-0000-0000-00000000000a' AND product_id='40000000-0000-0000-0000-000000000001') = -1,
         'La Corona entregada deja el saldo en -1';
  ASSERT (SELECT count(*) FROM public.stock_alerts WHERE product_id='40000000-0000-0000-0000-000000000001' AND status='open') = 1,
         'Se abre una alerta NUEVA (la anterior quedo resuelta)';
  ASSERT (SELECT count(*) FROM public.stock_alerts WHERE product_id='40000000-0000-0000-0000-000000000001' AND status='resolved') = 1,
         'La alerta anterior sigue en el historial';
  -- Reemplazo mas barato: el descuento da negativo (el cliente pago de mas)
  ASSERT (SELECT substitution_discount FROM public.v_sale_item_financials WHERE sale_item_id='70000000-0000-0000-0000-00000000000d') = -1000,
         'Reemplazo mas barato: descuento -1000';
  ASSERT (SELECT gross_margin FROM public.v_sale_item_financials WHERE sale_item_id='70000000-0000-0000-0000-00000000000d') = 5000,
         'Margen = 6000 cobrados - 1000 de costo real';
END $$;

-- ---- 10) El saldo SIEMPRE es la suma de los movimientos --------------
DO $$ BEGIN
  ASSERT NOT EXISTS (
      SELECT 1 FROM public.inventory_balances b
       WHERE b.quantity <> (SELECT COALESCE(sum(m.quantity), 0) FROM public.inventory_movements m
                             WHERE m.location_id = b.location_id AND m.product_id = b.product_id)),
      'Hay saldos que no coinciden con la suma de movimientos';
END $$;

ROLLBACK;
