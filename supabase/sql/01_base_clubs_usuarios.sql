-- =====================================================================
-- ONTICKET - 01 de 09: BASE, CLUBS Y USUARIOS
-- Motor: Supabase (PostgreSQL 15+).
--
-- COMO EJECUTAR
--   Pegar cada archivo COMPLETO en el SQL Editor de Supabase y ejecutar,
--   en orden: 01, 02, ... 09. Cada archivo es una transaccion: si algo
--   falla no queda nada a medias (corregir y volver a ejecutar ese archivo).
--
-- FUENTE DE VERDAD
--   Las reglas de negocio, la arquitectura y las convenciones viven en
--   CLAUDE.md (raiz del repositorio). Este encabezado es un resumen.
--
-- RESUMEN DEL MODELO
--   * Multi-club: todo dato operativo lleva club_id. Las claves foraneas
--     son COMPUESTAS (x_id, club_id) hacia UNIQUE (id, club_id): la base
--     impide mezclar clubs aunque el codigo falle.
--   * Dos tipos de persona:
--       platform_admins -> crea clubs y gestiona los que creo.
--                          Login: Supabase Auth (panel web).
--       users           -> personal de UN club.
--                          club_admin: Supabase Auth (panel web).
--                          cashier / bartender: username + PIN (posnet),
--                          verificado por una Edge Function. Sin Supabase Auth.
--   * El posnet (Kotlin + PowerSync) NO escribe directo: sube por una
--     Edge Function con service_role. El panel web usa RLS (archivo 08).
--
-- CONVENCIONES DE ESTE SQL (aplican a toda migracion nueva)
--   * Nombres SIEMPRE calificados con esquema (public.x, private.x).
--   * Esquema "private": funciones internas. No se expone por la Data API.
--   * Toda funcion lleva SET search_path = '' (evita secuestro de nombres).
--   * Toda clave foranea tiene un indice que la cubre.
--   * Texto + CHECK en lugar de ENUM / DOMAIN / columnas GENERATED
--     (se replican sin sorpresas a SQLite por PowerSync).
--   * Dinero: numeric(12,2). Fechas: timestamptz.
--   * Errores de reglas de negocio: ERRCODE check_violation (clase 23).
--     La Edge Function pos-upload usa el codigo para decidir:
--       23503 (falta el padre)  -> transitorio, reintentar
--       resto de la clase 23    -> definitivo, registrar en sync_errors
--   * Comentarios en espanol y en ASCII (sin tildes) para copiar y pegar
--     sin problemas de codificacion.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- Esquema privado: funciones de triggers y de seguridad.
-- La Data API de Supabase solo expone "public": lo que vive aca no se
-- puede llamar desde el navegador.
-- ---------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;
COMMENT ON SCHEMA private IS 'Onticket: funciones internas (triggers y seguridad). No exponer en la Data API.';


-- =====================================================================
-- A) FUNCIONES COMUNES DE TRIGGER
-- =====================================================================

-- Mantiene updated_at en cada UPDATE.
CREATE OR REPLACE FUNCTION private.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- Libros de "solo agregar": prohibe UPDATE y DELETE.
-- Corregir = agregar un registro nuevo (ej: un ajuste de stock).
CREATE OR REPLACE FUNCTION private.forbid_update_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'La tabla % es de solo agregar: no admite %', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'check_violation',
              HINT = 'Corregir agregando un registro nuevo.';
END;
$$;

-- Una fila nunca cambia de club.
CREATE OR REPLACE FUNCTION private.forbid_club_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.club_id IS DISTINCT FROM OLD.club_id THEN
        RAISE EXCEPTION 'No se puede mover una fila de % a otro club', TG_TABLE_NAME
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;


-- =====================================================================
-- B) PAYMENT_METHODS  (catalogo global de metodos de pago)
-- Un solo lugar para los metodos: ventas e impuestos lo referencian.
-- Agregar un metodo = insertar una fila (no hay que tocar CHECKs).
-- PowerSync: sincronizar con "SELECT code AS id, ..." (no tiene columna id).
-- =====================================================================
CREATE TABLE public.payment_methods (
    code        text     PRIMARY KEY,
    label       text     NOT NULL,            -- texto para la interfaz
    sort_order  smallint NOT NULL,
    CONSTRAINT payment_methods_code_format CHECK (code ~ '^[a-z][a-z_]*$'),
    CONSTRAINT payment_methods_label_not_blank CHECK (btrim(label) <> '')
);
COMMENT ON TABLE public.payment_methods IS 'Catalogo global de metodos de pago (solo lectura para el panel y el posnet).';

INSERT INTO public.payment_methods (code, label, sort_order) VALUES
    ('cash',     'Efectivo',      1),
    ('transfer', 'Transferencia', 2),
    ('card',     'Tarjeta',       3),
    ('other',    'Otro',          4);


-- =====================================================================
-- C) PLATFORM_ADMINS  (administradores: crean y gestionan clubs)
-- =====================================================================
CREATE TABLE public.platform_admins (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id  uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
    email         text        NOT NULL,
    full_name     text        NOT NULL,
    active        boolean     NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz,
    CONSTRAINT platform_admins_email_lower    CHECK (email = lower(btrim(email)) AND email <> ''),
    CONSTRAINT platform_admins_name_not_blank CHECK (btrim(full_name) <> ''),
    CONSTRAINT platform_admins_email_unique   UNIQUE (email),
    CONSTRAINT platform_admins_auth_unique    UNIQUE (auth_user_id)
);
COMMENT ON TABLE public.platform_admins IS 'Administradores de la plataforma. Cada uno ve y gestiona solo los clubs que creo.';


-- =====================================================================
-- D) CLUBS
-- =====================================================================
CREATE TABLE public.clubs (
    id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by_admin_id      uuid        NOT NULL REFERENCES public.platform_admins (id),
    name                     text        NOT NULL,
    slug                     text        NOT NULL,
    timezone                 text        NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    -- Una noche de boliche cruza la medianoche. La "jornada" de reportes
    -- empieza a esta hora local: con 12, la venta de las 03:00 del sabado
    -- pertenece a la jornada del viernes.
    business_day_start_hour  smallint    NOT NULL DEFAULT 12,
    active                   boolean     NOT NULL DEFAULT true,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    deleted_at               timestamptz,
    CONSTRAINT clubs_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT clubs_slug_format    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT clubs_slug_unique    UNIQUE (slug),
    CONSTRAINT clubs_business_day_start_hour_range CHECK (business_day_start_hour BETWEEN 0 AND 23)
);
COMMENT ON TABLE public.clubs IS 'Cada club pertenece al administrador que lo creo (created_by_admin_id).';
COMMENT ON COLUMN public.clubs.business_day_start_hour IS 'Hora local (0-23) en que empieza la jornada de reportes.';

CREATE INDEX idx_clubs_created_by_admin ON public.clubs (created_by_admin_id);

-- La zona horaria debe existir: una zona invalida rompe los reportes.
CREATE OR REPLACE FUNCTION private.validate_club_timezone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names tz WHERE tz.name = NEW.timezone) THEN
        RAISE EXCEPTION 'Zona horaria desconocida: %', NEW.timezone
            USING ERRCODE = 'check_violation',
                  HINT = 'Usar un nombre IANA, por ejemplo America/Argentina/Buenos_Aires.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_clubs_validate_timezone
    BEFORE INSERT OR UPDATE OF timezone ON public.clubs
    FOR EACH ROW EXECUTE FUNCTION private.validate_club_timezone();


-- =====================================================================
-- E) USERS  (personal de UN solo club)
--    club_admin          -> email + Supabase Auth (panel web)
--    cashier / bartender -> username + PIN (posnet)
--    Altas, roles y PINs: SOLO por Edge Function (el hash del PIN se
--    calcula en el servidor). El panel no puede escribir esta tabla.
-- =====================================================================
CREATE TABLE public.users (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id          uuid        NOT NULL REFERENCES public.clubs (id),
    full_name        text        NOT NULL,
    role             text        NOT NULL,
    active           boolean     NOT NULL DEFAULT true,
    -- Login web (solo club_admin)
    email            text,
    auth_user_id     uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
    -- Login posnet (solo cashier / bartender)
    username         text,
    pin_hash         text,                 -- hash bcrypt/argon2; NUNCA el PIN
    pin_changed_at   timestamptz,
    failed_attempts  integer     NOT NULL DEFAULT 0,
    locked_until     timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    deleted_at       timestamptz,
    CONSTRAINT users_name_not_blank  CHECK (btrim(full_name) <> ''),
    CONSTRAINT users_role_check      CHECK (role IN ('club_admin', 'cashier', 'bartender')),
    CONSTRAINT users_email_lower     CHECK (email IS NULL OR (email = lower(btrim(email)) AND email <> '')),
    CONSTRAINT users_username_format CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
    CONSTRAINT users_failed_attempts_check CHECK (failed_attempts >= 0),
    -- Cada rol debe poder iniciar sesion por SU camino.
    CONSTRAINT users_login_check CHECK (
        (role = 'club_admin' AND email IS NOT NULL)
        OR
        (role IN ('cashier', 'bartender') AND username IS NOT NULL AND pin_hash IS NOT NULL)
    ),
    CONSTRAINT users_email_unique   UNIQUE (email),
    CONSTRAINT users_auth_unique    UNIQUE (auth_user_id),
    CONSTRAINT users_id_club_unique UNIQUE (id, club_id)
);
COMMENT ON TABLE public.users IS 'Personal de un club. Un usuario pertenece a un solo club.';
COMMENT ON COLUMN public.users.pin_hash IS 'Hash del PIN. Nunca se expone al panel (ver permisos por columna en el archivo 08).';

-- username unico dentro de cada club (dos clubs pueden tener "juan").
CREATE UNIQUE INDEX uq_users_club_username
    ON public.users (club_id, username)
    WHERE username IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_users_club ON public.users (club_id);

-- Un email no puede ser administrador y usuario de club a la vez: el
-- login no sabria a que cuenta corresponde. Cada tabla ya es unica por
-- separado; este trigger cubre el cruce. El candado evita que dos altas
-- simultaneas con el mismo email se salteen la validacion.
CREATE OR REPLACE FUNCTION private.enforce_unique_email_across_actors()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.email IS NULL THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('onticket.email:' || NEW.email, 0));

    IF TG_TABLE_NAME = 'users' THEN
        IF EXISTS (SELECT 1 FROM public.platform_admins a
                    WHERE a.email = NEW.email AND a.deleted_at IS NULL) THEN
            RAISE EXCEPTION 'El email % ya pertenece a un administrador', NEW.email
                USING ERRCODE = 'unique_violation';
        END IF;
    ELSIF EXISTS (SELECT 1 FROM public.users u
                   WHERE u.email = NEW.email AND u.deleted_at IS NULL) THEN
        RAISE EXCEPTION 'El email % ya pertenece a un usuario de club', NEW.email
            USING ERRCODE = 'unique_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_email_cross
    BEFORE INSERT OR UPDATE OF email ON public.users
    FOR EACH ROW EXECUTE FUNCTION private.enforce_unique_email_across_actors();
CREATE TRIGGER trg_platform_admins_email_cross
    BEFORE INSERT OR UPDATE OF email ON public.platform_admins
    FOR EACH ROW EXECUTE FUNCTION private.enforce_unique_email_across_actors();


-- =====================================================================
-- F) FUNCIONES DE IDENTIDAD (las usan las politicas RLS y la auditoria)
--    SECURITY DEFINER: leen platform_admins / users sin depender de RLS.
--    No reciben parametros: solo responden sobre quien hace la consulta.
-- =====================================================================

-- Administrador logueado en el panel (NULL si no lo es).
CREATE OR REPLACE FUNCTION private.current_admin_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT a.id
      FROM public.platform_admins a
     WHERE a.auth_user_id = (SELECT auth.uid())
       AND a.active
       AND a.deleted_at IS NULL;
$$;

-- Clubs que puede ver y gestionar quien esta logueado en el panel:
--   administrador -> los clubs que creo
--   club_admin    -> su club
CREATE OR REPLACE FUNCTION private.visible_club_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT c.id
      FROM public.clubs c
     WHERE c.created_by_admin_id = private.current_admin_id()
       AND c.deleted_at IS NULL
    UNION
    SELECT u.club_id
      FROM public.users u
     WHERE u.auth_user_id = (SELECT auth.uid())
       AND u.role = 'club_admin'
       AND u.active
       AND u.deleted_at IS NULL;
$$;

-- Quien esta logueado en el panel, para auditar. Sin filas si la
-- operacion no viene del panel (Edge Function, SQL Editor).
CREATE OR REPLACE FUNCTION private.current_actor()
RETURNS TABLE (actor_type text, actor_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT x.actor_type, x.actor_id
      FROM (
            SELECT 'platform_admin'::text AS actor_type, private.current_admin_id() AS actor_id, 1 AS priority
            UNION ALL
            SELECT 'user'::text, u.id, 2
              FROM public.users u
             WHERE u.auth_user_id = (SELECT auth.uid())
               AND u.role = 'club_admin'
               AND u.active
               AND u.deleted_at IS NULL
           ) x
     WHERE x.actor_id IS NOT NULL
     ORDER BY x.priority
     LIMIT 1;
$$;

-- "El que llama puede gestionar este club?"  Para Edge Functions: llamar
-- con el JWT de quien hace el pedido -> supabase.rpc('can_manage_club').
CREATE OR REPLACE FUNCTION public.can_manage_club(p_club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT p_club_id IN (SELECT private.visible_club_ids());
$$;
COMMENT ON FUNCTION public.can_manage_club(uuid) IS 'true si el usuario logueado (administrador o club_admin) gestiona ese club.';

COMMIT;
