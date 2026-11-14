-- PRUEBA 070: categorias de producto por club. "Vaso" existe siempre;
-- aislamiento entre clubs; un producto solo usa categorias de su club.
BEGIN;
\ir fixture.sql

SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a1');   -- Ana
DO $$ BEGIN
    ASSERT (SELECT array_agg(name) FROM public.product_categories) = ARRAY['Vaso'],
           'Cada club nace con la categoria Vaso (Ana ve solo la de su club)';
END $$;

-- Alta de categorias del club
INSERT INTO public.product_categories (club_id, name, sort_order) VALUES
    ('c0000000-0000-0000-0000-00000000000a', 'Cerveza', 1),
    ('c0000000-0000-0000-0000-00000000000a', 'Botella', 2)
RETURNING id, name;
SELECT public.t_expect_error($$INSERT INTO public.product_categories (club_id, name) VALUES ('c0000000-0000-0000-0000-00000000000a', 'cerveza')$$, 'uq_product_categories_club_name');
SELECT public.t_expect_error($$INSERT INTO public.product_categories (club_id, name) VALUES ('c0000000-0000-0000-0000-00000000000a', '  ')$$, 'product_categories_name_not_blank');
SELECT public.t_expect_error($$INSERT INTO public.product_categories (club_id, name) VALUES ('c0000000-0000-0000-0000-00000000000b', 'Ajena')$$, 'row-level security');
SELECT public.t_expect_error('DELETE FROM public.product_categories', 'permission denied');
SELECT public.t_expect_error($$UPDATE public.product_categories SET club_id = 'c0000000-0000-0000-0000-00000000000b'$$, 'permission denied');

-- Producto con categoria del club
INSERT INTO public.products (club_id, name, cost, price, category_id)
SELECT 'c0000000-0000-0000-0000-00000000000a', 'Fernet', 1500, 6500, id
  FROM public.product_categories WHERE name = 'Vaso';
UPDATE public.products SET category_id = (SELECT id FROM public.product_categories WHERE name = 'Cerveza')
 WHERE name = 'Corona';
SELECT public.t_logout();

-- Un producto NO puede usar la categoria de otro club (clave compuesta)
SELECT public.t_expect_error($$UPDATE public.products SET category_id =
    (SELECT id FROM public.product_categories WHERE club_id = 'c0000000-0000-0000-0000-00000000000b' LIMIT 1)
    WHERE name = 'Corona'$$, 'foreign key');

SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a1');
-- desactivar: queda auditado
UPDATE public.product_categories SET active = false WHERE name = 'Botella';
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM public.audit_log WHERE action = 'product_category.created') = 2, 'Se audita el alta';
    ASSERT (SELECT count(*) FROM public.audit_log WHERE action = 'product_category.deactivated') = 1, 'Se audita la baja';
    ASSERT (SELECT c.name FROM public.products p JOIN public.product_categories c ON c.id = p.category_id
             WHERE p.name = 'Fernet') = 'Vaso', 'Fernet es Vaso';
END $$;

-- Un club nuevo creado desde el panel tambien trae Vaso
INSERT INTO public.clubs (name, slug, created_by_admin_id)
VALUES ('Club Nuevo', 'club-nuevo', 'a0000000-0000-0000-0000-000000000001') RETURNING id;
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM public.product_categories pc JOIN public.clubs c ON c.id = pc.club_id
             WHERE c.slug = 'club-nuevo' AND pc.name = 'Vaso') = 1, 'El club nuevo trae Vaso';
END $$;
SELECT public.t_logout();

-- Luis ve solo las de su club
SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a2');
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM public.product_categories) = 1, 'Luis ve solo el Vaso de su club';
END $$;
UPDATE public.product_categories SET name = 'Hackeado' WHERE club_id = 'c0000000-0000-0000-0000-00000000000a';
SELECT public.t_logout();
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM public.product_categories WHERE name = 'Hackeado') = 0, 'Luis no puede renombrar categorias ajenas';
END $$;

SET LOCAL ROLE anon;
SELECT public.t_expect_error('SELECT * FROM public.product_categories', 'permission denied');
RESET ROLE;

ROLLBACK;
