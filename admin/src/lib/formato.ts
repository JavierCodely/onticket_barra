// Supabase (PostgREST) devuelve las columnas numeric como NUMERO en el JSON
// (1500, 1500.5); otras veces llegan como texto ("5000.00"). Un numeric(12,2)
// entra exacto en un double, y String() da su forma corta, asi que se pasa
// a texto y desde ahi se trabaja sin aritmetica de float (CLAUDE.md, regla 6).
export type Monto = string | number

export function aTexto(valor: Monto | null | undefined): string {
  if (valor === null || valor === undefined || valor === "") return "0"
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) return "0"
    // Evita la notacion exponencial (1e-7) en valores muy chicos.
    return Math.abs(valor) < 1e-6 ? "0" : String(valor)
  }
  return valor
}

export function formatearMonto(monto: Monto | null | undefined): string {
  const texto = aTexto(monto)
  const negativo = texto.startsWith("-")
  const [entero, decimales = "00"] = texto.replace("-", "").split(".")
  const conPuntos = (entero || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  return `${negativo ? "-" : ""}$${conPuntos},${decimales.padEnd(2, "0").slice(0, 2)}`
}

// Suma montos de texto en centavos (BigInt): nunca pasa por float.
export function sumarMontos(montos: (Monto | null | undefined)[]): string {
  let centavos = 0n
  for (const m of montos) {
    if (m === null || m === undefined || m === "") continue
    const texto = aTexto(m)
    const negativo = texto.startsWith("-")
    const [entero, decimales = ""] = texto.replace("-", "").split(".")
    const valor = BigInt(entero || "0") * 100n + BigInt((decimales + "00").slice(0, 2))
    centavos += negativo ? -valor : valor
  }
  const negativo = centavos < 0n
  const abs = negativo ? -centavos : centavos
  const resto = (abs % 100n).toString().padStart(2, "0")
  return `${negativo ? "-" : ""}${abs / 100n}.${resto}`
}

// Hora local "22:05" y fecha "14/11 22:05" para la lista de ventas.
export function formatearHora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })
}

export function formatearFechaHora(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })} ${formatearHora(iso)}`
}

// "3.0000" -> "3 %", "1.2500" -> "1,25 %"
export function formatearPorcentaje(valor: Monto): string {
  const [entero, decimales = ""] = aTexto(valor).split(".")
  const limpios = decimales.replace(/0+$/, "")
  return `${entero}${limpios ? `,${limpios}` : ""} %`
}

// "3 %" o "$50,00 por unidad", como pide CLAUDE.md (seccion 8).
export function describirImpuesto(impuesto: {
  kind: "percentage" | "fixed"
  percentage: Monto | null
  fixed_amount: Monto | null
}): string {
  return impuesto.kind === "percentage"
    ? formatearPorcentaje(impuesto.percentage ?? "0")
    : `${formatearMonto(impuesto.fixed_amount ?? "0")} por unidad`
}

// Valor para editar en el formulario: sin ceros de mas ("3.0000" -> "3").
export function valorEditable(valor: Monto | null): string {
  if (valor === null || valor === "") return ""
  const texto = aTexto(valor)
  return texto.includes(".") ? texto.replace(/\.?0+$/, "") : texto
}
