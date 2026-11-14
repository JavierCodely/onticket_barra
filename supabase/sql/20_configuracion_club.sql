-- =====================================================================
-- ONTICKET - 20: CONFIGURACION DEL CLUB (PALETA DE COLORES)
-- Requiere: 01 a 19
--
-- Una fila por club con sus preferencias. Por ahora, la paleta de colores
-- del panel: al entrar a un club, el panel toma sus colores; al cambiar de
-- club, cambian.
--   * La fila se crea sola al crear el club (y para los que ya existian):
--     el panel solo la MODIFICA, nunca inserta ni borra.
--   * La puede cambiar quien gestiona el club (administrador o encargado).
--   * Cambiar la paleta queda auditado ('club_settings.updated').
--   * Las paletas validas estan en el CHECK (texto, no ENUM: CLAUDE.md,
--     seccion 6). Agregar una = otro archivo que cambie el CHECK.
-- =====================================================================
BEGIN;

CREATE TABLE public.club_settings (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id    uuid        NOT NULL REFERENCES public.clubs (id),
    palette    text        NOT NULL DEFAULT 'violeta',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT club_settings_palette_check CHECK (palette IN
        ('violeta', 'azul', 'turquesa', 'esmeralda', 'ambar', 'coral', 'rosa', 'grafito')),
    CONSTRAINT club_settings_one_per_club UNIQUE (club_id),
    CONSTRAINT club_settings_id_club_unique UNIQUE (id, club_id)
);
COMMENT ON TABLE public.club_settings IS
    'Preferencias de cada club (paleta de colores del panel). Una fila por club, creada por la base.';


-- ---------------------------------------------------------------------
-- Reglas
-- ---------------------------------------------------------------------
-- Cada club nuevo nace con su configuracion. SECURITY DEFINER: el panel no
-- inserta en club_settings y quien crea el club todavia no figura en
-- visible_club_ids() dentro de la misma sentencia.
CREATE OR REPLACE FUNCTION private.club_default_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.club_settings (club_id) VALUES (NEW.id)
    ON CONFLICT (club_id) DO NOTHING;
    RETURN NULL;
END;
$$;
CREATE TRIGGER trg_clubs_default_settings
    AFTER INSERT ON public.clubs
    FOR EACH ROW EXECUTE FUNCTION private.club_default_settings();

CREATE TRIGGER trg_club_settings_club_fixed
    BEFORE UPDATE OF club_id ON public.club_settings
    FOR EACH ROW EXECUTE FUNCTION private.forbid_club_change();
CREATE TRIGGER trg_club_settings_updated_at
    BEFORE UPDATE ON public.club_settings
    FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- Auditoria del cambio de paleta. Se registra sobre el club (entity 'club')
-- para que el historial muestre su nombre. SECURITY DEFINER: el panel no
-- escribe en audit_log.
CREATE OR REPLACE FUNCTION private.club_settings_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_type text;
    v_actor_id   uuid;
BEGIN
    IF NEW.palette IS NOT DISTINCT FROM OLD.palette THEN
        RETURN NULL;
    END IF;
    SELECT a.actor_type, a.actor_id INTO v_actor_type, v_actor_id FROM private.current_actor() a;
    IF v_actor_id IS NULL THEN
        RETURN NULL;
    END IF;
    INSERT INTO public.audit_log (club_id, actor_type, actor_id, action, entity_type, entity_id, details)
    VALUES (NEW.club_id, v_actor_type, v_actor_id, 'club_settings.updated', 'club', NEW.club_id,
            jsonb_build_object('palette', jsonb_build_object('from', OLD.palette, 'to', NEW.palette)));
    RETURN NULL;
END;
$$;
CREATE TRIGGER trg_club_settings_audit
    AFTER UPDATE ON public.club_settings
    FOR EACH ROW EXECUTE FUNCTION private.club_settings_audit();


-- ---------------------------------------------------------------------
-- Clubs que ya existian
-- ---------------------------------------------------------------------
INSERT INTO public.club_settings (club_id)
SELECT c.id FROM public.clubs c
ON CONFLICT (club_id) DO NOTHING;


-- ---------------------------------------------------------------------
-- Seguridad (mismo patron que 08): se lee y se cambia la paleta del club
-- que se gestiona; no se inserta ni se borra.
-- ---------------------------------------------------------------------
ALTER TABLE public.club_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY club_settings_select ON public.club_settings
    FOR SELECT TO authenticated USING (club_id IN (SELECT private.visible_club_ids()));
CREATE POLICY club_settings_update ON public.club_settings
    FOR UPDATE TO authenticated
    USING      (club_id IN (SELECT private.visible_club_ids()))
    WITH CHECK (club_id IN (SELECT private.visible_club_ids()));

REVOKE ALL ON public.club_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_settings TO service_role;
GRANT SELECT ON public.club_settings TO authenticated;
GRANT UPDATE (palette) ON public.club_settings TO authenticated;

REVOKE EXECUTE ON FUNCTION private.club_default_settings() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.club_settings_audit()   FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION private.club_default_settings() TO service_role;
GRANT  EXECUTE ON FUNCTION private.club_settings_audit()   TO service_role;

COMMIT;
