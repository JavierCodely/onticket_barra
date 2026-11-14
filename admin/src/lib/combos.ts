// Combos (archivo 17): cuentas del formulario. Todo en centavos (BigInt),
// nunca con float (regla 6). El precio y el costo que valen son los que
// calcula la base; esto es la vista previa mientras se arma el combo.
import { aTexto, type Monto } from "./formato"

export function aCentavos(monto: Monto): bigint {
  const texto = aTexto(monto).trim().replace(",", ".")
  const negativo = texto.startsWith("-")
  const [entero, decimales = ""] = texto.replace("-", "").split(".")
  const valor = BigInt(entero || "0") * 100n + BigInt((decimales + "00").slice(0, 2))
  return negativo ? -valor : valor
}

export function deCentavos(centavos: bigint): string {
  const negativo = centavos < 0n
  const abs = negativo ? -centavos : centavos
  return `${negativo ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`
}

// parte / total en porcentaje con un decimal ("12,5 %"); null si total = 0.
export function porcentaje(parte: bigint, total: bigint): string | null {
  if (total === 0n) return null
  const negativo = parte < 0n !== total < 0n && parte !== 0n
  const p = parte < 0n ? -parte : parte
  const t = total < 0n ? -total : total
  const decimas = (p * 1000n + t / 2n) / t // redondeo a la decima
  const texto = `${decimas / 10n}${decimas % 10n === 0n ? "" : `,${decimas % 10n}`} %`
  return negativo && decimas !== 0n ? `-${texto}` : texto
}

export type LineaCombo = {
  productId: string
  nombre: string
  cantidad: string // texto del campo
  costoUnitario: Monto // costo actual del producto
  precioNormalUnitario: Monto // precio de lista del producto
  precioEnCombo: string // texto del campo: precio individual dentro del combo
}

const REGEX_MONTO = /^\d+([.,]\d{1,2})?$/
const REGEX_CANTIDAD = /^\d{1,4}$/

function cantidadValida(texto: string): number | null {
  if (!REGEX_CANTIDAD.test(texto.trim())) return null
  const n = Number(texto.trim())
  return n >= 1 && n <= 1000 ? n : null
}

function montoValido(texto: string): boolean {
  return REGEX_MONTO.test(texto.trim()) && aCentavos(texto) <= 999_999_999_999n
}

// Totales de una linea: costo, precio normal y precio en el combo, por la
// cantidad. Un campo invalido cuenta como 0 (el formulario marca el error).
export function totalesLinea(l: LineaCombo) {
  const cantidad = BigInt(cantidadValida(l.cantidad) ?? 0)
  return {
    costo: aCentavos(l.costoUnitario) * cantidad,
    normal: aCentavos(l.precioNormalUnitario) * cantidad,
    combo: (montoValido(l.precioEnCombo) ? aCentavos(l.precioEnCombo) : 0n) * cantidad,
  }
}

export type ResumenCombo = {
  costo: string
  precioNormal: string
  precioCombo: string
  margen: string // precio del combo - costo
  margenPorcentaje: string | null // sobre el precio del combo
  descuento: string // precio normal - precio del combo
  descuentoPorcentaje: string | null // sobre el precio normal
}

export function resumirCombo(lineas: LineaCombo[]): ResumenCombo {
  let costo = 0n
  let normal = 0n
  let combo = 0n
  for (const l of lineas) {
    const t = totalesLinea(l)
    costo += t.costo
    normal += t.normal
    combo += t.combo
  }
  return {
    costo: deCentavos(costo),
    precioNormal: deCentavos(normal),
    precioCombo: deCentavos(combo),
    margen: deCentavos(combo - costo),
    margenPorcentaje: porcentaje(combo - costo, combo),
    descuento: deCentavos(normal - combo),
    descuentoPorcentaje: porcentaje(normal - combo, normal),
  }
}

export type ItemCombo = { product_id: string; quantity: number; unit_price: string }

export type DatosCombo = { nombre: string; sku: string; categoriaId: string; lineas: LineaCombo[] }
export type ValorCombo = { name: string; sku: string | null; category_id: string | null; items: ItemCombo[] }
export type ErroresCombo = {
  nombre?: string
  lineas?: string
  cantidad?: Record<string, string>
  precio?: Record<string, string>
}

export function validarCombo(d: DatosCombo): { ok: true; valor: ValorCombo } | { ok: false; errores: ErroresCombo } {
  const errores: ErroresCombo = {}
  const cantidad: Record<string, string> = {}
  const precio: Record<string, string> = {}
  const name = d.nombre.trim()
  if (!name) errores.nombre = "Ingresá el nombre del combo."
  if (d.lineas.length === 0) errores.lineas = "Agregá al menos un producto."
  const items: ItemCombo[] = []
  for (const l of d.lineas) {
    const q = cantidadValida(l.cantidad)
    if (q === null) cantidad[l.productId] = "Cantidad de 1 a 1000."
    if (!montoValido(l.precioEnCombo)) precio[l.productId] = "Precio inválido (ej: 4000 o 4000.50)."
    if (q !== null && montoValido(l.precioEnCombo)) {
      items.push({ product_id: l.productId, quantity: q, unit_price: deCentavos(aCentavos(l.precioEnCombo)) })
    }
  }
  if (Object.keys(cantidad).length > 0) errores.cantidad = cantidad
  if (Object.keys(precio).length > 0) errores.precio = precio
  if (Object.keys(errores).length > 0) return { ok: false, errores }
  return { ok: true, valor: { name, sku: d.sku.trim() || null, category_id: d.categoriaId || null, items } }
}

// Que filas de combo_items agregar, cambiar o borrar.
export type ComboItemGuardado = { id: string; product_id: string; quantity: number; unit_price: Monto }
export type PlanComboItems = {
  insertar: ItemCombo[]
  actualizar: { id: string; quantity: number; unit_price: string }[]
  borrar: string[]
}

export function planificarComboItems(actuales: ComboItemGuardado[], deseados: ItemCombo[]): PlanComboItems {
  const plan: PlanComboItems = { insertar: [], actualizar: [], borrar: [] }
  for (const a of actuales) if (!deseados.some((d) => d.product_id === a.product_id)) plan.borrar.push(a.id)
  for (const d of deseados) {
    const a = actuales.find((x) => x.product_id === d.product_id)
    if (!a) plan.insertar.push(d)
    else if (a.quantity !== d.quantity || aCentavos(a.unit_price) !== aCentavos(d.unit_price)) {
      plan.actualizar.push({ id: a.id, quantity: d.quantity, unit_price: d.unit_price })
    }
  }
  return plan
}
