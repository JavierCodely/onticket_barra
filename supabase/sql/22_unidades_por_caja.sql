-- =====================================================================
-- ONTICKET - 22: UNIDADES POR CAJA
-- Requiere: 01 a 21
--
-- Un producto puede venir por caja (por ejemplo, 6 cervezas por caja).
--   * products.units_per_box: unidades que trae cada caja; NULL = no viene
--     por caja (se compra suelto).
--   * Solo productos comunes: un combo no tiene stock propio (archivo 17).
--   * Es una ayuda para cargar compras: el panel convierte cajas a
--     unidades (2 cajas x 6 = 12) y el libro de stock guarda UNIDADES,
--     como siempre (regla 10). Cambiarlo no toca movimientos pasados.
--   * Queda auditado como cualquier cambio del producto (audit_catalog_change).
-- =====================================================================
BEGIN;

ALTER TABLE public.products ADD COLUMN units_per_box integer;
ALTER TABLE public.products
    ADD CONSTRAINT products_units_per_box_check
        CHECK (units_per_box IS NULL OR units_per_box BETWEEN 2 AND 1000),
    ADD CONSTRAINT products_units_per_box_kind_check
        CHECK (units_per_box IS NULL OR kind = 'product');
COMMENT ON COLUMN public.products.units_per_box IS
    'Unidades por caja (2 a 1000). NULL = no viene por caja. Solo productos comunes.';

-- El panel lo escribe al crear y al editar el producto.
GRANT INSERT (units_per_box) ON public.products TO authenticated;
GRANT UPDATE (units_per_box) ON public.products TO authenticated;

COMMIT;
