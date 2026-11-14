// Validacion del pedido de edicion de personal. Mismas reglas que los CHECK
// de public.users (archivo 01); la base vuelve a validar al actualizar.
//
// Se puede cambiar: nombre, rol (solo entre cajero y barra) y si esta
// activo. El PIN se cambia con admin-reset-pin; el usuario y el email no
// se cambian (son la identidad para entrar).

export type CambiosPersonal = {
  full_name?: string
  role?: "cashier" | "bartender"
  active?: boolean
}

export type PedidoEdicion = {
  club_id: string
  user_id: string
  cambios: CambiosPersonal
}

export type ResultadoValidacion =
  | { ok: true; pedido: PedidoEdicion }
  | { ok: false; errores: Record<string, string> }

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CAMPOS_PERMITIDOS = new Set(["club_id", "user_id", "full_name", "role", "active"])

export function validarEdicion(cuerpo: unknown): ResultadoValidacion {
  if (typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) {
    return { ok: false, errores: { body: "El cuerpo debe ser un objeto JSON." } }
  }
  const c = cuerpo as Record<string, unknown>
  const errores: Record<string, string> = {}

  // Nada de campos extra: ni pin, ni pin_hash, ni username, ni club nuevo.
  const extra = Object.keys(c).filter((k) => !CAMPOS_PERMITIDOS.has(k))
  if (extra.length > 0) errores.body = `Campos no permitidos: ${extra.join(", ")}.`

  const club_id = typeof c.club_id === "string" ? c.club_id.trim() : ""
  const user_id = typeof c.user_id === "string" ? c.user_id.trim() : ""
  if (!REGEX_UUID.test(club_id)) errores.club_id = "club_id invalido."
  if (!REGEX_UUID.test(user_id)) errores.user_id = "user_id invalido."

  const cambios: CambiosPersonal = {}
  if (c.full_name !== undefined) {
    const nombre = typeof c.full_name === "string" ? c.full_name.trim() : ""
    if (!nombre) errores.full_name = "Ingresa el nombre."
    else if (nombre.length > 120) errores.full_name = "El nombre es demasiado largo."
    else cambios.full_name = nombre
  }
  if (c.role !== undefined) {
    if (c.role === "cashier" || c.role === "bartender") cambios.role = c.role
    else errores.role = "Rol invalido: solo cashier o bartender."
  }
  if (c.active !== undefined) {
    if (typeof c.active === "boolean") cambios.active = c.active
    else errores.active = "active debe ser true o false."
  }

  if (Object.keys(errores).length > 0) return { ok: false, errores }
  if (Object.keys(cambios).length === 0) return { ok: false, errores: { body: "No hay nada que cambiar." } }
  return { ok: true, pedido: { club_id, user_id, cambios } }
}
