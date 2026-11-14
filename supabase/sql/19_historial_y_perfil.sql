-- =====================================================================
-- ONTICKET - 19: PERFIL DEL ADMINISTRADOR E HISTORIAL DE CAMBIOS
-- Requiere: 01 a 18
--
-- A) Perfil: platform_admins ya es la ficha del administrador, vinculada
--    a su usuario de Supabase Auth (auth_user_id). Se le agregan nombre,
--    apellido y telefono. full_name lo arma la base (nombre + apellido).
--    Cada administrador ve y edita SOLO su ficha (telefono y email no
--    los ve nadie mas).
--
-- B) Nombres: el encargado de un club no puede leer platform_admins. Para
--    el historial, club_admin_names(p_club_id) entrega SOLO el nombre del
--    administrador del club (el que lo creo), si quien llama gestiona ese
--    club. Mismo patron que club_staff_status (archivo 10).
--
-- C) Historial: v_club_activity junta todo lo que hace el panel en un
--    club, con quien y cuando:
--      * audit_log (productos, precios, impuestos, cajas, barras, personal,
--        combos, promociones, categorias, noches, ...);
--      * movimientos de stock manuales (carga, compra, ajuste, transferencia);
--      * cambio en efectivo (inicial, refuerzo, correccion).
--    club_activity(...) devuelve las filas de un rango de fechas y
--    club_activity_by_day(...) cuantas hubo por dia (el mapa de calor).
--    Las fechas son del CALENDARIO en la zona horaria del club (no la
--    jornada): el historial es de gestion, no de ventas.
-- =====================================================================
BEGIN;

-- =====================================================================
-- A) PERFIL DEL ADMINISTRADOR
-- =====================================================================
ALTER TABLE public.platform_admins
    ADD COLUMN first_name text,
    ADD COLUMN last_name  text,
    ADD COLUMN phone      text;

UPDATE public.platform_admins
   SET first_name = split_part(btrim(full_name), ' ', 1),
       last_name  = NULLIF(btrim(substr(btrim(full_name), length(split_part(btrim(full_name), ' ', 1)) + 1)), '');

ALTER TABLE public.platform_admins
    ADD CONSTRAINT platform_admins_first_name_check
        CHECK (first_name IS NULL OR length(btrim(first_name)) BETWEEN 1 AND 60),
    ADD CONSTRAINT platform_admins_last_name_check
        CHECK (last_name IS NULL OR length(btrim(last_name)) BETWEEN 1 AND 60),
    ADD CONSTRAINT platform_admins_phone_check
        CHECK (phone IS NULL OR phone ~ '^\+?[0-9][0-9 ()-]{5,24}$');
COMMENT ON COLUMN public.platform_admins.phone IS 'Telefono de contacto. Solo lo ve el propio administrador.';

-- full_name = nombre + apellido (lo arma la base; nadie lo escribe a mano
-- si hay nombre).
CREATE OR REPLACE FUNCTION private.platform_admin_names()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.first_name := NULLIF(btrim(NEW.first_name), '');
    NEW.last_name  := NULLIF(btrim(NEW.last_name), '');
    NEW.phone      := NULLIF(btrim(NEW.phone), '');
    IF NEW.first_name IS NOT NULL THEN
        NEW.full_name := btrim(NEW.first_name || ' ' || COALESCE(NEW.last_name, ''));
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_platform_admins_names
    BEFORE INSERT OR UPDATE ON public.platform_admins
    FOR EACH ROW EXECUTE FUNCTION private.platform_admin_names();

-- Auditoria del perfil (sin club). Nunca guarda el telefono: solo que cambio.
CREATE OR REPLACE FUNCTION private.platform_admin_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_details jsonb := '{}'::jsonb;
BEGIN
    IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
        v_details := v_details || jsonb_build_object('full_name', jsonb_build_object('from', OLD.full_name, 'to', NEW.full_name));
    END IF;
    IF NEW.phone IS DISTINCT FROM OLD.phone THEN
        v_details := v_details || jsonb_build_object('phone_changed', true);
    END IF;
    IF v_details <> '{}'::jsonb THEN
        INSERT INTO public.audit_log (club_id, actor_type, actor_id, action, entity_type, entity_id, details)
        VALUES (NULL, 'platform_admin', NEW.id, 'platform_admin.updated', 'platform_admin', NEW.id, v_details);
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER trg_platform_admins_audit
    AFTER UPDATE ON public.platform_admins
    FOR EACH ROW EXECUTE FUNCTION private.platform_admin_audit();

-- El administrador edita solo su ficha y solo estas columnas.
CREATE POLICY platform_admins_update_self ON public.platform_admins
    FOR UPDATE TO authenticated
    USING      (auth_user_id = (SELECT auth.uid()))
    WITH CHECK (auth_user_id = (SELECT auth.uid()));
GRANT UPDATE (first_name, last_name, phone) ON public.platform_admins TO authenticated;

REVOKE EXECUTE ON FUNCTION private.platform_admin_names() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.platform_admin_audit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.platform_admin_names() TO service_role;
GRANT EXECUTE ON FUNCTION private.platform_admin_audit() TO service_role;


-- =====================================================================
-- B) NOMBRE DEL ADMINISTRADOR DE UN CLUB
--   supabase.rpc('club_admin_names', { p_club_id })
-- SECURITY DEFINER: lee platform_admins, que el encargado no ve. Entrega
-- solo id y nombre (nunca email ni telefono), y solo del club que
-- gestiona quien llama.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.club_admin_names(p_club_id uuid)
RETURNS TABLE (admin_id uuid, full_name text)
LANGUAGE sql
STABLE
STRICT
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT pa.id, pa.full_name
      FROM public.clubs c
      JOIN public.platform_admins pa ON pa.id = c.created_by_admin_id
     WHERE c.id = p_club_id
       AND p_club_id IN (SELECT private.visible_club_ids());
$$;
COMMENT ON FUNCTION public.club_admin_names(uuid) IS
    'Nombre del administrador del club (solo id y nombre), para el historial. Solo para quien gestiona el club.';
REVOKE EXECUTE ON FUNCTION public.club_admin_names(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.club_admin_names(uuid) TO authenticated, service_role;


-- =====================================================================
-- C) HISTORIAL DE CAMBIOS
-- =====================================================================
-- Indices para buscar por club y fecha solo lo que cargo el panel.
CREATE INDEX idx_inventory_movements_manual_created
    ON public.inventory_movements (club_id, created_at DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX idx_cash_register_floats_club_created
    ON public.cash_register_floats (club_id, created_at DESC);

CREATE VIEW public.v_club_activity
WITH (security_invoker = true) AS
SELECT x.id,
       x.club_id,
       x.occurred_at,
       (x.occurred_at AT TIME ZONE c.timezone)::date AS local_date,
       x.actor_type,
       x.actor_id,
       -- El nombre del personal sale de users; el del administrador lo da
       -- club_admin_names (quien no es el propio administrador no lo lee).
       CASE x.actor_type
           WHEN 'user' THEN (SELECT u.full_name FROM public.users u WHERE u.id = x.actor_id)
           ELSE (SELECT pa.full_name FROM public.platform_admins pa WHERE pa.id = x.actor_id)
       END AS actor_name,
       x.action,
       x.entity_type,
       x.entity_id,
       CASE x.entity_type
           WHEN 'product'            THEN (SELECT p.name FROM public.products p WHERE p.id = x.entity_id)
           WHEN 'tax'                THEN (SELECT t.name FROM public.taxes t WHERE t.id = x.entity_id)
           WHEN 'inventory_location' THEN (SELECT l.name FROM public.inventory_locations l WHERE l.id = x.entity_id)
           WHEN 'cash_register'      THEN (SELECT r.name FROM public.cash_registers r WHERE r.id = x.entity_id)
           WHEN 'user'               THEN (SELECT u.full_name FROM public.users u WHERE u.id = x.entity_id)
           WHEN 'promotion'          THEN (SELECT pr.name FROM public.promotions pr WHERE pr.id = x.entity_id)
           WHEN 'product_category'   THEN (SELECT pc.name FROM public.product_categories pc WHERE pc.id = x.entity_id)
           WHEN 'club'               THEN (SELECT cl.name FROM public.clubs cl WHERE cl.id = x.entity_id)
       END AS entity_name,
       x.details
FROM (
    SELECT a.id, a.club_id, a.created_at AS occurred_at, a.actor_type, a.actor_id,
           a.action, a.entity_type, a.entity_id, a.details
      FROM public.audit_log a
     WHERE a.club_id IS NOT NULL
    UNION ALL
    SELECT m.id, m.club_id, m.created_at, m.actor_type, m.actor_id,
           'stock.' || m.movement_type, 'product', m.product_id,
           jsonb_build_object('location_id', m.location_id, 'quantity', m.quantity, 'note', m.note)
      FROM public.inventory_movements m
     WHERE m.actor_id IS NOT NULL
    UNION ALL
    SELECT f.id, f.club_id, f.created_at, f.actor_type, f.actor_id,
           'cash_float.' || f.kind, 'cash_register', f.cash_register_id,
           jsonb_build_object('amount', f.amount, 'note', f.note, 'night_id', f.night_id)
      FROM public.cash_register_floats f
     WHERE f.actor_id IS NOT NULL
) x
JOIN public.clubs c ON c.id = x.club_id;
COMMENT ON VIEW public.v_club_activity IS
    'Todo lo que hizo el panel en un club (auditoria, stock manual, cambio en efectivo): que, quien y cuando.';

-- Filas de un rango de fechas del calendario del club (ambas incluidas),
-- de la mas nueva a la mas vieja. RLS: quien llama solo ve sus clubs.
--   supabase.rpc('club_activity', { p_club_id, p_from, p_to, p_limit })
CREATE OR REPLACE FUNCTION public.club_activity(p_club_id uuid, p_from date, p_to date, p_limit integer DEFAULT 500)
RETURNS SETOF public.v_club_activity
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT a.*
      FROM public.v_club_activity a
      JOIN public.clubs c ON c.id = p_club_id
     WHERE a.club_id = p_club_id
       AND a.occurred_at >= (p_from::timestamp AT TIME ZONE c.timezone)
       AND a.occurred_at <  ((p_to + 1)::timestamp AT TIME ZONE c.timezone)
     ORDER BY a.occurred_at DESC, a.id
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 2000);
$$;
COMMENT ON FUNCTION public.club_activity(uuid, date, date, integer) IS
    'Historial de cambios del club entre dos fechas locales (incluidas), lo mas nuevo primero. Maximo 2000 filas.';

-- Cantidad de cambios por dia (mapa de calor). Hasta 400 dias.
--   supabase.rpc('club_activity_by_day', { p_club_id, p_from, p_to })
CREATE OR REPLACE FUNCTION public.club_activity_by_day(p_club_id uuid, p_from date, p_to date)
RETURNS TABLE (day date, changes bigint)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT a.local_date, count(*)
      FROM public.v_club_activity a
      JOIN public.clubs c ON c.id = p_club_id
     WHERE a.club_id = p_club_id
       AND p_to - p_from BETWEEN 0 AND 400
       AND a.occurred_at >= (p_from::timestamp AT TIME ZONE c.timezone)
       AND a.occurred_at <  ((p_to + 1)::timestamp AT TIME ZONE c.timezone)
     GROUP BY a.local_date
     ORDER BY a.local_date;
$$;
COMMENT ON FUNCTION public.club_activity_by_day(uuid, date, date) IS
    'Cuantos cambios hubo por dia (fecha local del club) en un rango de hasta 400 dias.';

REVOKE ALL ON public.v_club_activity FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_club_activity TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.club_activity(uuid, date, date, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.club_activity_by_day(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_activity(uuid, date, date, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.club_activity_by_day(uuid, date, date) TO authenticated, service_role;

COMMIT;
