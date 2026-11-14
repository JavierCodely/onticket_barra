// Historial de cambios del club (archivo 19, v_club_activity): textos en
// castellano para cada accion y la grilla de actividad por dia (como la de
// GitHub). Todo es puro: se prueba sin red.
import { formatearMonto, formatearPorcentaje, type Monto } from "./formato"
import { nombrePaleta } from "./paletas"
import { describirDias } from "./promociones"

export type Actividad = {
  id: string
  club_id: string
  occurred_at: string
  local_date: string
  actor_type: "platform_admin" | "user" | null
  actor_id: string | null
  actor_name: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  entity_name: string | null
  details: Record<string, unknown> | null
}

// Nombres para traducir los ids que guardan los detalles.
export type NombresHistorial = {
  ubicaciones: Map<string, string>
  cajas: Map<string, string>
  categorias: Map<string, string>
  productos: Map<string, string>
  metodos: Map<string, string>
  administradores: Map<string, string>
}

export const NOMBRES_VACIOS: NombresHistorial = {
  ubicaciones: new Map(),
  cajas: new Map(),
  categorias: new Map(),
  productos: new Map(),
  metodos: new Map(),
  administradores: new Map(),
}

export type Descripcion = { titulo: string; detalles: string[] }

// ---- Quien -----------------------------------------------------------
// El encargado no lee platform_admins: el nombre del administrador sale de
// club_admin_names. Si no esta, se muestra el rol.
export function autorDe(a: Pick<Actividad, "actor_type" | "actor_id" | "actor_name">, n: NombresHistorial): string {
  if (!a.actor_id) return "Sistema"
  if (a.actor_name) return a.actor_name
  if (a.actor_type === "platform_admin") return n.administradores.get(a.actor_id) ?? "Administrador"
  return "Usuario dado de baja"
}

// ---- Que -------------------------------------------------------------
const ENTIDAD: Record<string, string> = {
  product: "el producto",
  tax: "el impuesto",
  inventory_location: "la ubicación",
  cash_register: "la caja",
  product_category: "la categoría",
  promotion: "la promoción",
  club: "el club",
  user: "a",
}

const VERBO: Record<string, string> = {
  created: "Creó",
  updated: "Editó",
  activated: "Habilitó",
  deactivated: "Inhabilitó",
}

const ROL: Record<string, string> = { cashier: "Cajero/a", bartender: "Barra", club_admin: "Encargado/a" }
const TIPO_IMPUESTO: Record<string, string> = { percentage: "Porcentaje", fixed_amount: "Monto fijo por unidad" }
const TIPO_UBICACION: Record<string, string> = { bar: "Barra", storage: "Depósito" }

type Campo = { etiqueta: string; valor?: (v: unknown, n: NombresHistorial) => string }

const dinero = (v: unknown) => formatearMonto(v as Monto)
const nombreDe = (mapa: (n: NombresHistorial) => Map<string, string>, otro: string) => (v: unknown, n: NombresHistorial) =>
  mapa(n).get(String(v)) ?? otro

// Columnas que el panel edita. Las que no estan se muestran con su nombre.
const CAMPOS: Record<string, Campo> = {
  name: { etiqueta: "Nombre" },
  full_name: { etiqueta: "Nombre" },
  sku: { etiqueta: "SKU" },
  units_per_box: { etiqueta: "Unidades por caja" },
  price: { etiqueta: "Precio", valor: dinero },
  cost: { etiqueta: "Costo", valor: dinero },
  category_id: { etiqueta: "Categoría", valor: nombreDe((n) => n.categorias, "otra categoría") },
  image_url: { etiqueta: "Foto", valor: () => "foto" },
  active: { etiqueta: "Estado", valor: (v) => (v ? "habilitado" : "inhabilitado") },
  percentage: { etiqueta: "Porcentaje", valor: (v) => formatearPorcentaje(v as Monto) },
  fixed_amount: { etiqueta: "Monto fijo", valor: dinero },
  kind: { etiqueta: "Tipo", valor: (v) => TIPO_IMPUESTO[String(v)] ?? TIPO_UBICACION[String(v)] ?? String(v) },
  inventory_location_id: { etiqueta: "Ubicación", valor: nombreDe((n) => n.ubicaciones, "otra ubicación") },
  sort_order: { etiqueta: "Orden" },
  starts_on: { etiqueta: "Desde", valor: (v) => fechaCorta(String(v)) },
  ends_on: { etiqueta: "Hasta", valor: (v) => fechaCorta(String(v)) },
  weekdays: { etiqueta: "Días", valor: (v) => describirDias(Number(v)) },
  start_time: { etiqueta: "Hora de inicio", valor: (v) => String(v).slice(0, 5) },
  end_time: { etiqueta: "Hora de fin", valor: (v) => String(v).slice(0, 5) },
  slug: { etiqueta: "Slug" },
  timezone: { etiqueta: "Zona horaria" },
  business_day_start_hour: { etiqueta: "Inicio de la jornada", valor: (v) => `${v} h` },
  role: { etiqueta: "Rol", valor: (v) => ROL[String(v)] ?? String(v) },
  deleted_at: { etiqueta: "Baja", valor: () => "dado de baja" },
}

// Columnas que no dicen nada a una persona (las cambia la base sola).
const OCULTOS = new Set(["updated_at", "category", "club_id", "id", "created_at"])

// "2026-11-14" -> "14/11/2026"
export function fechaCorta(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-")
  return d && m && a ? `${d}/${m}/${a}` : iso
}

function texto(v: unknown, campo: Campo | undefined, n: NombresHistorial): string {
  if (v === null || v === undefined || v === "") return "vacío"
  return campo?.valor ? campo.valor(v, n) : String(v)
}

// {price: {from: 5000, to: 5500}} -> ["Precio: $5.000,00 → $5.500,00"]
export function describirCambios(details: Record<string, unknown> | null, n: NombresHistorial): string[] {
  if (!details) return []
  const lineas: string[] = []
  for (const [clave, valor] of Object.entries(details)) {
    if (OCULTOS.has(clave) || !valor || typeof valor !== "object" || !("to" in valor)) continue
    const { from, to } = valor as { from: unknown; to: unknown }
    const campo = CAMPOS[clave]
    const etiqueta = campo?.etiqueta ?? clave
    if (clave === "image_url") {
      lineas.push(!from ? "Foto: agregó una" : !to ? "Foto: la quitó" : "Foto: la cambió")
    } else if (clave === "deleted_at") {
      lineas.push(to ? "Lo dio de baja" : "Lo recuperó")
    } else {
      lineas.push(`${etiqueta}: ${texto(from, campo, n)} → ${texto(to, campo, n)}`)
    }
  }
  return lineas
}

function cantidad(q: number): string {
  return `${q} ${Math.abs(q) === 1 ? "unidad" : "unidades"}`
}

function citar(nombre: string | null, porDefecto: string): string {
  return nombre ? `«${nombre}»` : porDefecto
}

export function describirActividad(a: Actividad, n: NombresHistorial): Descripcion {
  const d = a.details ?? {}
  const nombre = citar(a.entity_name, "(sin nombre)")
  const ubicacion = (id: unknown) => n.ubicaciones.get(String(id)) ?? "otra ubicación"
  const nota = typeof d.note === "string" && d.note.trim() ? [`Nota: ${d.note.trim()}`] : []
  const [grupo, accion] = a.action.split(".", 2) as [string, string | undefined]

  switch (a.action) {
    case "night.started":
      return { titulo: "Inició la noche", detalles: [] }
    case "night.ended":
      return { titulo: "Paró la noche", detalles: [] }

    case "tax.method_added":
    case "tax.method_removed": {
      const metodo = n.metodos.get(String(d.method)) ?? String(d.method ?? "")
      return a.action === "tax.method_added"
        ? { titulo: `Sumó ${metodo} al impuesto ${nombre}`, detalles: [] }
        : { titulo: `Quitó ${metodo} del impuesto ${nombre}`, detalles: [] }
    }

    case "product_price.bar_set":
      return {
        titulo: `Puso precio de barra a ${nombre}`,
        detalles: [`${ubicacion(d.location_id)}: ${dinero(d.new_price)}`],
      }
    case "product_price.bar_changed":
      return {
        titulo: `Cambió el precio de barra de ${nombre}`,
        detalles: [`${ubicacion(d.location_id)}: ${dinero(d.old_price)} → ${dinero(d.new_price)}`],
      }
    case "product_price.bar_removed":
      return {
        titulo: `Quitó el precio de barra de ${nombre}`,
        detalles: [`${ubicacion(d.location_id)}: vuelve al precio general (antes ${dinero(d.old_price)})`],
      }

    case "combo.item_added":
    case "combo.item_changed":
    case "combo.item_removed": {
      const producto = citar(n.productos.get(String(d.product_id)) ?? null, "un producto")
      const linea = (q: unknown, p: unknown) => `${q} × ${dinero(p)}`
      if (a.action === "combo.item_added")
        return { titulo: `Sumó ${producto} al combo ${nombre}`, detalles: [linea(d.new_quantity, d.new_unit_price)] }
      if (a.action === "combo.item_removed")
        return { titulo: `Quitó ${producto} del combo ${nombre}`, detalles: [] }
      return {
        titulo: `Cambió ${producto} en el combo ${nombre}`,
        detalles: [`${linea(d.old_quantity, d.old_unit_price)} → ${linea(d.new_quantity, d.new_unit_price)}`],
      }
    }

    case "promotion.bar_added":
      return { titulo: `Sumó ${ubicacion(d.location_id)} a la promoción ${nombre}`, detalles: [] }
    case "promotion.bar_removed":
      return { titulo: `Quitó ${ubicacion(d.location_id)} de la promoción ${nombre}`, detalles: [] }

    case "staff_assignment.assigned":
    case "staff_assignment.changed": {
      const destino = d.cash_register_id
        ? `la caja ${n.cajas.get(String(d.cash_register_id)) ?? "(otra)"}`
        : `la barra ${ubicacion(d.location_id)}`
      return { titulo: `Asignó a ${nombre} a ${destino}`, detalles: [] }
    }
    case "staff_assignment.removed":
      return { titulo: `Quitó la asignación de ${nombre}`, detalles: [] }

    case "user.created":
      return {
        titulo: `Dio de alta a ${nombre}`,
        detalles: typeof d.role === "string" ? [`Rol: ${ROL[d.role] ?? d.role}`] : [],
      }
    case "user.updated":
      return { titulo: `Editó a ${nombre}`, detalles: describirCambios(d, n) }
    case "club_settings.updated": {
      const p = d.palette as { from?: unknown; to?: unknown } | undefined
      return {
        titulo: "Cambió la paleta de colores",
        detalles: p ? [`Paleta: ${nombrePaleta(p.from)} → ${nombrePaleta(p.to)}`] : [],
      }
    }
    case "user.pin_reset":
      return { titulo: `Cambió el PIN de ${nombre}`, detalles: [] }
  }

  if (grupo === "stock") {
    const q = Number(d.quantity ?? 0)
    const donde = ubicacion(d.location_id)
    const titulos: Record<string, string> = {
      initial: `Cargó stock inicial de ${nombre}`,
      purchase: `Registró una compra de ${nombre}`,
      adjustment: `Corrigió el stock de ${nombre}`,
      transfer_in: `Pasó ${nombre} a ${donde}`,
      transfer_out: `Sacó ${nombre} de ${donde}`,
    }
    const detalle =
      accion === "adjustment"
        ? `${q > 0 ? "+" : ""}${cantidad(q)} en ${donde}`
        : accion === "transfer_in" || accion === "transfer_out"
          ? cantidad(Math.abs(q))
          : `${cantidad(q)} en ${donde}`
    return { titulo: titulos[accion ?? ""] ?? `Movió stock de ${nombre}`, detalles: [detalle, ...nota] }
  }

  if (grupo === "cash_float") {
    const titulos: Record<string, string> = {
      opening: `Cargó el cambio inicial de ${nombre}`,
      top_up: `Agregó cambio a ${nombre}`,
      correction: `Corrigió el cambio de ${nombre}`,
    }
    return { titulo: titulos[accion ?? ""] ?? `Cambio en efectivo de ${nombre}`, detalles: [dinero(d.amount), ...nota] }
  }

  // Catalogo comun: .created / .updated / .activated / .deactivated
  const entidad = ENTIDAD[a.entity_type ?? ""] ?? "el registro"
  const verbo = VERBO[accion ?? ""]
  if (verbo) {
    return {
      titulo: `${verbo} ${entidad} ${nombre}`,
      detalles: accion === "updated" ? describirCambios(d, n) : [],
    }
  }
  return { titulo: `${a.action} ${nombre}`, detalles: [] }
}

// ---- Cuando ----------------------------------------------------------
// Fecha "AAAA-MM-DD" de hoy en la zona horaria del club.
export function hoyEn(zona: string, ahora: Date = new Date()): string {
  const formato = (z: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: z, year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora)
  try {
    return formato(zona)
  } catch {
    return formato("UTC")
  }
}

// Hora "22:05" en la zona horaria del club (no la del navegador).
export function horaEn(iso: string, zona: string): string {
  const formato = (z: string) =>
    new Intl.DateTimeFormat("es-AR", { timeZone: z, hour: "2-digit", minute: "2-digit", hour12: false }).format(
      new Date(iso),
    )
  try {
    return formato(zona)
  } catch {
    return formato("UTC")
  }
}

// Suma dias a "AAAA-MM-DD" (sin zonas: es una fecha de calendario).
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

const DIA_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]

// "viernes 14/11/2026"
export function fechaLarga(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00Z`)
  return `${DIA_SEMANA[d.getUTCDay()]} ${fechaCorta(fecha)}`
}

// ---- Calendario de actividad del mes ---------------------------------
// Como la grilla de GitHub, pero solo el mes en curso: una fila por semana
// (lunes a domingo), un cuadro por dia, mas oscuro = mas cambios.
export type Celda = { fecha: string; dia: number; cambios: number; nivel: 0 | 1 | 2 | 3 | 4; futuro: boolean }
export type Mes = {
  desde: string // primer dia del mes
  hasta: string // ultimo dia del mes
  nombre: string // "noviembre de 2026"
  // Filas de 7 (lunes a domingo); null = dia de otro mes.
  semanas: (Celda | null)[][]
  total: number
}

export const DIAS_SEMANA_CORTOS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
const MES_LARGO = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

// Nivel de color: 0 sin cambios; 1 a 4 segun la proporcion con el dia de
// mas cambios del mes.
export function nivelDe(cambios: number, maximo: number): Celda["nivel"] {
  if (cambios <= 0 || maximo <= 0) return 0
  return Math.min(4, Math.max(1, Math.ceil((cambios / maximo) * 4))) as Celda["nivel"]
}

export function armarMes(hoy: string, conteos: Map<string, number>): Mes {
  const desde = `${hoy.slice(0, 7)}-01`
  const hasta = sumarDias(sumarDias(desde, 32).slice(0, 7) + "-01", -1)
  let maximo = 0
  let total = 0
  for (const [fecha, c] of conteos) {
    if (fecha < desde || fecha > hasta) continue
    maximo = Math.max(maximo, c)
    total += c
  }
  // Lunes = 0 ... domingo = 6
  const corrimiento = (new Date(`${desde}T00:00:00Z`).getUTCDay() + 6) % 7
  const celdas: (Celda | null)[] = Array.from({ length: corrimiento }, () => null)
  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) {
    const cambios = conteos.get(f) ?? 0
    celdas.push({ fecha: f, dia: Number(f.slice(8)), cambios, nivel: nivelDe(cambios, maximo), futuro: f > hoy })
  }
  while (celdas.length % 7 !== 0) celdas.push(null)
  const semanas: (Celda | null)[][] = []
  for (let i = 0; i < celdas.length; i += 7) semanas.push(celdas.slice(i, i + 7))
  const nombre = `${MES_LARGO[Number(hoy.slice(5, 7)) - 1]} de ${hoy.slice(0, 4)}`
  return { desde, hasta, nombre, semanas, total }
}

export function textoCelda(c: Celda): string {
  const que = c.cambios === 0 ? "Sin cambios" : `${c.cambios} ${c.cambios === 1 ? "cambio" : "cambios"}`
  return `${que} el ${fechaLarga(c.fecha)}`
}

// Agrupa por dia (lo mas nuevo primero, como llega de la base).
export function agruparPorDia(filas: Actividad[]): { fecha: string; filas: Actividad[] }[] {
  const grupos: { fecha: string; filas: Actividad[] }[] = []
  for (const f of filas) {
    const ultimo = grupos.at(-1)
    if (ultimo && ultimo.fecha === f.local_date) ultimo.filas.push(f)
    else grupos.push({ fecha: f.local_date, filas: [f] })
  }
  return grupos
}
