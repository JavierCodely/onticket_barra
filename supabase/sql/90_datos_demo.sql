-- =====================================================================
-- ONTICKET - 90: DATOS DE DEMOSTRACION   (OPCIONAL - SOLO DESARROLLO)
-- Requiere: 01 a 13
--
-- ANTES DE EJECUTAR
--   1) Supabase > Authentication > Users > Add user (email + contrasena).
--      Ese usuario sera tu Administrador para entrar al panel.
--   2) Cambiar el email de la linea marcada con  <<< CAMBIAR
--      (debe ser el mismo del paso 1).
--
-- CREA
--   * tu administrador y el "Club Demo"
--   * 1 barra, 2 cajas, 5 productos con stock inicial
--   * 3 impuestos:  Comision PIX 3 % (PIX)
--                   Imp. debitos y creditos 1,2 % (PIX y transferencia)
--                   Tasa fija $50 por unidad (todos los metodos)
--     Con precio 5000 y costo 1000 el margen neto queda:
--       efectivo 3950 | transferencia 3890 | PIX 3740
--   * 3 usuarios de posnet con PIN 123456 (SOLO PARA PRUEBAS):
--       cajero1, cajero2 (cashier)  y  barra1 (bartender)
--
-- Se puede ejecutar mas de una vez: si el Club Demo ya existe no hace nada.
-- =====================================================================
BEGIN;

DO $$
DECLARE
    c_email   CONSTANT text := 'tu_email@ejemplo.com';            -- <<< CAMBIAR
    c_club    CONSTANT text := 'club-demo';
    -- bcrypt del PIN de prueba. En produccion el hash lo calcula la Edge Function.
    c_pin     CONSTANT text := extensions.crypt('123456', extensions.gen_salt('bf'));
    v_auth    uuid;
    v_admin   uuid;
    v_club    uuid;
    v_bar     uuid;
    v_tax_card uuid;
    v_tax_bank uuid;
    v_tax_flat uuid;
BEGIN
    IF EXISTS (SELECT 1 FROM public.clubs c WHERE c.slug = c_club) THEN
        RAISE NOTICE 'El Club Demo ya existe: no se cargo nada.';
        RETURN;
    END IF;

    SELECT u.id INTO v_auth FROM auth.users u WHERE lower(u.email) = lower(c_email);
    IF v_auth IS NULL THEN
        RAISE EXCEPTION 'No existe un usuario en Authentication con el email %', c_email
            USING HINT = 'Crealo en Authentication > Users y corregi el email de este archivo.';
    END IF;

    -- Administrador (se reutiliza si ya estaba cargado)
    SELECT a.id INTO v_admin FROM public.platform_admins a WHERE a.auth_user_id = v_auth;
    IF v_admin IS NULL THEN
        INSERT INTO public.platform_admins (email, full_name, auth_user_id)
        VALUES (lower(c_email), 'Administrador demo', v_auth)
        RETURNING id INTO v_admin;
    END IF;

    INSERT INTO public.clubs (name, slug, created_by_admin_id)
    VALUES ('Club Demo', c_club, v_admin)
    RETURNING id INTO v_club;

    INSERT INTO public.inventory_locations (club_id, name, kind)
    VALUES (v_club, 'Barra principal', 'bar')
    RETURNING id INTO v_bar;

    INSERT INTO public.cash_registers (club_id, name, inventory_location_id) VALUES
        (v_club, 'Caja 1', v_bar),
        (v_club, 'Caja 2', v_bar);

    INSERT INTO public.users (club_id, full_name, role, username, pin_hash, pin_changed_at) VALUES
        (v_club, 'Cajero Uno', 'cashier',   'cajero1', c_pin, now()),
        (v_club, 'Cajero Dos', 'cashier',   'cajero2', c_pin, now()),
        (v_club, 'Barra Uno',  'bartender', 'barra1',  c_pin, now());

    -- Productos + stock inicial (el saldo lo calcula el trigger)
    WITH new_products AS (
        INSERT INTO public.products (club_id, name, category, cost, price) VALUES
            (v_club, 'Corona',          'Cerveza',     1000, 5000),
            (v_club, 'Heineken',        'Cerveza',     2000, 6000),
            (v_club, 'Quilmes',         'Cerveza',      900, 4000),
            (v_club, 'Fernet con coca', 'Trago',       1500, 6500),
            (v_club, 'Agua mineral',    'Sin alcohol',  300, 2000)
        RETURNING id, name
    )
    INSERT INTO public.inventory_movements (club_id, location_id, product_id, movement_type, quantity, note)
    SELECT v_club, v_bar, p.id, 'initial',
           CASE p.name WHEN 'Corona' THEN 24 WHEN 'Heineken' THEN 24
                       WHEN 'Fernet con coca' THEN 60 ELSE 48 END,
           'Stock inicial demo'
      FROM new_products p;

    -- Impuestos y los metodos de pago que los disparan
    INSERT INTO public.taxes (club_id, name, kind, percentage)
    VALUES (v_club, 'Comision PIX', 'percentage', 3)
    RETURNING id INTO v_tax_card;
    INSERT INTO public.taxes (club_id, name, kind, percentage)
    VALUES (v_club, 'Imp. debitos y creditos', 'percentage', 1.2)
    RETURNING id INTO v_tax_bank;
    INSERT INTO public.taxes (club_id, name, kind, fixed_amount)
    VALUES (v_club, 'Tasa fija', 'fixed', 50)
    RETURNING id INTO v_tax_flat;

    INSERT INTO public.tax_payment_methods (club_id, tax_id, method) VALUES
        (v_club, v_tax_card, 'pix'),
        (v_club, v_tax_bank, 'pix'),
        (v_club, v_tax_bank, 'transfer');
    INSERT INTO public.tax_payment_methods (club_id, tax_id, method)
    SELECT v_club, v_tax_flat, pm.code FROM public.payment_methods pm WHERE pm.active;

    RAISE NOTICE 'Club Demo creado. Ya podes iniciar sesion en el panel con %', c_email;
END;
$$;

COMMIT;
