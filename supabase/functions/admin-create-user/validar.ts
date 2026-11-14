// Validacion del pedido de alta de personal. Mismas reglas que los CHECK
// de public.users (archivo 01); la base vuelve a validar al insertar.

export type RolPosnet = "cashier" | "bartender"

export type PedidoPosnet = {
  club_id: string
  full_name: string
  role: RolPosnet
  username: string
  pin: string
}

export type PedidoClubAdmin = {
  club_id: string
  full_name: string
  role: "club_admin"
  email: string
  password: string
}

export type Pedido = PedidoPosnet | PedidoClubAdmin

export type ResultadoValidacion =
  | { ok: true; pedido: Pedido }
  | { ok: false; errores: Record<string, string> }

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REGEX_USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/
const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// PIN de 6 a 8 digitos. El hash del PIN viaja al posnet para validar sin
// conexion, asi que un PIN corto se adivina rapido fuera de linea.
const REGEX_PIN = /^\d{6,8}$/
const LARGO_MINIMO_PASSWORD = 8

// "111111", "123456" o "987654": faciles de adivinar.
export function esPinTrivial(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true
  const digitos = [...pin].map(Number)
  const pasos = digitos.slice(1).map((d, i) => d - digitos[i])
  return pasos.every((p) => p === 1) || pasos.every((p) => p === -1)
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : ""
}

export function validarPedido(cuerpo: unknown): ResultadoValidacion {
  if (typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) {
    return { ok: false, errores: { body: "El cuerpo debe ser un objeto JSON." } }
  }
  const c = cuerpo as Record<string, unknown>
  const errores: Record<string, string> = {}

  const club_id = texto(c.club_id).trim()
  const full_name = texto(c.full_name).trim()
  const role = texto(c.role)

  if (!REGEX_UUID.test(club_id)) errores.club_id = "club_id invalido."
  if (!full_name) errores.full_name = "Ingresa el nombre."
  if (full_name.length > 120) errores.full_name = "El nombre es demasiado largo."

  if (role === "cashier" || role === "bartender") {
    const username = texto(c.username).trim().toLowerCase()
    const pin = texto(c.pin)
    if (!REGEX_USERNAME.test(username)) {
      errores.username = "Usuario: 3 a 32 caracteres; minusculas, numeros, punto, guion o guion bajo."
    }
    if (!REGEX_PIN.test(pin)) {
      errores.pin = "El PIN debe tener entre 6 y 8 digitos."
    } else if (esPinTrivial(pin)) {
      errores.pin = "El PIN es demasiado facil de adivinar."
    }
    if (Object.keys(errores).length > 0) return { ok: false, errores }
    return { ok: true, pedido: { club_id, full_name, role, username, pin } }
  }

  if (role === "club_admin") {
    const email = texto(c.email).trim().toLowerCase()
    const password = texto(c.password)
    if (!REGEX_EMAIL.test(email)) errores.email = "Email invalido."
    if (password.length < LARGO_MINIMO_PASSWORD) {
      errores.password = `La contrasena debe tener al menos ${LARGO_MINIMO_PASSWORD} caracteres.`
    }
    if (Object.keys(errores).length > 0) return { ok: false, errores }
    return { ok: true, pedido: { club_id, full_name, role, email, password } }
  }

  errores.role = "Rol invalido: cashier, bartender o club_admin."
  return { ok: false, errores }
}
