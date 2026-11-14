-- =====================================================================
-- ONTICKET - 13: CATEGORIAS DE PRODUCTO POR CLUB
-- Requiere: 01 a 12
--
-- Cada club tiene su lista de categorias (product_categories) y cada
-- producto apunta a una (products.category_id, clave compuesta: no se
-- puede usar la categoria de otro club).
--
-- "Vaso" existe SIEMPRE en todos los clubs: se crea sola al crear el club
-- (y para los clubs que ya existian). Sirve para los productos que se
-- sirven en vaso (tragos, medidas).
--
-- products.category (texto libre de 02) queda solo por compatibilidad:
-- se copia a la tabla nueva y el panel ya no la escribe.
-- Las categorias se desactivan o se dan de baja logica; no se borran.
-- =====================================================================
BEGIN;

CREATE TABLE public.product_categories (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id     uuid        NOT NULL REFERENCES public.clubs (id),
    name        text        NOT NULL,
    sort_order  smallint    NOT NULL DEFAULT 0,
    active      boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz,
    CONSTRAINT product_categories_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT product_categories_id_club_unique UNIQUE (id, club_id)
);
COMMENT ON TABLE public.product_categories IS 'Categorias de producto de cada club. "Vaso" existe siempre.';

CREATE UNIQUE INDEX uq_product_categories_club_name
    ON public.product_categories (club_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX idx_product_categories_club ON public.product_categories (club_id, sort_order);

ALTER TABLE public.products ADD COLUMN category_id uuid;
ALTER TABLE public.products ADD CONSTRAINT products_category_fk
    FOREIGN KEY (category_id, club_id) REFERENCES public.product_categories (id, club_id);
CREATE INDEX idx_products_category ON public.products (category_id, club_id);
COMMENT ON COLUMN public.products.category IS 'OBSOLETA: usar category_id (13_categorias.sql).';


-- ---------------------------------------------------------------------
-- Reglas
-- ---------------------------------------------------------------------
-- "Vaso" en cada club nuevo. SECURITY DEFINER: quien crea el club todavia
-- no figura en visible_club_ids() dentro de la misma sentencia.
CREATE OR REPLACE FUNCTION private.club_default_categories()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.product_categories (club_id, name, sort_order)
    VALUES (NEW.id, 'Vaso', 0);
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_clubs_default_categories
    AFTER INSERT ON public.clubs
    FOR EACH ROW EXECUTE FUNCTION private.club_default_categories();
CREATE TRIGGER trg_product_categories_club_fixed
    BEFORE UPDATE OF club_id ON public.product_categories
    FOR EACH ROW EXECUTE FUNCTION private.forbid_club_change();
CREATE TRIGGER trg_product_categories_updated_at
    BEFORE UPDATE ON public.product_categories
    FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_product_categories_audit
    AFTER INSERT OR UPDATE ON public.product_categories
    FOR EACH ROW EXECUTE FUNCTION private.audit_catalog_change('product_category');


-- ---------------------------------------------------------------------
-- Datos que ya existian: Vaso en cada club y las categorias de texto.
-- ---------------------------------------------------------------------
INSERT INTO public.product_categories (club_id, name, sort_order)
SELECT c.id, 'Vaso', 0
  FROM public.clubs c
 WHERE NOT EXISTS (SELECT 1 FROM public.product_categories pc
                    WHERE pc.club_id = c.id AND lower(pc.name) = 'vaso' AND pc.deleted_at IS NULL);

INSERT INTO public.product_categories (club_id, name, sort_order)
SELECT DISTINCT ON (p.club_id, lower(btrim(p.category))) p.club_id, btrim(p.category), 10
  FROM public.products p
 WHERE p.category IS NOT NULL AND btrim(p.category) <> ''
   AND NOT EXISTS (SELECT 1 FROM public.product_categories pc
                    WHERE pc.club_id = p.club_id AND lower(pc.name) = lower(btrim(p.category))
                      AND pc.deleted_at IS NULL);

UPDATE public.products p
   SET category_id = pc.id
  FROM public.product_categories pc
 WHERE pc.club_id = p.club_id
   AND pc.deleted_at IS NULL
   AND lower(pc.name) = lower(btrim(p.category))
   AND p.category_id IS NULL;


-- ---------------------------------------------------------------------
-- Seguridad (mismo patron que 08)
-- ---------------------------------------------------------------------
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_categories_select ON public.product_categories
    FOR SELECT TO authenticated USING (club_id IN (SELECT private.visible_club_ids()));
CREATE POLICY product_categories_insert ON public.product_categories
    FOR INSERT TO authenticated WITH CHECK (club_id IN (SELECT private.visible_club_ids()));
CREATE POLICY product_categories_update ON public.product_categories
    FOR UPDATE TO authenticated
    USING      (club_id IN (SELECT private.visible_club_ids()))
    WITH CHECK (club_id IN (SELECT private.visible_club_ids()));

REVOKE ALL ON public.product_categories FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_categories TO service_role;
GRANT SELECT ON public.product_categories TO authenticated;
GRANT INSERT (club_id, name, sort_order, active) ON public.product_categories TO authenticated;
GRANT UPDATE (name, sort_order, active, deleted_at) ON public.product_categories TO authenticated;

-- El producto elige su categoria.
GRANT INSERT (category_id) ON public.products TO authenticated;
GRANT UPDATE (category_id) ON public.products TO authenticated;

REVOKE EXECUTE ON FUNCTION private.club_default_categories() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION private.club_default_categories() TO service_role;

-- El posnet agrupa los productos por categoria.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync')
       AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                        WHERE pubname = 'powersync' AND schemaname = 'public' AND tablename = 'product_categories') THEN
        ALTER PUBLICATION powersync ADD TABLE public.product_categories;
    END IF;
END;
$$;

COMMIT;
