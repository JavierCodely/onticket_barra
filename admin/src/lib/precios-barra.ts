// Precio de un producto por barra (archivo 16). Sin precio de barra, la
// barra cobra el general. El formulario muestra una casilla por barra:
// vacia = precio general. De ahi sale que filas agregar, cambiar o borrar.
import { sumarMontos, type Monto } from "./formato"

export type PrecioBarra = {
  id: string
  product_id: string
  location_id: string
  price: Monto
}

export type PlanPreciosBarra = {
  insertar: { location_id: string; price: string }[]
  actualizar: { id: string; price: string }[]
  borrar: string[]
}

type Resultado = { ok: true; valor: PlanPreciosBarra } | { ok: false; errores: Record<string, string> }

const REGEX_MONTO = /^\d+(\.\d{1,2})?$/
const MAXIMO = 9_999_999_999.99

// Mismo monto aunque llegue como numero (7000) o texto ("7000.00").
export function mismoMonto(a: Monto, b: Monto): boolean {
  return sumarMontos([a]) === sumarMontos([b])
}

// deseados: id de la barra -> texto de la casilla ("" = precio general).
export function planificarPreciosBarra(
  productoId: string,
  actuales: PrecioBarra[],
  deseados: Record<string, string>,
): Resultado {
  const plan: PlanPreciosBarra = { insertar: [], actualizar: [], borrar: [] }
  const errores: Record<string, string> = {}
  for (const [barraId, texto] of Object.entries(deseados)) {
    const valor = texto.trim().replace(",", ".")
    const actual = actuales.find((p) => p.product_id === productoId && p.location_id === barraId)
    if (valor === "") {
      if (actual) plan.borrar.push(actual.id)
      continue
    }
    if (!REGEX_MONTO.test(valor) || Number(valor) > MAXIMO) {
      errores[barraId] = "Precio inválido (ej: 7000 o 7000.50)."
      continue
    }
    if (!actual) plan.insertar.push({ location_id: barraId, price: valor })
    else if (!mismoMonto(actual.price, valor)) plan.actualizar.push({ id: actual.id, price: valor })
  }
  return Object.keys(errores).length > 0 ? { ok: false, errores } : { ok: true, valor: plan }
}

export function planVacio(plan: PlanPreciosBarra): boolean {
  return plan.insertar.length + plan.actualizar.length + plan.borrar.length === 0
}
