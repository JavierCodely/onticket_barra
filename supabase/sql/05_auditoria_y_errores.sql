-- =====================================================================
-- ONTICKET - 05 de 09: AUDITORIA Y ERRORES DE SINCRONIZACION
-- Requiere: 01
-- Contenido: audit_log, sync_errors
-- =====================================================================
BEGIN;

-- =====================================================================
-- A) AUDIT_LOG  (quien hizo que). Solo agregar.
-- Lo escriben:
--   * triggers, para lo que el panel web cambia directo (productos,
--     precios, impuestos, cajas, ubicaciones, clubs) -> archivo 06;
--   * las Edge Functions, para lo suyo (altas de usuarios, cambios de PIN).
-- NUNCA guardar PINs, tokens ni claves en details.
-- Acciones: '<entidad>.created', '.updated', '.activated', '.deactivated',
--           'tax.method_added', 'tax.method_removed', 'user.pin_reset', ...
-- =====================================================================
CREATE TABLE public.audit_log (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id      uuid        REFERENCES public.clubs (id),  -- NULL: accion sin club
    actor_type   text        NOT NULL,                      -- 'platform_admin' | 'user'
    actor_id     uuid        NOT NULL,                      -- id en platform_admins o users
    action       text        NOT NULL,                      -- ej: 'product.updated'
    entity_type  text        NOT NULL,                      -- ej: 'product'
    entity_id    uuid,
    -- En '.updated': {"price": {"from": 5000, "to": 5500}}
    details      jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT audit_log_actor_type_check CHECK (actor_type IN ('platform_admin', 'user')),
    CONSTRAINT audit_log_action_format    CHECK (action ~ '^[a-z_]+\.[a-z_]+$')
);
COMMENT ON TABLE public.audit_log IS 'Registro de acciones de gestion. Solo agregar.';

CREATE INDEX idx_audit_log_club_created ON public.audit_log (club_id, created_at DESC);
CREATE INDEX idx_audit_log_entity       ON public.audit_log (entity_type, entity_id);


-- =====================================================================
-- B) SYNC_ERRORS  (operaciones del posnet que no se pudieron aplicar)
-- La Edge Function pos-upload NUNCA responde 4xx por un problema de
-- negocio: eso trabaria la cola de envio del posnet. Registra el
-- problema aca, responde 2xx y un encargado lo revisa en el panel.
-- =====================================================================
CREATE TABLE public.sync_errors (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id        uuid        NOT NULL REFERENCES public.clubs (id),
    user_id        uuid,                           -- quien estaba logueado en el posnet
    table_name     text        NOT NULL,
    row_id         text,
    operation      text        NOT NULL,           -- PUT | PATCH | DELETE (PowerSync)
    error_code     text,                           -- SQLSTATE, ej: '23514'
    error_message  text        NOT NULL,
    payload        jsonb       NOT NULL DEFAULT '{}'::jsonb,
    attempts       integer     NOT NULL DEFAULT 1,
    created_at     timestamptz NOT NULL DEFAULT now(),
    resolved_at    timestamptz,
    resolved_note  text,
    CONSTRAINT sync_errors_operation_check CHECK (operation IN ('PUT', 'PATCH', 'DELETE')),
    CONSTRAINT sync_errors_attempts_check  CHECK (attempts >= 1),
    CONSTRAINT sync_errors_user_fk
        FOREIGN KEY (user_id, club_id) REFERENCES public.users (id, club_id)
);
COMMENT ON TABLE public.sync_errors IS 'Operaciones del posnet rechazadas por una regla de negocio. Pendientes mientras resolved_at sea NULL.';

CREATE INDEX idx_sync_errors_club_created ON public.sync_errors (club_id, created_at DESC);
CREATE INDEX idx_sync_errors_open ON public.sync_errors (club_id, created_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX idx_sync_errors_user ON public.sync_errors (user_id, club_id);

COMMIT;
