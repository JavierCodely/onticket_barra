-- PRUEBA 020: impuestos por club (vista previa, calculo, pago mixto,
-- activar/desactivar sin perder historial), jornada y estadisticas.
BEGIN;
\ir fixture.sql

-- Impuestos del Club A:  Comision tarjeta 3 % (tarjeta)
--                        Imp debitos y creditos 1,2 % (tarjeta y transferencia)
--                        Tasa fija $50 por unidad (todos los metodos)
-- Club B: un impuesto propio, para probar el aislamiento.
INSERT INTO public.taxes (id, club_id, name, kind, percentage, fixed_amount) VALUES
 ('90000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','Comision tarjeta','percentage',3,NULL),
 ('90000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-00000000000a','Imp debitos y creditos','percentage',1.2,NULL),
 ('90000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-00000000000a','Tasa fija','fixed',NULL,50),
 ('90000000-0000-0000-0000-00000000000b','c0000000-0000-0000-0000-00000000000b','Impuesto de B','percentage',5,NULL);
INSERT INTO public.tax_payment_methods (club_id, tax_id, method) VALUES
 ('c0000000-0000-0000-0000-00000000000a','90000000-0000-0000-0000-000000000001','card'),
 ('c0000000-0000-0000-0000-00000000000a','90000000-0000-0000-0000-000000000002','card'),
 ('c0000000-0000-0000-0000-00000000000a','90000000-0000-0000-0000-000000000002','transfer'),
 ('c0000000-0000-0000-0000-00000000000b','90000000-0000-0000-0000-00000000000b','card');
INSERT INTO public.tax_payment_methods (club_id, tax_id, method)
SELECT 'c0000000-0000-0000-0000-00000000000a', '90000000-0000-0000-0000-000000000003', pm.code
  FROM public.payment_methods pm;

-- ---- 1) Vista previa al cargar un producto (precio 5000, costo 1000) -
SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a1');   -- Ana
DO $$
DECLARE c CONSTANT uuid := 'c0000000-0000-0000-0000-00000000000a';
BEGIN
  ASSERT (SELECT max(total_taxes)        FROM public.product_tax_preview(c,5000,1000) WHERE payment_method='cash')     = 50,   'Efectivo: impuestos 50';
  ASSERT (SELECT max(margin_after_taxes) FROM public.product_tax_preview(c,5000,1000) WHERE payment_method='cash')     = 3950, 'Efectivo: margen 3950';
  ASSERT (SELECT max(total_taxes)        FROM public.product_tax_preview(c,5000,1000) WHERE payment_method='transfer') = 110,  'Transferencia: impuestos 110';
  ASSERT (SELECT max(margin_after_taxes) FROM public.product_tax_preview(c,5000,1000) WHERE payment_method='transfer') = 3890, 'Transferencia: margen 3890';
  ASSERT (SELECT max(total_taxes)        FROM public.product_tax_preview(c,5000,1000) WHERE payment_method='card')     = 260,  'Tarjeta: impuestos 260';
  ASSERT (SELECT max(net_after_taxes)    FROM public.product_tax_preview(c,5000,1000) WHERE payment_method='card')     = 4740, 'Tarjeta: neto 4740';
  ASSERT (SELECT max(margin_after_taxes) FROM public.product_tax_preview(c,5000,1000) WHERE payment_method='card')     = 3740, 'Tarjeta: margen 3740';
  ASSERT (SELECT max(margin_pct)         FROM public.product_tax_preview(c,5000,1000) WHERE payment_method='card')     = 74.80, 'Tarjeta: margen 74,80 %';
  ASSERT (SELECT count(*) FROM public.product_tax_preview(c,5000,1000) WHERE payment_method='card') = 3, 'Tarjeta: 3 impuestos, cada uno con su nombre';
  ASSERT (SELECT tax_name FROM public.product_tax_preview(c,5000,1000) WHERE payment_method='cash') = 'Tasa fija', 'Debe mostrar el nombre del impuesto';
  ASSERT (SELECT payment_method_label FROM public.product_tax_preview(c,5000,1000) WHERE payment_method='cash') = 'Efectivo', 'Debe traer la etiqueta del metodo';
  ASSERT (SELECT tax_amount FROM public.product_tax_preview(c,5000,1000) WHERE payment_method='card' AND tax_name='Comision tarjeta') = 150, 'Comision tarjeta: 150';
  -- los metodos salen en orden: efectivo, transferencia, tarjeta, otro
  ASSERT (SELECT array_agg(y.method ORDER BY y.first_row)
            FROM (SELECT x.payment_method AS method, min(x.rn) AS first_row
                    FROM (SELECT p.payment_method, row_number() OVER () AS rn
                            FROM public.product_tax_preview(c,5000,1000) p) x
                   GROUP BY x.payment_method) y) = ARRAY['cash','transfer','card','other'],
         'Orden de los metodos de pago';
  -- sin precio todavia (campo vacio en el formulario): no devuelve filas ni falla
  ASSERT (SELECT count(*) FROM public.product_tax_preview(c,NULL,1000)) = 0, 'Precio vacio: sin filas';
  -- precio 0: no divide por cero
  ASSERT (SELECT max(margin_pct) FROM public.product_tax_preview(c,0,0) WHERE payment_method='card') IS NULL, 'Precio 0: porcentaje vacio';
END $$;
SELECT public.t_logout();

-- Aislamiento: Luis (Club B) no ve ni calcula con los impuestos del Club A
SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a2');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.product_tax_preview('c0000000-0000-0000-0000-00000000000b',5000,1000) WHERE tax_id IS NULL) = 3,
         'Club B: efectivo, transferencia y otro no tienen impuestos';
  ASSERT (SELECT max(margin_after_taxes) FROM public.product_tax_preview('c0000000-0000-0000-0000-00000000000b',5000,1000) WHERE payment_method='cash') = 4000,
         'Sin impuestos el margen es precio - costo';
  ASSERT (SELECT count(*) FROM public.taxes) = 1, 'Luis ve solo el impuesto de su club';
  ASSERT (SELECT count(*) FROM public.product_tax_preview('c0000000-0000-0000-0000-00000000000a',5000,1000)) = 0,
         'Luis NO puede previsualizar el Club A';
END $$;
SELECT public.t_logout();

-- ---- 2) Ventas con impuestos (la foto la calcula el posnet) ----------
SELECT public.t_as_service();
-- S1: viernes 23:30 - Corona x1 = 5000, todo con tarjeta
INSERT INTO public.sales (id, club_id, cash_register_id, cash_shift_id, cashier_user_id, ticket_number, total, created_at_device) VALUES
 ('61000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','C1-100',5000,'2026-11-06 23:30-03');
INSERT INTO public.sale_items (id, club_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total) VALUES
 ('71000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','61000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Corona',1,5000,1000,5000);
INSERT INTO public.sale_payments (id, club_id, sale_id, method, amount) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','61000000-0000-0000-0000-000000000001','card',5000);
INSERT INTO public.sale_item_taxes (id, club_id, sale_id, sale_item_id, tax_id, tax_name, kind, percentage, fixed_amount, applies_to_methods, taxable_ratio, amount) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','61000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','Comision tarjeta','percentage',3,NULL,'card',1,150),
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','61000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002','Imp debitos y creditos','percentage',1.2,NULL,'card,transfer',1,60),
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','61000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000003','Tasa fija','fixed',NULL,50,'cash,transfer,card,other',1,50);

-- S3: sabado 03:00 (misma noche) - Heineken x2 = 12000, pago MIXTO:
--     6000 efectivo + 6000 tarjeta. La tarjeta cubre la mitad (ratio 0,5):
--     12000 x 3 % x 0,5 = 180 | 12000 x 1,2 % x 0,5 = 72 | fijo 50 x 2 = 100
INSERT INTO public.sales (id, club_id, cash_register_id, cash_shift_id, cashier_user_id, ticket_number, total, created_at_device) VALUES
 ('61000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','C2-100',12000,'2026-11-07 03:00-03');
INSERT INTO public.sale_items (id, club_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total) VALUES
 ('71000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-00000000000a','61000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000002','Heineken',2,6000,2000,12000);
INSERT INTO public.sale_payments (id, club_id, sale_id, method, amount) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','61000000-0000-0000-0000-000000000003','cash',6000),
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','61000000-0000-0000-0000-000000000003','card',6000);
INSERT INTO public.sale_item_taxes (id, club_id, sale_id, sale_item_id, tax_id, tax_name, kind, percentage, fixed_amount, applies_to_methods, taxable_ratio, amount) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','61000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000001','Comision tarjeta','percentage',3,NULL,'card',0.5,180),
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','61000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000002','Imp debitos y creditos','percentage',1.2,NULL,'card,transfer',0.5,72),
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','61000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000003','Tasa fija','fixed',NULL,50,'cash,transfer,card,other',1,100);

DO $$
DECLARE c CONSTANT uuid := 'c0000000-0000-0000-0000-00000000000a';
BEGIN
  ASSERT (SELECT count(*) FROM public.v_sale_tax_issues) = 0, 'Montos correctos (incluido el pago mixto): sin problemas';
  ASSERT (SELECT tax_total  FROM public.v_sale_item_financials WHERE sale_item_id='71000000-0000-0000-0000-000000000001') = 260,  'S1 impuestos 260';
  ASSERT (SELECT net_margin FROM public.v_sale_item_financials WHERE sale_item_id='71000000-0000-0000-0000-000000000001') = 3740, 'S1 margen neto 3740';
  ASSERT (SELECT tax_total  FROM public.v_sale_item_financials WHERE sale_item_id='71000000-0000-0000-0000-000000000003') = 352,  'S3 impuestos 352';
  ASSERT (SELECT net_margin FROM public.v_sale_item_financials WHERE sale_item_id='71000000-0000-0000-0000-000000000003') = 7648, 'S3 margen neto 7648';
  -- JORNADA: la venta del sabado 03:00 pertenece a la noche del viernes
  ASSERT (SELECT business_day FROM public.v_sale_item_financials WHERE sale_item_id='71000000-0000-0000-0000-000000000003') = DATE '2026-11-06',
         'La venta de las 03:00 del sabado es de la jornada del viernes';
  ASSERT (SELECT count(*) FROM public.v_club_daily_stats WHERE club_id = c) = 1, 'Toda la noche es UNA jornada';
  ASSERT (SELECT business_day FROM public.v_club_daily_stats WHERE club_id = c) = DATE '2026-11-06', 'Jornada = viernes';
  ASSERT (SELECT tickets      FROM public.v_club_daily_stats WHERE club_id = c) = 2,     'Tickets 2';
  ASSERT (SELECT units        FROM public.v_club_daily_stats WHERE club_id = c) = 3,     'Unidades 3';
  ASSERT (SELECT revenue      FROM public.v_club_daily_stats WHERE club_id = c) = 17000, 'Ingresos 17000';
  ASSERT (SELECT cost         FROM public.v_club_daily_stats WHERE club_id = c) = 5000,  'Costo 5000';
  ASSERT (SELECT gross_margin FROM public.v_club_daily_stats WHERE club_id = c) = 12000, 'Margen bruto 12000';
  ASSERT (SELECT taxes        FROM public.v_club_daily_stats WHERE club_id = c) = 612,   'Impuestos 612';
  ASSERT (SELECT net_margin   FROM public.v_club_daily_stats WHERE club_id = c) = 11388, 'Margen neto 11388';
  ASSERT (SELECT count(*) FROM public.v_club_daily_stats WHERE club_id='c0000000-0000-0000-0000-00000000000b') = 0, 'El Club B no tiene estadisticas del A';
END $$;
SELECT public.t_logout();

-- ---- 3) DESACTIVAR un impuesto desde el panel ------------------------
SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a1');   -- Ana
UPDATE public.taxes SET active = false WHERE id = '90000000-0000-0000-0000-000000000001';
DO $$
DECLARE c CONSTANT uuid := 'c0000000-0000-0000-0000-00000000000a';
BEGIN
  -- Las ventas NUEVAS ya no lo incluyen
  ASSERT (SELECT max(total_taxes) FROM public.product_tax_preview(c,5000,1000) WHERE payment_method='card') = 110, 'Tarjeta sin la comision: 110';
  ASSERT (SELECT count(*) FROM public.product_tax_preview(c,5000,1000) WHERE payment_method='card') = 2, 'Tarjeta: quedan 2 impuestos';
  ASSERT (SELECT max(margin_after_taxes) FROM public.product_tax_preview(c,5000,1000) WHERE payment_method='card') = 3890, 'Tarjeta: margen 3890';
  -- El impuesto sigue existiendo (no se borra), solo esta inactivo
  ASSERT (SELECT count(*) FROM public.taxes WHERE NOT active) = 1, 'El impuesto desactivado sigue en la lista';
  -- Queda registrado quien lo desactivo
  ASSERT (SELECT count(*) FROM public.audit_log WHERE action='tax.deactivated' AND actor_type='platform_admin'
            AND actor_id='a0000000-0000-0000-0000-000000000001' AND entity_id='90000000-0000-0000-0000-000000000001') = 1,
         'Debia auditarse tax.deactivated con su autor';
END $$;

-- Renombrar, cambiar la tasa y reactivar
UPDATE public.taxes SET name = 'Comision tarjeta VISA', percentage = 3.5 WHERE id = '90000000-0000-0000-0000-000000000001';
UPDATE public.taxes SET active = true WHERE id = '90000000-0000-0000-0000-000000000001';
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.audit_log WHERE action='tax.updated'
            AND details -> 'percentage' ->> 'from' = '3.0000' AND details -> 'percentage' ->> 'to' = '3.5000') = 1,
         'tax.updated guarda el valor anterior y el nuevo';
  ASSERT (SELECT count(*) FROM public.audit_log WHERE action='tax.activated') = 1, 'Debia auditarse tax.activated';
END $$;
UPDATE public.taxes SET active = false WHERE id = '90000000-0000-0000-0000-000000000001';

-- Alta de un impuesto nuevo con sus metodos; quitar un metodo
INSERT INTO public.taxes (club_id, name, kind, fixed_amount) VALUES ('c0000000-0000-0000-0000-00000000000a','Impuesto nuevo','fixed',10);
INSERT INTO public.tax_payment_methods (club_id, tax_id, method)
SELECT t.club_id, t.id, 'other' FROM public.taxes t WHERE t.name = 'Impuesto nuevo';
DELETE FROM public.tax_payment_methods
 WHERE tax_id = '90000000-0000-0000-0000-000000000003' AND method = 'other';
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.audit_log WHERE action='tax.created') = 1, 'Debia auditarse tax.created';
  ASSERT (SELECT count(*) FROM public.audit_log WHERE action='tax.method_added') = 1, 'Debia auditarse tax.method_added';
  ASSERT (SELECT count(*) FROM public.audit_log WHERE action='tax.method_removed' AND details ->> 'method' = 'other') = 1, 'Debia auditarse tax.method_removed';
  ASSERT (SELECT max(total_taxes) FROM public.product_tax_preview('c0000000-0000-0000-0000-00000000000a',5000,1000) WHERE payment_method='other') = 10,
         'Otro: ya no paga la tasa fija, solo el impuesto nuevo';
END $$;

-- Lo que el panel NO puede hacer con impuestos
SELECT public.t_expect_error('DELETE FROM public.taxes', 'permission denied');                    -- no se borran
SELECT public.t_expect_error($$UPDATE public.taxes SET club_id = 'c0000000-0000-0000-0000-00000000000b'$$, 'permission denied');
SELECT public.t_expect_error($$INSERT INTO public.taxes (club_id, name, kind, percentage) VALUES ('c0000000-0000-0000-0000-00000000000b','Ajeno','percentage',1)$$, 'row-level security');
SELECT public.t_expect_error($$INSERT INTO public.tax_payment_methods (club_id, tax_id, method) VALUES ('c0000000-0000-0000-0000-00000000000b','90000000-0000-0000-0000-00000000000b','cash')$$, 'row-level security');
SELECT public.t_expect_error('UPDATE public.sale_item_taxes SET amount = 0', 'permission denied');
SELECT public.t_logout();

-- ---- 4) El historial NO cambia al desactivar, renombrar o cambiar la tasa
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.sale_item_taxes WHERE sale_item_id='71000000-0000-0000-0000-000000000001') = 3,
         'La venta anterior sigue mostrando sus 3 impuestos';
  ASSERT (SELECT tax_name FROM public.sale_item_taxes WHERE tax_id='90000000-0000-0000-0000-000000000001' AND sale_id='61000000-0000-0000-0000-000000000001') = 'Comision tarjeta',
         'Conserva el nombre que tenia al vender';
  ASSERT (SELECT percentage FROM public.sale_item_taxes WHERE tax_id='90000000-0000-0000-0000-000000000001' AND sale_id='61000000-0000-0000-0000-000000000001') = 3,
         'Conserva la tasa que tenia al vender';
  ASSERT (SELECT amount FROM public.sale_item_taxes WHERE tax_id='90000000-0000-0000-0000-000000000001' AND sale_id='61000000-0000-0000-0000-000000000001') = 150,
         'El monto historico no cambia';
  ASSERT (SELECT net_margin FROM public.v_sale_item_financials WHERE sale_item_id='71000000-0000-0000-0000-000000000001') = 3740,
         'El margen neto de la venta anterior no cambia';
  ASSERT (SELECT sum(amount) FROM public.v_sale_taxes_detail WHERE sale_id='61000000-0000-0000-0000-000000000001') = 260,
         'El detalle por venta sigue sumando 260';
  ASSERT (SELECT count(*) FROM public.v_sale_tax_issues) = 0, 'Cambiar el impuesto no vuelve "incorrectas" las ventas viejas';
END $$;

-- ---- 5) Montos mal calculados: se listan para revisar, no se bloquean -
-- Sabado 13:00: ya es OTRA jornada.
SELECT public.t_as_service();
INSERT INTO public.sales (id, club_id, cash_register_id, cash_shift_id, cashier_user_id, ticket_number, total, created_at_device) VALUES
 ('61000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','C1-101',5000,'2026-11-07 13:00-03');
INSERT INTO public.sale_items (id, club_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total) VALUES
 ('71000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-00000000000a','61000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','Corona',1,5000,1000,5000);
INSERT INTO public.sale_payments (id, club_id, sale_id, method, amount) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','61000000-0000-0000-0000-000000000002','cash',5000);
INSERT INTO public.sale_item_taxes (id, club_id, sale_id, sale_item_id, tax_id, tax_name, kind, percentage, fixed_amount, applies_to_methods, taxable_ratio, amount) VALUES
 -- monto mal calculado (debia ser 50)
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','61000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000003','Tasa fija','fixed',NULL,50,'cash,transfer,card',1,999),
 -- comision de tarjeta en una venta cobrada en efectivo
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','61000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001','Comision tarjeta','percentage',3,NULL,'card',1,150);
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.v_sale_tax_issues WHERE ticket_number='C1-101') = 2, 'Debian detectarse los 2 impuestos mal calculados';
  ASSERT (SELECT count(*) FROM public.v_sale_tax_issues WHERE ticket_number IN ('C1-100','C2-100')) = 0, 'Las ventas correctas no se marcan';
  ASSERT (SELECT count(*) FROM public.v_club_daily_stats WHERE club_id='c0000000-0000-0000-0000-00000000000a') = 2, 'La venta del sabado 13:00 abre otra jornada';
  ASSERT (SELECT business_day FROM public.v_sale_item_financials WHERE sale_item_id='71000000-0000-0000-0000-000000000002') = DATE '2026-11-07', 'Jornada = sabado';
END $$;

-- ---- 6) Reglas de la base --------------------------------------------
SELECT public.t_expect_error($$INSERT INTO public.taxes (club_id,name,kind,percentage,fixed_amount) VALUES ('c0000000-0000-0000-0000-00000000000a','Doble','percentage',3,50)$$, 'taxes_value_check');
SELECT public.t_expect_error($$INSERT INTO public.taxes (club_id,name,kind,percentage) VALUES ('c0000000-0000-0000-0000-00000000000a','Mayor a 100','percentage',150)$$, 'taxes_value_check');
SELECT public.t_expect_error($$INSERT INTO public.taxes (club_id,name,kind) VALUES ('c0000000-0000-0000-0000-00000000000a','Fijo sin valor','fixed')$$, 'taxes_value_check');
SELECT public.t_expect_error($$INSERT INTO public.taxes (club_id,name,kind) VALUES ('c0000000-0000-0000-0000-00000000000a','Porcentaje sin valor','percentage')$$, 'taxes_value_check');
SELECT public.t_expect_error($$INSERT INTO public.taxes (club_id,name,kind,fixed_amount) VALUES ('c0000000-0000-0000-0000-00000000000a','   ','fixed',5)$$, 'taxes_name_not_blank');
SELECT public.t_expect_error($$INSERT INTO public.taxes (club_id,name,kind,percentage) VALUES ('c0000000-0000-0000-0000-00000000000a','tasa FIJA','percentage',1)$$, 'uq_taxes_club_name');
SELECT public.t_expect_error($$INSERT INTO public.tax_payment_methods (club_id,tax_id,method) VALUES ('c0000000-0000-0000-0000-00000000000a','90000000-0000-0000-0000-000000000003','cash')$$, 'tax_payment_methods_unique');
SELECT public.t_expect_error($$INSERT INTO public.tax_payment_methods (club_id,tax_id,method) VALUES ('c0000000-0000-0000-0000-00000000000a','90000000-0000-0000-0000-000000000003','bitcoin')$$, 'foreign key');
SELECT public.t_expect_error('UPDATE public.sale_item_taxes SET amount = 0', 'solo agregar');
-- impuesto de OTRO club en una venta
SELECT public.t_expect_error($$INSERT INTO public.sale_item_taxes (id, club_id, sale_id, sale_item_id, tax_id, tax_name, kind, percentage, applies_to_methods, taxable_ratio, amount)
   VALUES (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','61000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-00000000000b','Ajeno','percentage',5,'card',1,1)$$, 'foreign key');
-- el mismo impuesto dos veces sobre el mismo item
SELECT public.t_expect_error($$INSERT INTO public.sale_item_taxes (id, club_id, sale_id, sale_item_id, tax_id, tax_name, kind, percentage, applies_to_methods, taxable_ratio, amount)
   VALUES (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','61000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','Comision tarjeta','percentage',3,'card',1,150)$$, 'sale_item_taxes_one_per_item');

ROLLBACK;
