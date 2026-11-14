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

-- Storage minimo, como lo trae Supabase: buckets, objects con RLS activa
-- y permisos para los roles de la API (las politicas deciden).
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
    id                 text PRIMARY KEY,
    name               text NOT NULL,
    public             boolean DEFAULT false,
    file_size_limit    bigint,
    allowed_mime_types text[]
);
CREATE TABLE IF NOT EXISTS storage.objects (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id  text REFERENCES storage.buckets (id),
    name       text,
    owner      uuid,
    created_at timestamptz DEFAULT now(),
    metadata   jsonb
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
-- Igual que la de Supabase: las carpetas de la ruta, sin el archivo.
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE _parts text[];
BEGIN
    SELECT string_to_array(name, '/') INTO _parts;
    RETURN _parts[1:array_length(_parts, 1) - 1];
END
$$;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON storage.objects TO anon, authenticated, service_role;
GRANT SELECT ON storage.buckets TO anon, authenticated, service_role;

-- Supabase trae la publicacion de Realtime (vacia, con lista de tablas).
-- (En un Postgres de prueba sin wal_level=logical avisa: se silencia.)
SET client_min_messages = error;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END;
$$;

\if :open_defaults
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
\endif
