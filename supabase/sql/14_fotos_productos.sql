-- =====================================================================
-- ONTICKET - 14: FOTOS DE PRODUCTOS (Supabase Storage)
-- Requiere: 01 a 13
--
-- Bucket "product-images", PUBLICO SOLO LECTURA (decision del dueno del
-- proyecto): cualquiera con el link ve la foto, porque el posnet la baja
-- sin sesion de Supabase y la guarda para usarla sin conexion. La foto no
-- es un dato del club. Escribir (subir, cambiar, borrar) solo puede quien
-- gestiona ESE club (administrador o club_admin).
--
-- Ruta de cada foto: <club_id>/<archivo>. La primera carpeta es el club:
-- las politicas la comparan (storage.foldername, de Supabase) con
-- private.visible_club_ids(). Un archivo fuera de una carpeta de club no
-- tiene primera carpeta y queda rechazado.
--
-- products.image_url guarda la URL publica de la foto, y un CHECK exige
-- que apunte a este bucket y a la carpeta del MISMO club: el posnet nunca
-- descarga una URL cualquiera ni la foto de otro club.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- A. Bucket: publico, 2 MB, solo JPG / PNG / WebP
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-images', 'product-images', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
   SET public             = EXCLUDED.public,
       file_size_limit    = EXCLUDED.file_size_limit,
       allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------
-- B. Politicas en storage.objects (solo para este bucket)
--    La lectura publica va por la URL publica (no pasa por RLS). Para
--    listar, subir, reemplazar o borrar hace falta gestionar el club.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS product_images_select ON storage.objects;
DROP POLICY IF EXISTS product_images_insert ON storage.objects;
DROP POLICY IF EXISTS product_images_update ON storage.objects;
DROP POLICY IF EXISTS product_images_delete ON storage.objects;

CREATE POLICY product_images_select ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'product-images'
           AND (storage.foldername(name))[1] IN (SELECT v::text FROM private.visible_club_ids() AS v));

CREATE POLICY product_images_insert ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'product-images'
                AND (storage.foldername(name))[1] IN (SELECT v::text FROM private.visible_club_ids() AS v));

CREATE POLICY product_images_update ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'product-images'
           AND (storage.foldername(name))[1] IN (SELECT v::text FROM private.visible_club_ids() AS v))
    WITH CHECK (bucket_id = 'product-images'
                AND (storage.foldername(name))[1] IN (SELECT v::text FROM private.visible_club_ids() AS v));

CREATE POLICY product_images_delete ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'product-images'
           AND (storage.foldername(name))[1] IN (SELECT v::text FROM private.visible_club_ids() AS v));

-- ---------------------------------------------------------------------
-- C. products.image_url: solo una foto de este bucket y de su club
-- ---------------------------------------------------------------------
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_image_url_own_bucket;
ALTER TABLE public.products ADD CONSTRAINT products_image_url_own_bucket CHECK (
    image_url IS NULL
    OR image_url ~ ('^https?://[^/?#]+/storage/v1/object/public/product-images/'
                    || club_id::text || '/[^/?#]+$')
);
COMMENT ON COLUMN public.products.image_url IS
    'URL publica de la foto en el bucket product-images, carpeta del club. NULL = sin foto.';

COMMIT;
