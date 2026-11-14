// Promociones (archivo 18): textos, validacion del formulario y ejemplo
// del descuento. Todo en centavos (BigInt), nunca con float (regla 6).
// El descuento que vale es el que guarda el posnet en cada venta; aca solo
// se muestra un ejemplo mientras se arma la promocion.
import { aCentavos, deCentavos } from "./combos"
import { formatearMonto, formatearPorcentaje, valorEditable, type Monto } from "./formato"

export type TipoPromocion = "percentage" | "fixed_amount" | "nxm"

export const TIPOS_PROMOCION: { value: TipoPromocion; label: string }[] = [
  { value: "percentage", label: "Porcentaje" },
  { value: "fixed_amount", label: "Monto fijo por unidad" },
  { value: "nxm", label: "Llevá N, pagá M (2x1, 3x2)" },
]

// Bits de weekdays: lunes = 1 ... domingo = 64 (dia de la JORNADA).
export const DIAS: { bit: number; corto: string; largo: string }[] = [
  { bit: 1, corto: "Lun", largo: "Lunes" },
  { bit: 2, corto: "Mar", largo: "Martes" },
  { bit: 4, corto: "Mié", largo: "Miércoles" },
  { bit: 8, corto: "Jue", largo: "Jueves" },
  { bit: 16, corto: "Vie", largo: "Viernes" },
  { bit: 32, corto: "Sáb", largo: "Sábado" },
  { bit: 64, corto: "Dom", largo: "Domingo" },
]
export const TODOS_LOS_DIAS = 127

export type CondicionesPromocion = {
  kind: TipoPromocion
  percentage: Monto | null
  fixed_amount: Monto | null
  buy_quantity: number | null
  pay_quantity: number | null
}

export type VigenciaPromocion = {
  starts_on: string | null
  ends_on: string | null
  weekdays: number
  start_time: string | null
  end_time: string | null
}

// "20 %", "$1.000,00 menos por unidad", "2x1"
export function describirDescuento(p: CondicionesPromocion): string {
  if (p.kind === "percentage") return `${formatearPorcentaje(p.percentage ?? "0")} de descuento`
  if (p.kind === "fixed_amount") return `${formatearMonto(p.fixed_amount ?? "0")} menos por unidad`
  return `${p.buy_quantity}x${p.pay_quantity} (llevá ${p.buy_quantity}, pagá ${p.pay_quantity})`
}

const hhmm = (t: string) => t.slice(0, 5)
const fecha = (d: string) => {
  const [a, m, dia] = d.split("-")
  return `${dia}/${m}/${a}`
}

export function describirDias(weekdays: number): string {
  if (weekdays === TODOS_LOS_DIAS) return "Todos los días"
  return DIAS.filter((d) => (weekdays & d.bit) !== 0)
    .map((d) => d.corto)
    .join(", ")
}

// "Vie, Sáb · 00:00 a 01:30 · desde 01/12/2026 hasta 31/12/2026"
export function describirVigencia(v: VigenciaPromocion): string {
  const partes = [describirDias(v.weekdays)]
  if (v.start_time && v.end_time) partes.push(`${hhmm(v.start_time)} a ${hhmm(v.end_time)}`)
  if (v.starts_on && v.ends_on) partes.push(`del ${fecha(v.starts_on)} al ${fecha(v.ends_on)}`)
  else if (v.starts_on) partes.push(`desde el ${fecha(v.starts_on)}`)
  else if (v.ends_on) partes.push(`hasta el ${fecha(v.ends_on)}`)
  return partes.join(" · ")
}

// Descuento de una linea (la misma formula que v_sale_promotion_issues).
export function descuentoLinea(p: CondicionesPromocion, precioUnitario: Monto, cantidad: number): bigint {
  const precio = aCentavos(precioUnitario)
  const q = BigInt(cantidad)
  if (p.kind === "percentage") {
    // ROUND(q * precio * pct / 100, 2), mitad hacia arriba (como Postgres)
    const pctCentesimas = aCentavos(p.percentage ?? "0") // 20 % -> 2000
    const num = q * precio * pctCentesimas
    return (num + 5000n) / 10000n
  }
  if (p.kind === "fixed_amount") {
    const fijo = aCentavos(p.fixed_amount ?? "0")
    return q * (fijo < precio ? fijo : precio)
  }
  const n = BigInt(p.buy_quantity ?? 1)
  const m = BigInt(p.pay_quantity ?? 1)
  return (q / n) * (n - m) * precio
}

// Ejemplo para el formulario: "Llevando 2: $12.000,00 → $6.000,00"
export function ejemploDescuento(p: CondicionesPromocion, precioUnitario: Monto): {
  cantidad: number
  normal: string
  conPromo: string
  descuento: string
} {
  const cantidad = p.kind === "nxm" ? (p.buy_quantity ?? 1) : 1
  const normal = aCentavos(precioUnitario) * BigInt(cantidad)
  const descuento = descuentoLinea(p, precioUnitario, cantidad)
  return { cantidad, normal: deCentavos(normal), conPromo: deCentavos(normal - descuento), descuento: deCentavos(descuento) }
}

// ---------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------
export type FormPromocion = {
  productId: string
  name: string
  kind: TipoPromocion
  percentage: string
  fixedAmount: string
  buyQuantity: string
  payQuantity: string
  startsOn: string
  endsOn: string
  weekdays: number
  conHorario: boolean
  startTime: string
  endTime: string
  barras: string[] // ids de barra; vacio = todas
}

export type ErroresPromocion = Partial<
  Record<"productId" | "name" | "valor" | "cantidades" | "fechas" | "dias" | "horario", string>
>

export type ValorPromocion = CondicionesPromocion &
  VigenciaPromocion & { product_id: string; name: string; barras: string[] }

const REGEX_MONTO = /^\d+([.,]\d{1,2})?$/
const REGEX_ENTERO = /^\d{1,3}$/

export function formVacio(): FormPromocion {
  return {
    productId: "",
    name: "",
    kind: "percentage",
    percentage: "",
    fixedAmount: "",
    buyQuantity: "2",
    payQuantity: "1",
    startsOn: "",
    endsOn: "",
    weekdays: TODOS_LOS_DIAS,
    conHorario: false,
    startTime: "",
    endTime: "",
    barras: [],
  }
}

export function formDesde(p: ValorPromocion): FormPromocion {
  return {
    productId: p.product_id,
    name: p.name,
    kind: p.kind,
    percentage: p.percentage === null ? "" : valorEditable(p.percentage),
    fixedAmount: p.fixed_amount === null ? "" : valorEditable(p.fixed_amount),
    buyQuantity: p.buy_quantity === null ? "2" : String(p.buy_quantity),
    payQuantity: p.pay_quantity === null ? "1" : String(p.pay_quantity),
    startsOn: p.starts_on ?? "",
    endsOn: p.ends_on ?? "",
    weekdays: p.weekdays,
    conHorario: p.start_time !== null,
    startTime: p.start_time ? hhmm(p.start_time) : "",
    endTime: p.end_time ? hhmm(p.end_time) : "",
    barras: p.barras,
  }
}

// Las mismas reglas que los CHECK de 18_promociones.sql, como ayuda.
export function validarPromocion(
  f: FormPromocion,
): { ok: true; valor: ValorPromocion } | { ok: false; errores: ErroresPromocion } {
  const errores: ErroresPromocion = {}
  const name = f.name.trim()
  if (!f.productId) errores.productId = "Elegí un producto."
  if (!name) errores.name = "Escribí un nombre."
  else if (name.length > 80) errores.name = "Hasta 80 caracteres."

  let percentage: string | null = null
  let fixed_amount: string | null = null
  let buy_quantity: number | null = null
  let pay_quantity: number | null = null
  if (f.kind === "percentage") {
    const t = f.percentage.trim().replace(",", ".")
    const c = REGEX_MONTO.test(t) ? aCentavos(t) : -1n
    if (c <= 0n || c > 10000n) errores.valor = "El porcentaje va de 0,01 a 100."
    else percentage = deCentavos(c)
  } else if (f.kind === "fixed_amount") {
    const t = f.fixedAmount.trim().replace(",", ".")
    const c = REGEX_MONTO.test(t) ? aCentavos(t) : 0n
    if (c <= 0n || c > 999_999_999_999n) errores.valor = "Escribí un monto mayor que 0."
    else fixed_amount = deCentavos(c)
  } else {
    const n = REGEX_ENTERO.test(f.buyQuantity.trim()) ? Number(f.buyQuantity.trim()) : 0
    const m = REGEX_ENTERO.test(f.payQuantity.trim()) ? Number(f.payQuantity.trim()) : 0
    if (n < 2 || n > 100 || m < 1 || m >= n) errores.cantidades = "Lleva de 2 a 100, y paga al menos 1 y menos de lo que lleva."
    else {
      buy_quantity = n
      pay_quantity = m
    }
  }

  if (f.startsOn && f.endsOn && f.startsOn > f.endsOn) errores.fechas = "La fecha de fin no puede ser anterior a la de inicio."
  if (f.weekdays < 1 || f.weekdays > TODOS_LOS_DIAS) errores.dias = "Elegí al menos un día."
  if (f.conHorario) {
    if (!f.startTime || !f.endTime) errores.horario = "Completá la hora de inicio y la de fin."
    else if (f.startTime === f.endTime) errores.horario = "La hora de inicio y la de fin no pueden ser iguales."
  }

  if (Object.keys(errores).length > 0) return { ok: false, errores }
  return {
    ok: true,
    valor: {
      product_id: f.productId,
      name,
      kind: f.kind,
      percentage,
      fixed_amount,
      buy_quantity,
      pay_quantity,
      starts_on: f.startsOn || null,
      ends_on: f.endsOn || null,
      weekdays: f.weekdays,
      start_time: f.conHorario ? f.startTime : null,
      end_time: f.conHorario ? f.endTime : null,
      barras: f.barras,
    },
  }
}

// La franja cruza la medianoche si termina antes de empezar.
export function cruzaMedianoche(inicio: string, fin: string): boolean {
  return Boolean(inicio && fin && fin < inicio)
}
