-- PRUEBA 080: fotos de productos en Storage. Bucket publico de solo
-- lectura; subir, cambiar y borrar solo en la carpeta del club que se
-- gestiona; products.image_url solo apunta a la foto de su propio club.
BEGIN;
\ir fixture.sql

-- El bucket: publico, 2 MB, solo imagenes
DO $$ BEGIN
    ASSERT (SELECT public FROM storage.buckets WHERE id = 'product-images'), 'Bucket publico (solo lectura por URL)';
    ASSERT (SELECT file_size_limit FROM storage.buckets WHERE id = 'product-images') = 2097152, 'Limite de 2 MB';
    ASSERT (SELECT allowed_mime_types FROM storage.buckets WHERE id = 'product-images')
           = ARRAY['image/jpeg', 'image/png', 'image/webp'], 'Solo JPG, PNG y WebP';
END $$;

INSERT INTO storage.buckets (id, name) VALUES ('otro', 'otro') ON CONFLICT DO NOTHING;

-- Ana (administradora del club A) sube una foto en la carpeta de su club
SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a1');
INSERT INTO storage.objects (bucket_id, name) VALUES
    ('product-images', 'c0000000-0000-0000-0000-00000000000a/corona-1.webp')
RETURNING name;
-- ...pero no en la de otro club, ni fuera de una carpeta de club, ni en otro bucket
SELECT public.t_expect_error($$INSERT INTO storage.objects (bucket_id, name) VALUES ('product-images', 'c0000000-0000-0000-0000-00000000000b/x.webp')$$, 'row-level security');
SELECT public.t_expect_error($$INSERT INTO storage.objects (bucket_id, name) VALUES ('product-images', 'suelta.webp')$$, 'row-level security');
SELECT public.t_expect_error($$INSERT INTO storage.objects (bucket_id, name) VALUES ('product-images', 'no-es-uuid/x.webp')$$, 'row-level security');
SELECT public.t_expect_error($$INSERT INTO storage.objects (bucket_id, name) VALUES ('otro', 'c0000000-0000-0000-0000-00000000000a/x.webp')$$, 'row-level security');
-- no puede mover una foto a la carpeta de otro club
SELECT public.t_expect_error($$UPDATE storage.objects SET name = 'c0000000-0000-0000-0000-00000000000b/robada.webp' WHERE name LIKE '%corona-1.webp'$$, 'row-level security');

-- La URL de la foto en el producto: solo de este bucket y de su club
UPDATE public.products
   SET image_url = 'https://proyecto.supabase.co/storage/v1/object/public/product-images/c0000000-0000-0000-0000-00000000000a/corona-1.webp'
 WHERE name = 'Corona';
SELECT public.t_expect_error($$UPDATE public.products SET image_url = 'https://proyecto.supabase.co/storage/v1/object/public/product-images/c0000000-0000-0000-0000-00000000000b/x.webp' WHERE name = 'Corona'$$, 'products_image_url_own_bucket');
SELECT public.t_expect_error($$UPDATE public.products SET image_url = 'https://sitio-malo.com/foto.webp' WHERE name = 'Corona'$$, 'products_image_url_own_bucket');
SELECT public.t_expect_error($$UPDATE public.products SET image_url = 'https://proyecto.supabase.co/storage/v1/object/public/otro/c0000000-0000-0000-0000-00000000000a/x.webp' WHERE name = 'Corona'$$, 'products_image_url_own_bucket');
-- quitar la foto
UPDATE public.products SET image_url = NULL WHERE name = 'Corona';
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM storage.objects WHERE bucket_id = 'product-images') = 1, 'Ana ve su foto';
END $$;
SELECT public.t_logout();

-- Luis (otro administrador, club B) no ve, no cambia ni borra las fotos del club A
SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a2');
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM storage.objects WHERE bucket_id = 'product-images') = 0, 'Luis no lista fotos ajenas';
END $$;
UPDATE storage.objects SET name = 'c0000000-0000-0000-0000-00000000000a/pisada.webp' WHERE bucket_id = 'product-images';
DELETE FROM storage.objects WHERE bucket_id = 'product-images';
SELECT public.t_logout();
DO $$ BEGIN
    ASSERT (SELECT name FROM storage.objects WHERE bucket_id = 'product-images')
           = 'c0000000-0000-0000-0000-00000000000a/corona-1.webp', 'La foto de Ana sigue intacta';
END $$;

-- anon: no lista ni sube (la lectura publica es por URL, fuera de la base)
SET LOCAL ROLE anon;
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM storage.objects) = 0, 'anon no lista objetos';
END $$;
SELECT public.t_expect_error($$INSERT INTO storage.objects (bucket_id, name) VALUES ('product-images', 'c0000000-0000-0000-0000-00000000000a/anon.webp')$$, 'row-level security');
RESET ROLE;

-- Ana puede borrar su foto
SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a1');
DELETE FROM storage.objects WHERE name LIKE '%corona-1.webp';
SELECT public.t_logout();
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM storage.objects WHERE bucket_id = 'product-images') = 0, 'Ana borro su foto';
END $$;

ROLLBACK;
