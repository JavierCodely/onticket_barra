// Reglas de validacion del panel. Son una ayuda para el usuario: la base
// (CHECK y triggers) vuelve a validar todo. Nunca confiar solo en esto.

export type DatosClub = {
  name: string
  slug: string
  timezone: string
  businessDayStartHour: number
}

export type ErroresClub = Partial<Record<keyof DatosClub, string>>

export type Resultado<T, E> = { ok: true; valor: T } | { ok: false; errores: E }

const REGEX_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

// Convierte "Club Centro Ñandú" en "club-centro-nandu".
export function slugDesdeNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function validarClub(datos: DatosClub): Resultado<DatosClub, ErroresClub> {
  const errores: ErroresClub = {}
  const name = datos.name.trim()
  const slug = datos.slug.trim()
  const timezone = datos.timezone.trim()

  if (!name) errores.name = "Ingresá el nombre del club."
  if (!REGEX_SLUG.test(slug)) {
    errores.slug = "Usá solo minúsculas, números y guiones (ej: club-centro)."
  }
  if (!timezone) {
    errores.timezone = "Ingresá una zona horaria (ej: America/Argentina/Buenos_Aires)."
  }
  if (
    !Number.isInteger(datos.businessDayStartHour) ||
    datos.businessDayStartHour < 0 ||
    datos.businessDayStartHour > 23
  ) {
    errores.businessDayStartHour = "La hora debe estar entre 0 y 23."
  }

  if (Object.keys(errores).length > 0) return { ok: false, errores }
  return {
    ok: true,
    valor: { name, slug, timezone, businessDayStartHour: datos.businessDayStartHour },
  }
}

// ---------------------------------------------------------------------
// Impuestos (CLAUDE.md, reglas 21 a 24 y seccion 8)
// ---------------------------------------------------------------------
export type TipoImpuesto = "percentage" | "fixed"

export type DatosImpuesto = {
  name: string
  kind: TipoImpuesto
  valor: string
  metodos: string[]
}

export type ValorImpuesto = {
  name: string
  kind: TipoImpuesto
  percentage: string | null
  fixed_amount: string | null
  metodos: string[]
}

export type ErroresImpuesto = Partial<Record<"name" | "valor" | "metodos", string>>

// Mismas escalas que la base: percentage numeric(7,4), fixed_amount numeric(12,2).
const REGEX_PORCENTAJE = /^\d{1,3}(\.\d{1,4})?$/

export function validarImpuesto(datos: DatosImpuesto): Resultado<ValorImpuesto, ErroresImpuesto> {
  const errores: ErroresImpuesto = {}
  const name = datos.name.trim()
  const valor = datos.valor.trim().replace(",", ".")

  if (!name) errores.name = "Ingresá el nombre del impuesto."
  if (datos.kind === "percentage") {
    if (!REGEX_PORCENTAJE.test(valor) || Number(valor) <= 0 || Number(valor) > 100) {
      errores.valor = "El porcentaje debe ser mayor a 0 y hasta 100 (ej: 3 o 1.2)."
    }
  } else if (!REGEX_MONTO.test(valor) || Number(valor) <= 0) {
    errores.valor = "El monto por unidad debe ser mayor a 0 (ej: 50 o 50.50)."
  }
  const metodos = [...new Set(datos.metodos)]
  if (metodos.length === 0) errores.metodos = "Elegí al menos un método de pago."

  if (Object.keys(errores).length > 0) return { ok: false, errores }
  return {
    ok: true,
    valor: {
      name,
      kind: datos.kind,
      percentage: datos.kind === "percentage" ? valor : null,
      fixed_amount: datos.kind === "fixed" ? valor : null,
      metodos,
    },
  }
}

// ---------------------------------------------------------------------
// Movimientos manuales de stock (CLAUDE.md, reglas 10 a 12)
// Nadie escribe el saldo: se carga una linea en el libro y un trigger
// actualiza inventory_balances.
// ---------------------------------------------------------------------
export type TipoMovimiento = "initial" | "purchase" | "adjustment" | "transfer"

export type DatosMovimiento = {
  tipo: TipoMovimiento
  productoId: string
  ubicacionId: string
  destinoId: string
  cantidad: string
  nota: string
}

export type FilaMovimiento = {
  location_id: string
  product_id: string
  movement_type: "initial" | "purchase" | "adjustment" | "transfer_in" | "transfer_out"
  quantity: number
  note: string | null
}

export type ErroresMovimiento = Partial<Record<"productoId" | "ubicacionId" | "destinoId" | "cantidad", string>>

const MAXIMO_UNIDADES = 1_000_000

export function validarMovimiento(datos: DatosMovimiento): Resultado<FilaMovimiento[], ErroresMovimiento> {
  const errores: ErroresMovimiento = {}
  const texto = datos.cantidad.trim()
  const cantidad = Number(texto)
  const nota = datos.nota.trim() || null

  if (!datos.productoId) errores.productoId = "Elegí un producto."
  if (!datos.ubicacionId) errores.ubicacionId = "Elegí una ubicación."

  const esEntero = /^-?\d+$/.test(texto) && Math.abs(cantidad) <= MAXIMO_UNIDADES
  if (datos.tipo === "adjustment") {
    if (!esEntero || cantidad === 0) {
      errores.cantidad = "El ajuste es un número entero distinto de 0 (negativo para descontar)."
    }
  } else if (!esEntero || cantidad <= 0) {
    errores.cantidad = "Ingresá una cantidad entera mayor a 0."
  }

  if (datos.tipo === "transfer") {
    if (!datos.destinoId) errores.destinoId = "Elegí el destino."
    else if (datos.destinoId === datos.ubicacionId) errores.destinoId = "El destino debe ser otra ubicación."
  }

  if (Object.keys(errores).length > 0) return { ok: false, errores }

  const base = { product_id: datos.productoId, note: nota }
  if (datos.tipo === "transfer") {
    // Dos lineas del libro en una sola insercion: sale de un lado y entra en el otro.
    return {
      ok: true,
      valor: [
        { ...base, location_id: datos.ubicacionId, movement_type: "transfer_out", quantity: -cantidad },
        { ...base, location_id: datos.destinoId, movement_type: "transfer_in", quantity: cantidad },
      ],
    }
  }
  return {
    ok: true,
    valor: [{ ...base, location_id: datos.ubicacionId, movement_type: datos.tipo, quantity: cantidad }],
  }
}

// ---------------------------------------------------------------------
// Alta de personal. Ayuda al usuario; la Edge Function admin-create-user
// vuelve a validar todo y calcula el hash del PIN.
// ---------------------------------------------------------------------
export type RolPersonal = "cashier" | "bartender" | "club_admin"

export type DatosPersonal = {
  fullName: string
  role: RolPersonal
  username: string
  pin: string
  email: string
  password: string
}

export type PedidoPersonal =
  | { full_name: string; role: "cashier" | "bartender"; username: string; pin: string }
  | { full_name: string; role: "club_admin"; email: string; password: string }

export type ErroresPersonal = Partial<Record<keyof DatosPersonal, string>>

const REGEX_USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/
const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function esPinTrivial(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true
  const digitos = [...pin].map(Number)
  const pasos = digitos.slice(1).map((d, i) => d - digitos[i])
  return pasos.every((p) => p === 1) || pasos.every((p) => p === -1)
}

export function validarPersonal(datos: DatosPersonal): Resultado<PedidoPersonal, ErroresPersonal> {
  const errores: ErroresPersonal = {}
  const full_name = datos.fullName.trim()
  if (!full_name) errores.fullName = "Ingresá el nombre."

  if (datos.role === "club_admin") {
    const email = datos.email.trim().toLowerCase()
    if (!REGEX_EMAIL.test(email)) errores.email = "Ingresá un email válido."
    if (datos.password.length < 8) errores.password = "La contraseña debe tener al menos 8 caracteres."
    if (Object.keys(errores).length > 0) return { ok: false, errores }
    return { ok: true, valor: { full_name, role: "club_admin", email, password: datos.password } }
  }

  const username = datos.username.trim().toLowerCase()
  if (!REGEX_USERNAME.test(username)) {
    errores.username = "De 3 a 32 caracteres: minúsculas, números, punto, guion o guion bajo."
  }
  if (!/^\d{6,8}$/.test(datos.pin)) errores.pin = "El PIN debe tener entre 6 y 8 dígitos."
  else if (esPinTrivial(datos.pin)) errores.pin = "El PIN es demasiado fácil de adivinar (ej: 123456 o 111111)."
  if (Object.keys(errores).length > 0) return { ok: false, errores }
  return { ok: true, valor: { full_name, role: datos.role, username, pin: datos.pin } }
}

export type DatosProducto = {
  name: string
  sku: string
  categoryId: string
  cost: string
  price: string
}

export type ValorProducto = {
  name: string
  sku: string | null
  category_id: string | null
  cost: string
  price: string
  units_per_box?: number | null // archivo 22 (solo productos comunes)
}

export type ErroresProducto = Partial<Record<keyof DatosProducto, string>>

// Dinero como texto con dos decimales, igual que llega desde la base.
const REGEX_MONTO = /^\d+(\.\d{1,2})?$/

export function validarProducto(datos: DatosProducto): Resultado<ValorProducto, ErroresProducto> {
  const errores: ErroresProducto = {}
  const name = datos.name.trim()
  const sku = datos.sku.trim()
  const cost = datos.cost.trim() || "0"
  const price = datos.price.trim()

  if (!name) errores.name = "Ingresá el nombre del producto."
  if (!REGEX_MONTO.test(price)) errores.price = "Ingresá un precio válido (ej: 5000 o 5000.50)."
  if (!REGEX_MONTO.test(cost)) errores.cost = "Ingresá un costo válido (ej: 1200 o 1200.50)."

  if (Object.keys(errores).length > 0) return { ok: false, errores }
  return {
    ok: true,
    valor: {
      name,
      sku: sku || null,
      category_id: datos.categoryId || null,
      cost,
      price,
    },
  }
}

// ---------------------------------------------------------------------
// Cambio en efectivo de una caja (vacio o 0 = sin cambio)
// ---------------------------------------------------------------------
export function validarCambio(texto: string, obligatorio = false): Resultado<string, string> {
  const valor = texto.trim().replace(",", ".")
  if (valor === "" || /^0+(\.0+)?$/.test(valor)) {
    return obligatorio ? { ok: false, errores: "Ingresá un monto mayor a 0." } : { ok: true, valor: "0" }
  }
  if (!REGEX_MONTO.test(valor)) return { ok: false, errores: "Monto inválido (ej: 20000 o 20000.50)." }
  return { ok: true, valor }
}

// ---------------------------------------------------------------------
// Cargar una barra desde el deposito: nunca mas de lo que hay.
// ---------------------------------------------------------------------
export function validarCargaBarra(texto: string, disponible: number): Resultado<number, string> {
  const valor = texto.trim()
  if (!/^\d+$/.test(valor) || Number(valor) <= 0) return { ok: false, errores: "Ingresá una cantidad entera mayor a 0." }
  const cantidad = Number(valor)
  if (cantidad > disponible) {
    return { ok: false, errores: `En el depósito hay ${Math.max(disponible, 0)}: no se puede cargar más que eso.` }
  }
  return { ok: true, valor: cantidad }
}

// ---------------------------------------------------------------------
// Foto de producto: JPG, PNG o WebP de hasta 2 MB (lo mismo exige el bucket)
// ---------------------------------------------------------------------
export const TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp"]
export const MAX_FOTO_BYTES = 2 * 1024 * 1024

export function validarFoto(archivo: { type: string; size: number }): string | null {
  if (!TIPOS_FOTO.includes(archivo.type)) return "La foto tiene que ser JPG, PNG o WebP."
  if (archivo.size > MAX_FOTO_BYTES) return "La foto pesa más de 2 MB. Achicala y volvé a intentar."
  if (archivo.size === 0) return "El archivo está vacío."
  return null
}

// ---------------------------------------------------------------------
// Modificar el stock de una barra (nadie escribe el saldo: regla 10)
// ---------------------------------------------------------------------
// Corregir conteo: se cuenta lo que hay de verdad y se registra un ajuste
// por la diferencia con el saldo actual.
export function calcularAjusteConteo(texto: string, enBarra: number): Resultado<number, string> {
  const valor = texto.trim()
  if (!/^\d+$/.test(valor) || Number(valor) > MAXIMO_UNIDADES) {
    return { ok: false, errores: "Ingresá la cantidad que hay en la barra (entero, 0 o más)." }
  }
  const diferencia = Number(valor) - enBarra
  if (diferencia === 0) return { ok: false, errores: "Es la misma cantidad que figura: no hay nada que corregir." }
  return { ok: true, valor: diferencia }
}

// Devolver al deposito: no mas de lo que hay en la barra.
export function validarDevolucion(texto: string, enBarra: number): Resultado<number, string> {
  const valor = texto.trim()
  if (!/^\d+$/.test(valor) || Number(valor) <= 0) return { ok: false, errores: "Ingresá una cantidad entera mayor a 0." }
  const cantidad = Number(valor)
  if (cantidad > enBarra) {
    return {
      ok: false,
      errores: enBarra > 0 ? `En la barra hay ${enBarra}: no se puede devolver más que eso.` : "En la barra no hay stock para devolver.",
    }
  }
  return { ok: true, valor: cantidad }
}
