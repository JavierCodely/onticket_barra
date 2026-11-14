-- PRUEBA 120: promociones (archivo 18).
-- Tipos y sus limites; solo sobre un producto (no combo); solo barras;
-- condiciones fijas; vigencia ahora (fechas y dias de la jornada, franja
-- que cruza la medianoche); la venta guarda precio de lista, descuento y
-- lo cobrado; impuestos sobre lo cobrado; reportes con el descuento
-- aparte de la sustitucion; control de descuentos mal calculados;
-- auditoria; aislamiento entre clubs; encargado; anon sin acceso.
BEGIN;
\ir fixture.sql

-- Datos de la prueba como duenio: barra VIP, un combo y un impuesto PIX 3 %
INSERT INTO public.inventory_locations (id, club_id, name, kind) VALUES
    ('10000000-0000-0000-0000-0000000000f1', 'c0000000-0000-0000-0000-00000000000a', 'Barra VIP', 'bar');
INSERT INTO public.products (id, club_id, name, cost, price, kind) VALUES
    ('40000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-00000000000a', 'Combo vacio', 0, 0, 'combo');
INSERT INTO public.taxes (id, club_id, name, kind, percentage) VALUES
    ('90000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-00000000000a', 'Comision PIX', 'percentage', 3);

-- ---- 1) Alta --------------------------------------------------------
-- P1 a P3 con ids fijos (el panel no manda id: los crea el duenio de la base)
-- P1: 20 % en Corona, sin limites
INSERT INTO public.promotions (id, club_id, product_id, name, kind, percentage) VALUES
    ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000a',
     '40000000-0000-0000-0000-000000000001', '  Corona 20 %  ', 'percentage', 20)
RETURNING id, name, weekdays, active;
-- P2: 2x1 en Heineken, solo en la barra VIP
INSERT INTO public.promotions (id, club_id, product_id, name, kind, buy_quantity, pay_quantity) VALUES
    ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000000a',
     '40000000-0000-0000-0000-000000000002', '2x1 Heineken', 'nxm', 2, 1)
RETURNING id;
-- P3: $1000 menos por unidad en Corona, happy hour de 23:00 a 02:00 (cruza la medianoche)
INSERT INTO public.promotions (id, club_id, product_id, name, kind, fixed_amount, start_time, end_time) VALUES
    ('e0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-00000000000a',
     '40000000-0000-0000-0000-000000000001', 'Happy hour Corona', 'fixed_amount', 1000, '23:00', '02:00')
RETURNING id;

SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a1');   -- Ana, club A
-- Alta desde el panel, con RETURNING como supabase-js
INSERT INTO public.promotions (club_id, product_id, name, kind, percentage, weekdays, start_time, end_time) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000002', 'Happy hour viernes', 'percentage', 15, 16, '00:00', '01:30')
RETURNING id, name, active;
INSERT INTO public.promotion_locations (club_id, promotion_id, location_id) VALUES
    ('c0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000f1')
RETURNING id;

DO $$ BEGIN
    ASSERT (SELECT name FROM public.promotions WHERE id = 'e0000000-0000-0000-0000-000000000001') = 'Corona 20 %',
           'El nombre se guarda sin espacios de mas';
    ASSERT (SELECT weekdays FROM public.promotions WHERE id = 'e0000000-0000-0000-0000-000000000001') = 127,
           'Por defecto vale todos los dias';
END $$;

-- ---- 2) Limites de cada tipo ------------------------------------------
SELECT public.t_expect_error($$INSERT INTO public.promotions (club_id, product_id, name, kind, percentage) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', 'x', 'percentage', 0)$$, 'promotions_values_check');
SELECT public.t_expect_error($$INSERT INTO public.promotions (club_id, product_id, name, kind, percentage) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', 'x', 'percentage', 101)$$, 'promotions_values_check');
SELECT public.t_expect_error($$INSERT INTO public.promotions (club_id, product_id, name, kind, percentage, fixed_amount) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', 'x', 'percentage', 10, 5)$$, 'promotions_values_check');
SELECT public.t_expect_error($$INSERT INTO public.promotions (club_id, product_id, name, kind, fixed_amount) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', 'x', 'fixed_amount', 0)$$, 'promotions_values_check');
SELECT public.t_expect_error($$INSERT INTO public.promotions (club_id, product_id, name, kind, buy_quantity, pay_quantity) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', 'x', 'nxm', 2, 2)$$, 'promotions_values_check');
SELECT public.t_expect_error($$INSERT INTO public.promotions (club_id, product_id, name, kind, buy_quantity, pay_quantity) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', 'x', 'nxm', 1, 0)$$, 'promotions_values_check');
SELECT public.t_expect_error($$INSERT INTO public.promotions (club_id, product_id, name, kind, percentage) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', 'x', 'otro', 10)$$, 'promotions_kind_check');
SELECT public.t_expect_error($$INSERT INTO public.promotions (club_id, product_id, name, kind, percentage) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', '   ', 'percentage', 10)$$, 'promotions_name_check');
-- Vigencia
SELECT public.t_expect_error($$INSERT INTO public.promotions (club_id, product_id, name, kind, percentage, starts_on, ends_on) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', 'x', 'percentage', 10, '2026-12-10', '2026-12-01')$$, 'promotions_dates_check');
SELECT public.t_expect_error($$INSERT INTO public.promotions (club_id, product_id, name, kind, percentage, weekdays) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', 'x', 'percentage', 10, 0)$$, 'promotions_weekdays_check');
SELECT public.t_expect_error($$INSERT INTO public.promotions (club_id, product_id, name, kind, percentage, start_time) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', 'x', 'percentage', 10, '23:00')$$, 'promotions_time_check');
SELECT public.t_expect_error($$INSERT INTO public.promotions (club_id, product_id, name, kind, percentage, start_time, end_time) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', 'x', 'percentage', 10, '23:00', '23:00')$$, 'promotions_time_check');
-- Solo un producto: no un combo, no de otro club
SELECT public.t_expect_error($$INSERT INTO public.promotions (club_id, product_id, name, kind, percentage) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000c1', 'x', 'percentage', 10)$$, 'no un combo');
SELECT public.t_expect_error($$INSERT INTO public.promotions (club_id, product_id, name, kind, percentage) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000b', 'x', 'percentage', 10)$$, 'producto del club');
-- Barras: solo barras, una vez cada una, del mismo club
SELECT public.t_expect_error($$INSERT INTO public.promotion_locations (club_id, promotion_id, location_id) VALUES
    ('c0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000ad')$$, 'solo se limita a barras');
SELECT public.t_expect_error($$INSERT INTO public.promotion_locations (club_id, promotion_id, location_id) VALUES
    ('c0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000f1')$$, 'promotion_locations_one_per_bar');
SELECT public.t_expect_error($$INSERT INTO public.promotion_locations (club_id, promotion_id, location_id) VALUES
    ('c0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000b')$$, 'solo se limita a barras');

-- ---- 3) Que se puede cambiar ------------------------------------------
-- Las condiciones no (el panel ni siquiera tiene permiso)
SELECT public.t_expect_error($$UPDATE public.promotions SET percentage = 50 WHERE id = 'e0000000-0000-0000-0000-000000000001'$$, 'permission denied');
SELECT public.t_expect_error($$UPDATE public.promotions SET product_id = '40000000-0000-0000-0000-000000000002'$$, 'permission denied');
SELECT public.t_expect_error($$UPDATE public.promotions SET kind = 'fixed_amount'$$, 'permission denied');
SELECT public.t_expect_error($$UPDATE public.promotions SET club_id = 'c0000000-0000-0000-0000-00000000000b'$$, 'permission denied');
-- No se borra: se desactiva
SELECT public.t_expect_error($$DELETE FROM public.promotions$$, 'permission denied');
-- Nombre, vigencia y active si
UPDATE public.promotions SET name = 'Corona al 20', weekdays = 48, starts_on = '2026-11-01'
 WHERE id = 'e0000000-0000-0000-0000-000000000001' RETURNING name;
UPDATE public.promotions SET active = false WHERE id = 'e0000000-0000-0000-0000-000000000001';
UPDATE public.promotions SET active = true WHERE id = 'e0000000-0000-0000-0000-000000000001';
UPDATE public.promotions SET weekdays = 127, starts_on = NULL WHERE id = 'e0000000-0000-0000-0000-000000000001';
-- Quitar la barra VIP y volver a ponerla
DELETE FROM public.promotion_locations WHERE promotion_id = 'e0000000-0000-0000-0000-000000000002';
INSERT INTO public.promotion_locations (club_id, promotion_id, location_id) VALUES
    ('c0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000f1');
SELECT public.t_logout();

DO $$ BEGIN
    ASSERT (SELECT array_agg(DISTINCT action) FROM public.audit_log WHERE entity_type = 'promotion')
           @> ARRAY['promotion.created', 'promotion.updated', 'promotion.deactivated', 'promotion.activated',
                    'promotion.bar_added', 'promotion.bar_removed'],
           'Alta, cambios, activar/desactivar y barras quedan auditados';
    ASSERT EXISTS (SELECT 1 FROM public.audit_log
                    WHERE action = 'promotion.updated' AND entity_id = 'e0000000-0000-0000-0000-000000000001'
                      AND details -> 'name' ->> 'from' = 'Corona 20 %' AND details -> 'name' ->> 'to' = 'Corona al 20'
                      AND actor_type = 'platform_admin'),
           'El cambio de nombre guarda antes, despues y autor';
END $$;

-- Ni un service_role cambia las condiciones
SELECT public.t_as_service();
SELECT public.t_expect_error($$UPDATE public.promotions SET percentage = 50 WHERE id = 'e0000000-0000-0000-0000-000000000001'$$, 'no cambian');
SELECT public.t_expect_error($$UPDATE public.promotions SET pay_quantity = 0 WHERE id = 'e0000000-0000-0000-0000-000000000002'$$, 'no cambian');
SELECT public.t_expect_error($$UPDATE public.promotions SET club_id = 'c0000000-0000-0000-0000-00000000000b'$$, 'otro club');
SELECT public.t_logout();


-- ---- 4) Vigencia ahora (v_promotions_status) --------------------------
-- La hora local y la jornada del club A, calculadas aca para no depender
-- del momento en que corre la prueba.
CREATE TEMP TABLE t_ahora AS
SELECT x.local_ts,
       (x.local_ts - make_interval(hours => c.business_day_start_hour))::date AS jornada
  FROM public.clubs c
 CROSS JOIN LATERAL (SELECT now() AT TIME ZONE c.timezone AS local_ts) x
 WHERE c.id = 'c0000000-0000-0000-0000-00000000000a';
GRANT SELECT ON t_ahora TO authenticated;

INSERT INTO public.promotions (id, club_id, product_id, name, kind, percentage, weekdays, start_time, end_time, starts_on, ends_on)
SELECT v.id::uuid, 'c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000002', v.name, 'percentage', 10,
       v.weekdays, v.start_time, v.end_time, v.starts_on, v.ends_on
  FROM t_ahora a
 CROSS JOIN LATERAL (VALUES
    -- franja que incluye ahora (de 1 h antes a 1 h despues; puede cruzar la medianoche)
    ('e0000000-0000-0000-0000-0000000000a1', 'en franja', 127::smallint,
         (a.local_ts - interval '1 hour')::time, (a.local_ts + interval '1 hour')::time, NULL::date, NULL::date),
    -- franja que empieza en 1 h: ahora no
    ('e0000000-0000-0000-0000-0000000000a2', 'fuera de franja', 127::smallint,
         (a.local_ts + interval '1 hour')::time, (a.local_ts + interval '2 hours')::time, NULL, NULL),
    -- solo el dia de la jornada de hoy
    ('e0000000-0000-0000-0000-0000000000a3', 'hoy', (1 << (extract(isodow FROM a.jornada)::int - 1))::smallint,
         NULL::time, NULL::time, NULL, NULL),
    -- todos los dias menos hoy
    ('e0000000-0000-0000-0000-0000000000a4', 'otro dia', (127 - (1 << (extract(isodow FROM a.jornada)::int - 1)))::smallint,
         NULL, NULL, NULL, NULL),
    -- termino ayer
    ('e0000000-0000-0000-0000-0000000000a5', 'vencida', 127::smallint, NULL, NULL, a.jornada - 10, a.jornada - 1),
    -- empieza maniana
    ('e0000000-0000-0000-0000-0000000000a6', 'futura', 127::smallint, NULL, NULL, a.jornada + 1, NULL),
    -- solo hoy (desde = hasta = la jornada)
    ('e0000000-0000-0000-0000-0000000000a7', 'solo hoy', 127::smallint, NULL, NULL, a.jornada, a.jornada)
 ) AS v(id, name, weekdays, start_time, end_time, starts_on, ends_on);

SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a1');
UPDATE public.promotions SET active = false WHERE id = 'e0000000-0000-0000-0000-0000000000a7';
DO $$
DECLARE
    f record;
BEGIN
    FOR f IN SELECT p.name, s.in_schedule_now, s.applies_now, s.expired, s.business_day
               FROM public.v_promotions_status s JOIN public.promotions p ON p.id = s.promotion_id
              WHERE p.id::text LIKE 'e0000000-0000-0000-0000-0000000000a%' LOOP
        ASSERT f.business_day = (SELECT jornada FROM t_ahora), 'La jornada de la vista es la del club: ' || f.name;
        ASSERT f.in_schedule_now = (f.name IN ('en franja', 'hoy', 'solo hoy')),
               format('Vigencia de "%s": %s', f.name, f.in_schedule_now);
        ASSERT f.expired = (f.name = 'vencida'), format('Vencida "%s": %s', f.name, f.expired);
    END LOOP;
    ASSERT (SELECT count(*) FROM public.v_promotions_status WHERE promotion_id::text LIKE 'e0000000-0000-0000-0000-0000000000a%') = 7,
           'Las 7 promociones de vigencia aparecen';
    ASSERT NOT (SELECT applies_now FROM public.v_promotions_status WHERE promotion_id = 'e0000000-0000-0000-0000-0000000000a7'),
           'Desactivada no se aplica aunque este en fecha';
    ASSERT (SELECT applies_now FROM public.v_promotions_status WHERE promotion_id = 'e0000000-0000-0000-0000-000000000001'),
           'Sin limites y activa: se aplica';
END $$;
SELECT public.t_logout();


-- Regla de vigencia con horas fijas (jornada desde las 12). El viernes
-- 2026-11-06 es la jornada que va hasta el sabado 07 a las 12:00.
DO $$
DECLARE
    -- f(desde, hasta, dias, franja inicio, franja fin, hora local)
    v_viernes CONSTANT smallint := 16;
BEGIN
    ASSERT private.promotion_in_schedule(NULL, NULL, v_viernes, '00:00', '01:30', '2026-11-07 00:30', 12),
           'Happy hour del viernes de 00:00 a 01:30: el sabado 00:30 del reloj es la noche del viernes';
    ASSERT NOT private.promotion_in_schedule(NULL, NULL, v_viernes, '00:00', '01:30', '2026-11-08 00:30', 12),
           'El domingo 00:30 del reloj es la noche del sabado: no vale';
    ASSERT NOT private.promotion_in_schedule(NULL, NULL, v_viernes, '00:00', '01:30', '2026-11-07 01:30', 12),
           'El fin de la franja queda afuera';
    -- Franja que cruza la medianoche
    ASSERT private.promotion_in_schedule(NULL, NULL, 127::smallint, '23:00', '02:00', '2026-11-06 23:00', 12), '23:00 dentro';
    ASSERT private.promotion_in_schedule(NULL, NULL, 127::smallint, '23:00', '02:00', '2026-11-07 01:59', 12), '01:59 dentro';
    ASSERT NOT private.promotion_in_schedule(NULL, NULL, 127::smallint, '23:00', '02:00', '2026-11-07 02:00', 12), '02:00 fuera';
    ASSERT NOT private.promotion_in_schedule(NULL, NULL, 127::smallint, '23:00', '02:00', '2026-11-06 22:59', 12), '22:59 fuera';
    -- Franja comun
    ASSERT private.promotion_in_schedule(NULL, NULL, 127::smallint, '20:00', '22:00', '2026-11-06 21:00', 12), '21:00 dentro';
    ASSERT NOT private.promotion_in_schedule(NULL, NULL, 127::smallint, '20:00', '22:00', '2026-11-06 23:00', 12), '23:00 fuera';
    -- Fechas de la jornada, no del reloj
    ASSERT private.promotion_in_schedule(NULL, '2026-11-06', 127::smallint, NULL, NULL, '2026-11-07 03:00', 12),
           'Hasta el viernes: el sabado 03:00 todavia es la noche del viernes';
    ASSERT NOT private.promotion_in_schedule('2026-11-07', NULL, 127::smallint, NULL, NULL, '2026-11-07 03:00', 12),
           'Desde el sabado: el sabado 03:00 todavia no (es la noche del viernes)';
    ASSERT private.promotion_in_schedule('2026-11-07', NULL, 127::smallint, NULL, NULL, '2026-11-07 20:00', 12),
           'Desde el sabado: el sabado 20:00 si';
    ASSERT private.promotion_in_schedule(NULL, NULL, 127::smallint, NULL, NULL, '2026-11-07 03:00', 12),
           'Sin limites vale siempre';
END $$;


-- ---- 5) Ventas con promocion (como pos-upload: service_role) ---------
SELECT public.t_as_service();
-- V1: Heineken x3 a 6000 con 2x1 = una gratis: lista 18000, descuento 6000, cobrado 12000. Paga con PIX.
INSERT INTO public.sales (id, club_id, cash_register_id, cash_shift_id, cashier_user_id, ticket_number, total, created_at_device) VALUES
 ('62000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','C1-200',12000,'2026-11-06 23:30-03');
INSERT INTO public.sale_items (id, club_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total, promotion_id, promotion_name, discount_amount) VALUES
 ('72000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','62000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','Heineken',3,6000,2000,12000,
  'e0000000-0000-0000-0000-000000000002','2x1 Heineken',6000);
INSERT INTO public.sale_payments (id, club_id, sale_id, method, amount) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','62000000-0000-0000-0000-000000000001','pix',12000);
-- El impuesto se calcula sobre lo cobrado: 12000 x 3 % = 360 (no sobre los 18000 de lista)
INSERT INTO public.sale_item_taxes (id, club_id, sale_id, sale_item_id, tax_id, tax_name, kind, percentage, fixed_amount, applies_to_methods, taxable_ratio, amount) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','62000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-0000000000a1','Comision PIX','percentage',3,NULL,'pix',1,360);
-- Reintento del mismo envio: no duplica
INSERT INTO public.sale_items (id, club_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total, promotion_id, promotion_name, discount_amount) VALUES
 ('72000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','62000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','Heineken',3,6000,2000,12000,
  'e0000000-0000-0000-0000-000000000002','2x1 Heineken',6000)
 ON CONFLICT (id) DO NOTHING;

-- V2: Corona x2 a 5000 con 20 %: descuento 2000, cobrado 8000. Se entrega UNA como Heineken (sustitucion).
-- V3: Corona x2 con happy hour $1000 por unidad, pero el posnet desconto 3000 (mal): se acepta y se lista.
-- V4: Corona x1 con la promocion de Heineken (producto equivocado): se acepta y se lista.
INSERT INTO public.sales (id, club_id, cash_register_id, cash_shift_id, cashier_user_id, ticket_number, total, created_at_device) VALUES
 ('62000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','C1-201',8000,'2026-11-06 23:40-03'),
 ('62000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','C1-202',7000,'2026-11-06 23:50-03'),
 ('62000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','C1-203',2500,'2026-11-06 23:55-03');
INSERT INTO public.sale_items (id, club_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total, promotion_id, promotion_name, discount_amount) VALUES
 ('72000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-00000000000a','62000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','Corona',2,5000,1000,8000,
  'e0000000-0000-0000-0000-000000000001','Corona 20 %',2000),
 ('72000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-00000000000a','62000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','Corona',2,5000,1000,7000,
  'e0000000-0000-0000-0000-000000000003','Happy hour Corona',3000),
 ('72000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-00000000000a','62000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000001','Corona',1,5000,1000,2500,
  'e0000000-0000-0000-0000-000000000002','2x1 Heineken',2500);
INSERT INTO public.sale_item_substitutions (id, club_id, sale_id, sale_item_id, quantity, reason,
   substitute_product_id, substitute_product_name, substitute_unit_price, substitute_unit_cost,
   location_id, authorized_by_user_id, occurred_at) VALUES
 ('82000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-00000000000a','62000000-0000-0000-0000-000000000002','72000000-0000-0000-0000-000000000002',1,'out_of_stock',
  '40000000-0000-0000-0000-000000000002','Heineken',6000,2000,'10000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-000000000003','2026-11-06 23:45-03');

-- Datos imposibles: los frena la base (van a sync_errors en pos-upload)
SELECT public.t_expect_error($$INSERT INTO public.sale_items (id, club_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total, promotion_id, promotion_name, discount_amount) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','62000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Corona',1,5000,1000,-1000,
  'e0000000-0000-0000-0000-000000000001','Corona 20 %',6000)$$, 'sale_items_discount_check');
SELECT public.t_expect_error($$INSERT INTO public.sale_items (id, club_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total, discount_amount) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','62000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Corona',1,5000,1000,4000,1000)$$, 'sale_items_discount_check');
SELECT public.t_expect_error($$INSERT INTO public.sale_items (id, club_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total, promotion_id, promotion_name, discount_amount) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','62000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Corona',1,5000,1000,5000,
  'e0000000-0000-0000-0000-000000000001','Corona 20 %',1000)$$, 'sale_items_line_total_check');
SELECT public.t_expect_error($$INSERT INTO public.sale_items (id, club_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total, promotion_id, discount_amount) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','62000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Corona',1,5000,1000,4000,
  'e0000000-0000-0000-0000-000000000001',1000)$$, 'sale_items_discount_check');
-- Una promocion de otro club no (clave compuesta)
SELECT public.t_logout();
INSERT INTO public.promotions (id, club_id, product_id, name, kind, percentage) VALUES
    ('e0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-00000000000b', 'Promo de B', 'percentage', 10);
SELECT public.t_as_service();
SELECT public.t_expect_error($$INSERT INTO public.sale_items (id, club_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total, promotion_id, promotion_name, discount_amount) VALUES
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','62000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Corona',1,5000,1000,4500,
  'e0000000-0000-0000-0000-0000000000b1','Promo de B',500)$$, 'sale_items_promotion_fk');
-- La linea vendida no cambia (libro de solo agregar)
SELECT public.t_expect_error($$UPDATE public.sale_items SET discount_amount = 0 WHERE id = '72000000-0000-0000-0000-000000000001'$$, 'solo agregar');
SELECT public.t_logout();

-- Renombrar la promocion despues no toca la foto de la venta
UPDATE public.promotions SET name = 'Otro nombre' WHERE id = 'e0000000-0000-0000-0000-000000000002';

SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a1');
DO $$
DECLARE
    f record;
BEGIN
    SELECT * INTO f FROM public.v_sale_item_financials WHERE sale_item_id = '72000000-0000-0000-0000-000000000001';
    ASSERT f.revenue = 12000,             'V1 ingreso = lo cobrado (12000)';
    ASSERT f.promotion_discount = 6000,   'V1 descuento por promocion 6000';
    ASSERT f.substitution_discount = 0,   'V1 sin sustitucion: el 2x1 no es descuento por sustitucion';
    ASSERT f.cost_effective = 6000,       'V1 costo de las 3 Heineken entregadas';
    ASSERT f.gross_margin = 6000,         'V1 margen bruto = 12000 - 6000';
    ASSERT f.tax_total = 360,             'V1 impuesto sobre lo cobrado';
    ASSERT f.net_margin = 5640,           'V1 margen neto = 12000 - 6000 - 360';
    ASSERT f.promotion_name = '2x1 Heineken', 'V1 conserva el nombre de la promocion al vender';

    SELECT * INTO f FROM public.v_sale_item_financials WHERE sale_item_id = '72000000-0000-0000-0000-000000000002';
    ASSERT f.revenue = 8000,              'V2 ingreso 8000';
    ASSERT f.promotion_discount = 2000,   'V2 descuento por promocion 2000';
    ASSERT f.substitution_discount = 1000, 'V2 la sustitucion (lista 6000 por 5000) suma 1000 aparte';
    ASSERT f.cost_effective = 3000,        'V2 costo: una Corona y una Heineken';
    ASSERT f.gross_margin = 5000,          'V2 margen bruto = 8000 - 3000';

    ASSERT (SELECT count(*) FROM public.v_sale_tax_issues WHERE sale_id = '62000000-0000-0000-0000-000000000001') = 0,
           'El impuesto calculado sobre lo cobrado coincide con el recalculo';
    ASSERT (SELECT count(*) FROM public.v_sales_integrity_issues
             WHERE sale_id IN ('62000000-0000-0000-0000-000000000001')) = 0,
           'El total de la venta es la suma de lo cobrado por linea';
    ASSERT (SELECT promotion_discount FROM public.v_club_daily_stats
             WHERE club_id = 'c0000000-0000-0000-0000-00000000000a' AND business_day = DATE '2026-11-06') = 13500,
           'La jornada suma el descuento por promociones (6000 + 2000 + 3000 + 2500)';

    -- Control: solo V3 (descuento mal) y V4 (producto equivocado)
    ASSERT (SELECT array_agg(ticket_number ORDER BY ticket_number) FROM public.v_sale_promotion_issues)
           = ARRAY['C1-202', 'C1-203'], 'Se listan el descuento mal calculado y el producto equivocado';
    ASSERT (SELECT expected_discount FROM public.v_sale_promotion_issues WHERE ticket_number = 'C1-202') = 2000,
           'Happy hour: $1000 por unidad x 2';
    ASSERT (SELECT wrong_product FROM public.v_sale_promotion_issues WHERE ticket_number = 'C1-203'),
           'V4 marcada como producto equivocado';
END $$;
SELECT public.t_logout();

-- Recalculo de cada tipo (lo que el posnet debe repetir)
SELECT public.t_as_service();
INSERT INTO public.sales (id, club_id, cash_register_id, cash_shift_id, cashier_user_id, ticket_number, total, created_at_device) VALUES
 ('62000000-0000-0000-0000-000000000009','c0000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','C1-209',0,'2026-11-06 23:59-03');
INSERT INTO public.sale_items (id, club_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total, promotion_id, promotion_name, discount_amount) VALUES
 -- 2x1 con 5 unidades: 2 gratis
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','62000000-0000-0000-0000-000000000009','40000000-0000-0000-0000-000000000002','Heineken',5,6000,2000,18000,'e0000000-0000-0000-0000-000000000002','x',12000),
 -- 20 % de 3 x 3333,33 = 9999,99 -> 2000,00 redondeado
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','62000000-0000-0000-0000-000000000009','40000000-0000-0000-0000-000000000001','Corona',3,3333.33,1000,7999.99,'e0000000-0000-0000-0000-000000000001','x',2000.00),
 -- monto fijo mayor que el precio: descuenta como mucho el precio
 (gen_random_uuid(),'c0000000-0000-0000-0000-00000000000a','62000000-0000-0000-0000-000000000009','40000000-0000-0000-0000-000000000001','Corona',2,800,1000,0,'e0000000-0000-0000-0000-000000000003','x',1600);
SELECT public.t_logout();
DO $$ BEGIN
    ASSERT NOT EXISTS (SELECT 1 FROM public.v_sale_promotion_issues WHERE ticket_number = 'C1-209'),
           'NxM, porcentaje redondeado y monto fijo tope en el precio coinciden con el recalculo';
END $$;


-- ---- 6) Aislamiento, encargado y anon --------------------------------
SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a2');   -- Luis, club B
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM public.promotions WHERE club_id = 'c0000000-0000-0000-0000-00000000000a') = 0, 'Luis no ve promociones del club A';
    ASSERT (SELECT count(*) FROM public.promotion_locations) = 0, 'Luis no ve barras de promociones del club A';
    ASSERT (SELECT count(*) FROM public.v_promotions_status WHERE club_id = 'c0000000-0000-0000-0000-00000000000a') = 0, 'Ni su estado';
    ASSERT (SELECT count(*) FROM public.v_sale_promotion_issues) = 0, 'Ni sus controles';
END $$;
UPDATE public.promotions SET active = false WHERE club_id = 'c0000000-0000-0000-0000-00000000000a';
DELETE FROM public.promotion_locations;
SELECT public.t_expect_error($$INSERT INTO public.promotions (club_id, product_id, name, kind, percentage) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', 'x', 'percentage', 10)$$, 'producto del club');   -- no ve el producto ajeno (y si no, lo frena la politica)
SELECT public.t_logout();
DO $$ BEGIN
    ASSERT (SELECT active FROM public.promotions WHERE id = 'e0000000-0000-0000-0000-000000000001'), 'La promocion del club A sigue activa';
    ASSERT (SELECT count(*) FROM public.promotion_locations WHERE club_id = 'c0000000-0000-0000-0000-00000000000a') = 1,
           'La barra de la promocion del club A sigue';
END $$;

-- El encargado del club A tambien crea promociones
SELECT public.t_login_as('bbbbbbbb-0000-0000-0000-0000000000b4');
INSERT INTO public.promotions (club_id, product_id, name, kind, fixed_amount) VALUES
    ('c0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000002', 'Encargado', 'fixed_amount', 500)
RETURNING id;
SELECT public.t_logout();
DO $$ BEGIN
    ASSERT EXISTS (SELECT 1 FROM public.audit_log WHERE action = 'promotion.created' AND actor_type = 'user'),
           'El alta del encargado queda auditada con su usuario';
END $$;

SET LOCAL ROLE anon;
SELECT public.t_expect_error('SELECT * FROM public.promotions', 'permission denied');
SELECT public.t_expect_error('SELECT * FROM public.promotion_locations', 'permission denied');
SELECT public.t_expect_error('SELECT * FROM public.v_promotions_status', 'permission denied');
SELECT public.t_expect_error('SELECT * FROM public.v_sale_promotion_issues', 'permission denied');
RESET ROLE;

ROLLBACK;
