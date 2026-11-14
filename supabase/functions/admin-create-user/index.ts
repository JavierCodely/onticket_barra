// Punto de entrada de la Edge Function admin-create-user.
// Conecta el handler con Supabase (clave publicable para actuar como quien
// llama; clave secreta solo para escribir lo que el panel no puede) y bcrypt.
import { createClient } from "npm:@supabase/supabase-js@2.49.4"
import bcrypt from "npm:bcryptjs@2.4.3"
import { crearHandler } from "./handler.ts"

// Claves nuevas (JSON con nombre "default"); en local la CLI da una sola.
function clave(variableJson: string, variableSimple: string): string {
  const crudo = Deno.env.get(variableJson)
  if (crudo) {
    const porNombre = JSON.parse(crudo) as Record<string, string>
    if (porNombre.default) return porNombre.default
  }
  const simple = Deno.env.get(variableSimple)
  if (simple) return simple
  throw new Error(`Falta la variable ${variableJson} o ${variableSimple}`)
}

const URL_SUPABASE = Deno.env.get("SUPABASE_URL") ?? ""
const CLAVE_PUBLICABLE = clave("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_PUBLISHABLE_KEY")
const CLAVE_SECRETA = clave("SUPABASE_SECRET_KEYS", "SUPABASE_SECRET_KEY")
const COSTO_BCRYPT = 10

const admin = createClient(URL_SUPABASE, CLAVE_SECRETA, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// Cliente que actua como quien llama: RLS y can_manage_club con su JWT.
function comoLlamante(token: string) {
  return createClient(URL_SUPABASE, CLAVE_PUBLICABLE, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const handler = crearHandler({
  usuarioDelToken: async (token) => {
    const { data, error } = await admin.auth.getUser(token)
    return error || !data.user ? null : data.user.id
  },
  puedeGestionarClub: async (token, clubId) => {
    const { data, error } = await comoLlamante(token).rpc("can_manage_club", { p_club_id: clubId })
    return !error && data === true
  },
  actorDelLlamante: async (authUserId, clubId) => {
    const { data: adminFila } = await admin
      .from("platform_admins")
      .select("id")
      .eq("auth_user_id", authUserId)
      .eq("active", true)
      .is("deleted_at", null)
      .maybeSingle()
    if (adminFila) return { actor_type: "platform_admin", actor_id: adminFila.id }
    const { data: usuario } = await admin
      .from("users")
      .select("id")
      .eq("auth_user_id", authUserId)
      .eq("club_id", clubId)
      .eq("role", "club_admin")
      .eq("active", true)
      .is("deleted_at", null)
      .maybeSingle()
    return usuario ? { actor_type: "user", actor_id: usuario.id } : null
  },
  hashPin: (pin) => bcrypt.hash(pin, COSTO_BCRYPT),
  crearUsuarioAuth: async (email, password) => {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error || !data.user) return { error: { code: "auth", message: error?.message ?? "" } }
    return { id: data.user.id }
  },
  borrarUsuarioAuth: async (id) => {
    await admin.auth.admin.deleteUser(id)
  },
  insertarUsuario: async (fila) => {
    const { data, error } = await admin.from("users").insert(fila).select("id").single()
    if (error) return { error: { code: error.code ?? "", message: error.message } }
    return { id: data.id }
  },
  auditar: async (entrada) => {
    const { error } = await admin.from("audit_log").insert(entrada)
    return error ? { error: { code: error.code ?? "", message: error.message } } : {}
  },
  ahora: () => new Date(),
  origenPanel: Deno.env.get("PANEL_ORIGIN"),
})

Deno.serve(handler)
