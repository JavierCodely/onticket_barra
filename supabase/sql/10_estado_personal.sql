-- =====================================================================
-- ONTICKET - 10: ESTADO DEL PERSONAL PARA EL PANEL
-- Requiere: 01 a 08
--
-- El panel muestra si cada persona esta bloqueada por intentos de PIN,
-- pero NO puede leer failed_attempts ni locked_until (permisos por
-- columna del archivo 08). Esta funcion entrega solo el dato derivado
-- (is_locked), nunca los contadores ni la hora exacta.
--
-- Por que funcion y no vista: una vista con security_invoker (obligatorio,
-- prueba 040) corre con los permisos de quien consulta y no puede leer
-- locked_until. Por eso es SECURITY DEFINER y filtra ella misma por los
-- clubs que gestiona quien llama (visible_club_ids).
--
--   supabase.rpc('club_staff_status', { p_club_id })
-- =====================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.club_staff_status(p_club_id uuid)
RETURNS TABLE (user_id uuid, is_locked boolean)
LANGUAGE sql
STABLE
STRICT
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT u.id,
           COALESCE(u.locked_until > now(), false)
      FROM public.users u
     WHERE u.club_id = p_club_id
       AND u.deleted_at IS NULL
       AND p_club_id IN (SELECT private.visible_club_ids());
$$;
COMMENT ON FUNCTION public.club_staff_status(uuid) IS 'Por cada persona del club: si esta bloqueada por intentos de PIN. No expone contadores ni horas.';

REVOKE EXECUTE ON FUNCTION public.club_staff_status(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.club_staff_status(uuid) TO authenticated, service_role;

COMMIT;
