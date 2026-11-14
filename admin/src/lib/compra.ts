// Compra y reposicion del deposito: cajas -> unidades y control del costo
// contra la factura. Todo en centavos (BigInt), nunca con float (regla 6).
// El libro de stock guarda UNIDADES (regla 10): las cajas son una ayuda
// para no calcular a mano (2 cajas x 6 = 12).
import { aCentavos, deCentavos, porcentaje } from "./combos"
import type { Monto } from "./formato"

export type ModoCompra = "cajas" | "unidades"

const ENTERO_POSITIVO = /^\d+$/
const MONTO = /^\d+([.,]\d{1,2})?$/

// Unidades que entran, o null si la cantidad no es un entero mayor a 0.
export function unidadesDeCompra(modo: ModoCompra, cantidad: string, porCaja: number | null): number | null {
  const texto = cantidad.trim()
  if (!ENTERO_POSITIVO.test(texto) || Number(texto) <= 0) return null
  const n = Number(texto)
  return modo === "cajas" && porCaja ? n * porCaja : n
}

// Nota que queda en el libro: "2 cajas x 6" (y la del usuario, si hay).
export function notaDeCompra(modo: ModoCompra, cantidad: string, porCaja: number | null, nota: string): string {
  const propia = nota.trim()
  if (modo !== "cajas" || !porCaja) return propia
  const n = Number(cantidad.trim())
  const cajas = `${n} ${n === 1 ? "caja" : "cajas"} x ${porCaja}`
  return propia ? `${cajas} · ${propia}` : cajas
}

export type ControlCosto = {
  costoUnidad: string // costo actual del producto
  costoCaja: string | null
  totalSegunCosto: string // costo x unidades
  // Con el total de la factura:
  costoUnidadFactura: string | null // total / unidades, redondeado al centavo
  diferenciaUnidad: string | null // factura - actual (por unidad)
  variacion: string | null // "12,5 %"
  sentido: "subio" | "bajo" | "igual" | null
  facturaInvalida: boolean
}

export function controlarCosto(
  costo: Monto,
  unidades: number | null,
  porCaja: number | null,
  totalFactura: string,
): ControlCosto {
  const unidad = aCentavos(costo)
  const cant = BigInt(unidades ?? 0)
  const base: ControlCosto = {
    costoUnidad: deCentavos(unidad),
    costoCaja: porCaja ? deCentavos(unidad * BigInt(porCaja)) : null,
    totalSegunCosto: deCentavos(unidad * cant),
    costoUnidadFactura: null,
    diferenciaUnidad: null,
    variacion: null,
    sentido: null,
    facturaInvalida: false,
  }
  const texto = totalFactura.trim()
  if (!texto) return base
  if (!MONTO.test(texto)) return { ...base, facturaInvalida: true }
  if (cant <= 0n) return base
  const total = aCentavos(texto.replace(",", "."))
  const porUnidad = (total * 2n + cant) / (cant * 2n) // redondeo al centavo
  const diferencia = porUnidad - unidad
  return {
    ...base,
    costoUnidadFactura: deCentavos(porUnidad),
    diferenciaUnidad: deCentavos(diferencia),
    variacion: unidad === 0n ? null : porcentaje(diferencia, unidad),
    sentido: diferencia > 0n ? "subio" : diferencia < 0n ? "bajo" : "igual",
  }
}

// Unidades por caja del formulario de producto: vacio o sin caja = null.
export function validarPorCaja(vienePorCaja: boolean, texto: string): { ok: true; valor: number | null } | { ok: false; error: string } {
  if (!vienePorCaja) return { ok: true, valor: null }
  const t = texto.trim()
  if (!ENTERO_POSITIVO.test(t) || Number(t) < 2 || Number(t) > 1000) {
    return { ok: false, error: "Ingresá cuántas unidades trae cada caja (de 2 a 1000)." }
  }
  return { ok: true, valor: Number(t) }
}
