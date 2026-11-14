// Punto de entrada de la Edge Function admin-update-user.
// Clave publicable para actuar como quien llama (can_manage_club con su JWT);
// clave secreta solo para escribir en users, que el panel no puede.
import { createClient } from "npm:@supabase/supabase-js@2.49.4"
import { crearHandler, type Persona } from "./handler.ts"

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
const COLUMNAS = "id, full_name, role, active, username, email, auth_user_id"

const admin = createClient(URL_SUPABASE, CLAVE_SECRETA, {
  auth: { persistSession: false, autoRefreshToken: false },
})

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
  obtenerPersona: async (clubId, userId) => {
    const { data } = await admin
      .from("users")
      .select(COLUMNAS)
      .eq("id", userId)
      .eq("club_id", clubId)
      .is("deleted_at", null)
      .maybeSingle()
    return (data as Persona | null) ?? null
  },
  actualizarPersona: async (clubId, userId, cambios) => {
    const { data, error } = await admin
      .from("users")
      .update(cambios)
      .eq("id", userId)
      .eq("club_id", clubId)
      .select(COLUMNAS)
      .single()
    if (error) return { error: { code: error.code ?? "", message: error.message } }
    return data as Persona
  },
  auditar: async (entrada) => {
    const { error } = await admin.from("audit_log").insert(entrada)
    return error ? { error: { code: error.code ?? "", message: error.message } } : {}
  },
  origenPanel: Deno.env.get("PANEL_ORIGIN"),
})

Deno.serve(handler)
