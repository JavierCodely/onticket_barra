-- =====================================================================
-- ONTICKET - 15: ASIGNACION DE PERSONAL A UNA CAJA O UNA BARRA
-- Requiere: 01 a 14
--
-- Cada persona del posnet puede tener UNA asignacion:
--   cajero (cashier)   -> una caja  (cash_registers)
--   barra  (bartender) -> una barra (inventory_locations con kind = 'bar')
-- El encargado (club_admin) no se asigna. Respuesta del duenio del
-- proyecto a la pregunta abierta: un bartender queda en UNA barra.
--
-- Es una tabla aparte (no columnas de users) porque users solo se modifica
-- por Edge Function (CLAUDE.md, seccion 3); asignar no toca secretos y el
-- panel lo hace directo, con RLS. Quitar = borrar la fila; cambiar = update.
-- Si cambia el rol de la persona, la asignacion que ya no corresponde se
-- borra sola. Todo queda auditado.
-- =====================================================================
BEGIN;

CREATE TABLE public.staff_assignments (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id          uuid        NOT NULL REFERENCES public.clubs (id),
    user_id          uuid        NOT NULL,
    cash_register_id uuid,
    location_id      uuid,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT staff_assignments_one_target CHECK (num_nonnulls(cash_register_id, location_id) = 1),
    CONSTRAINT staff_assignments_one_per_user UNIQUE (user_id, club_id),
    CONSTRAINT staff_assignments_id_club_unique UNIQUE (id, club_id),
    CONSTRAINT staff_assignments_user_fk
        FOREIGN KEY (user_id, club_id) REFERENCES public.users (id, club_id),
    CONSTRAINT staff_assignments_register_fk
        FOREIGN KEY (cash_register_id, club_id) REFERENCES public.cash_registers (id, club_id),
    CONSTRAINT staff_assignments_location_fk
        FOREIGN KEY (location_id, club_id) REFERENCES public.inventory_locations (id, club_id)
);
COMMENT ON TABLE public.staff_assignments IS
    'Caja (cajero) o barra (bartender) asignada a cada persona del posnet. Una por persona.';

CREATE INDEX idx_staff_assignments_club     ON public.staff_assignments (club_id);
CREATE INDEX idx_staff_assignments_register ON public.staff_assignments (cash_register_id, club_id);
CREATE INDEX idx_staff_assignments_location ON public.staff_assignments (location_id, club_id);


-- ---------------------------------------------------------------------
-- Reglas
-- ---------------------------------------------------------------------
-- El destino tiene que corresponder al rol, y estar vigente.
CREATE OR REPLACE FUNCTION private.staff_assignment_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_role text;
BEGIN
    SELECT u.role INTO v_role
      FROM public.users u
     WHERE u.id = NEW.user_id AND u.club_id = NEW.club_id AND u.deleted_at IS NULL;

    IF v_role IS NULL THEN
        RAISE EXCEPTION 'La persona no existe en este club' USING ERRCODE = 'check_violation';
    END IF;

    IF v_role = 'cashier' THEN
        IF NEW.cash_register_id IS NULL THEN
            RAISE EXCEPTION 'A un cajero se le asigna una caja' USING ERRCODE = 'check_violation';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.cash_registers r
                        WHERE r.id = NEW.cash_register_id AND r.club_id = NEW.club_id
                          AND r.active AND r.deleted_at IS NULL) THEN
            RAISE EXCEPTION 'La caja no esta activa' USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_role = 'bartender' THEN
        IF NEW.location_id IS NULL THEN
            RAISE EXCEPTION 'A la barra se le asigna una barra' USING ERRCODE = 'check_violation';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.inventory_locations l
                        WHERE l.id = NEW.location_id AND l.club_id = NEW.club_id
                          AND l.kind = 'bar' AND l.active AND l.deleted_at IS NULL) THEN
            RAISE EXCEPTION 'La ubicacion no es una barra activa' USING ERRCODE = 'check_violation';
        END IF;
    ELSE
        RAISE EXCEPTION 'El encargado no se asigna a una caja ni a una barra' USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_staff_assignments_check
    BEFORE INSERT OR UPDATE ON public.staff_assignments
    FOR EACH ROW EXECUTE FUNCTION private.staff_assignment_check();
CREATE TRIGGER trg_staff_assignments_club_fixed
    BEFORE UPDATE OF club_id ON public.staff_assignments
    FOR EACH ROW EXECUTE FUNCTION private.forbid_club_change();
CREATE TRIGGER trg_staff_assignments_updated_at
    BEFORE UPDATE ON public.staff_assignments
    FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- La persona asignada no cambia: para otra persona, otra fila.
CREATE OR REPLACE FUNCTION private.staff_assignment_user_fixed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION 'La asignacion no cambia de persona' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_staff_assignments_user_fixed
    BEFORE UPDATE OF user_id ON public.staff_assignments
    FOR EACH ROW EXECUTE FUNCTION private.staff_assignment_user_fixed();

-- Auditoria: asignar, cambiar y quitar. SECURITY DEFINER: el panel no
-- escribe en audit_log.
CREATE OR REPLACE FUNCTION private.staff_assignment_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_type text;
    v_actor_id   uuid;
    v_row        public.staff_assignments;
BEGIN
    SELECT a.actor_type, a.actor_id INTO v_actor_type, v_actor_id FROM private.current_actor() a;
    IF v_actor_id IS NULL THEN
        RETURN NULL;
    END IF;
    v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

    INSERT INTO public.audit_log (club_id, actor_type, actor_id, action, entity_type, entity_id, details)
    VALUES (
        v_row.club_id, v_actor_type, v_actor_id,
        CASE TG_OP WHEN 'INSERT' THEN 'staff_assignment.assigned'
                   WHEN 'UPDATE' THEN 'staff_assignment.changed'
                   ELSE 'staff_assignment.removed' END,
        'user', v_row.user_id,
        jsonb_build_object('cash_register_id', v_row.cash_register_id, 'location_id', v_row.location_id)
    );
    RETURN NULL;
END;
$$;
CREATE TRIGGER trg_staff_assignments_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.staff_assignments
    FOR EACH ROW EXECUTE FUNCTION private.staff_assignment_audit();

-- Si cambia el rol (por Edge Function), la asignacion vieja ya no sirve.
CREATE OR REPLACE FUNCTION private.users_role_change_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
        DELETE FROM public.staff_assignments a WHERE a.user_id = NEW.id AND a.club_id = NEW.club_id;
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER trg_users_role_change_assignment
    AFTER UPDATE OF role ON public.users
    FOR EACH ROW EXECUTE FUNCTION private.users_role_change_assignment();


-- ---------------------------------------------------------------------
-- Seguridad (mismo patron que 08)
-- ---------------------------------------------------------------------
ALTER TABLE public.staff_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_assignments_select ON public.staff_assignments
    FOR SELECT TO authenticated USING (club_id IN (SELECT private.visible_club_ids()));
CREATE POLICY staff_assignments_insert ON public.staff_assignments
    FOR INSERT TO authenticated WITH CHECK (club_id IN (SELECT private.visible_club_ids()));
CREATE POLICY staff_assignments_update ON public.staff_assignments
    FOR UPDATE TO authenticated
    USING      (club_id IN (SELECT private.visible_club_ids()))
    WITH CHECK (club_id IN (SELECT private.visible_club_ids()));
CREATE POLICY staff_assignments_delete ON public.staff_assignments
    FOR DELETE TO authenticated USING (club_id IN (SELECT private.visible_club_ids()));

REVOKE ALL ON public.staff_assignments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_assignments TO service_role;
GRANT SELECT, DELETE ON public.staff_assignments TO authenticated;
GRANT INSERT (club_id, user_id, cash_register_id, location_id) ON public.staff_assignments TO authenticated;
GRANT UPDATE (cash_register_id, location_id) ON public.staff_assignments TO authenticated;

REVOKE EXECUTE ON FUNCTION private.staff_assignment_check()       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.staff_assignment_user_fixed()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.staff_assignment_audit()       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.users_role_change_assignment() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.staff_assignment_check()       TO service_role;
GRANT EXECUTE ON FUNCTION private.staff_assignment_user_fixed()  TO service_role;
GRANT EXECUTE ON FUNCTION private.staff_assignment_audit()       TO service_role;
GRANT EXECUTE ON FUNCTION private.users_role_change_assignment() TO service_role;

-- El posnet sabe en que caja o barra trabaja cada persona.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync')
       AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                        WHERE pubname = 'powersync' AND schemaname = 'public' AND tablename = 'staff_assignments') THEN
        ALTER PUBLICATION powersync ADD TABLE public.staff_assignments;
    END IF;
END;
$$;

COMMIT;
