-- Reemplazo MINIMO de lo que Supabase ya trae (roles, auth.users,
-- auth.uid(), pgcrypto). Lo carga run.sh en la base temporal de pruebas.
--
-- Variable psql "open_defaults":
--   0 -> permisos por defecto CERRADOS: las tablas nuevas no reciben
--        permisos (comportamiento actual de Supabase).
--   1 -> permisos por defecto ABIERTOS: toda tabla nueva queda accesible
--        para anon / authenticated / service_role (Supabase anterior).
-- La suite corre en los dos modos: el esquema debe quedar igual de
-- seguro y funcional en ambos.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END;
$$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
    id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text
);
-- Igual que Supabase: lee el "sub" del JWT de la peticion.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated, service_role;

\if :open_defaults
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
\endif
