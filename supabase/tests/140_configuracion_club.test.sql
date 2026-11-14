-- PRUEBA 140: configuracion del club (paleta de colores, archivo 20).
-- Una fila por club creada por la base (tambien en clubs nuevos), paleta
-- valida, solo se cambia la paleta del club que se gestiona, sin insertar
-- ni borrar, auditoria, encargado, aislamiento y anon.
BEGIN;
\ir fixture.sql

DO $$ BEGIN
    ASSERT (SELECT count(*) FROM public.club_settings) = (SELECT count(*) FROM public.clubs),
           'Cada club tiene su configuracion';
    ASSERT (SELECT palette FROM public.club_settings WHERE club_id = 'c0000000-0000-0000-0000-00000000000a') = 'violeta',
           'Paleta por defecto: violeta';
END $$;

-- ---- Administrador: club nuevo y cambio de paleta ---------------------
SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a1');   -- Ana
INSERT INTO public.clubs (name, slug, timezone, business_day_start_hour, created_by_admin_id)
VALUES ('Club Nuevo', 'club-nuevo', 'America/Argentina/Buenos_Aires', 12, 'a0000000-0000-0000-0000-000000000001');
DO $$ BEGIN
    ASSERT (SELECT s.palette FROM public.club_settings s JOIN public.clubs c ON c.id = s.club_id
             WHERE c.slug = 'club-nuevo') = 'violeta',
           'Un club nuevo nace con su configuracion (y su creador la ve)';
END $$;

UPDATE public.club_settings SET palette = 'esmeralda'
 WHERE club_id = 'c0000000-0000-0000-0000-00000000000a'
RETURNING palette;
-- Paletas del archivo 21
UPDATE public.club_settings SET palette = 'rojo' WHERE club_id = 'c0000000-0000-0000-0000-00000000000a';
UPDATE public.club_settings SET palette = 'esmeralda' WHERE club_id = 'c0000000-0000-0000-0000-00000000000a';
SELECT public.t_expect_error($$UPDATE public.club_settings SET palette = 'marron'
    WHERE club_id = 'c0000000-0000-0000-0000-00000000000a'$$, 'club_settings_palette_check');
-- Solo la paleta: ni el club, ni insertar, ni borrar
SELECT public.t_expect_error($$UPDATE public.club_settings SET club_id = 'c0000000-0000-0000-0000-00000000000b'$$, 'permission denied');
SELECT public.t_expect_error($$INSERT INTO public.club_settings (club_id) VALUES ('c0000000-0000-0000-0000-00000000000a')$$, 'permission denied');
SELECT public.t_expect_error($$DELETE FROM public.club_settings$$, 'permission denied');
-- El club de Luis no lo ve ni lo cambia
UPDATE public.club_settings SET palette = 'rosa' WHERE club_id = 'c0000000-0000-0000-0000-00000000000b';
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM public.club_settings WHERE club_id = 'c0000000-0000-0000-0000-00000000000b') = 0,
           'Ana no ve la configuracion del club B';
END $$;
SELECT public.t_logout();

DO $$ BEGIN
    ASSERT (SELECT palette FROM public.club_settings WHERE club_id = 'c0000000-0000-0000-0000-00000000000a') = 'esmeralda',
           'Ana cambio la paleta del club A';
    ASSERT (SELECT palette FROM public.club_settings WHERE club_id = 'c0000000-0000-0000-0000-00000000000b') = 'violeta',
           'El club B conserva su paleta';
    ASSERT EXISTS (SELECT 1 FROM public.audit_log
                    WHERE action = 'club_settings.updated' AND club_id = 'c0000000-0000-0000-0000-00000000000a'
                      AND entity_type = 'club' AND entity_id = 'c0000000-0000-0000-0000-00000000000a'
                      AND actor_id = 'a0000000-0000-0000-0000-000000000001'
                      AND details -> 'palette' ->> 'from' = 'violeta'
                      AND details -> 'palette' ->> 'to' = 'esmeralda'),
           'El cambio de paleta queda auditado con antes y despues';
    ASSERT (SELECT count(*) FROM public.audit_log WHERE action = 'club_settings.updated') = 3,
           'Solo los cambios reales (violeta -> esmeralda -> rojo -> esmeralda; no el intento invalido ni el club ajeno)';
    ASSERT EXISTS (SELECT 1 FROM public.audit_log WHERE action = 'club_settings.updated' AND details -> 'palette' ->> 'to' = 'rojo'),
           'Rojo (archivo 21) es una paleta valida';
END $$;

-- El historial lo muestra con el nombre del club
SELECT public.t_login_as('aaaaaaaa-0000-0000-0000-0000000000a1');
DO $$ BEGIN
    ASSERT EXISTS (SELECT 1 FROM public.v_club_activity
                    WHERE action = 'club_settings.updated' AND entity_name IS NOT NULL),
           'El historial muestra el cambio de paleta con el nombre del club';
END $$;
SELECT public.t_logout();

-- ---- Encargado del club A --------------------------------------------
SELECT public.t_login_as('bbbbbbbb-0000-0000-0000-0000000000b4');
UPDATE public.club_settings SET palette = 'coral' WHERE club_id = 'c0000000-0000-0000-0000-00000000000a';
UPDATE public.club_settings SET palette = 'rosa'  WHERE club_id = 'c0000000-0000-0000-0000-00000000000b';
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM public.club_settings) = 1, 'El encargado ve solo la configuracion de su club';
END $$;
SELECT public.t_logout();
DO $$ BEGIN
    ASSERT (SELECT palette FROM public.club_settings WHERE club_id = 'c0000000-0000-0000-0000-00000000000a') = 'coral',
           'El encargado cambia la paleta de su club';
    ASSERT (SELECT palette FROM public.club_settings WHERE club_id = 'c0000000-0000-0000-0000-00000000000b') = 'violeta',
           'Pero no la de otro club';
END $$;

-- ---- anon -------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT public.t_expect_error('SELECT * FROM public.club_settings', 'permission denied');
RESET ROLE;

ROLLBACK;
