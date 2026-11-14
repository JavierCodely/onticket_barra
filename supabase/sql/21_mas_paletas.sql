-- =====================================================================
-- ONTICKET - 21: MAS PALETAS DE COLORES
-- Requiere: 01 a 20
--
-- Suma paletas a club_settings.palette: rojo (fuerte, con fondo negro
-- profundo en modo oscuro), naranja, lima, cielo, indigo y fucsia. Los
-- colores viven en el panel (index.css); la base solo valida el codigo.
-- =====================================================================
BEGIN;

ALTER TABLE public.club_settings DROP CONSTRAINT club_settings_palette_check;
ALTER TABLE public.club_settings ADD CONSTRAINT club_settings_palette_check CHECK (palette IN
    ('violeta', 'azul', 'turquesa', 'esmeralda', 'ambar', 'coral', 'rosa', 'grafito',
     'rojo', 'naranja', 'lima', 'cielo', 'indigo', 'fucsia'));

COMMIT;
