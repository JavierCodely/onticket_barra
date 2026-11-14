import { describe, expect, it } from "vitest"
import { describirImpuesto, formatearMonto, formatearPorcentaje, sumarMontos, valorEditable } from "./formato"

// Supabase (PostgREST) devuelve las columnas numeric como NUMERO en el JSON
// (1500, 1500.5), no como texto. Todo lo que formatea dinero tiene que
// aceptar las dos formas.
describe("dinero tal como llega de Supabase (numero)", () => {
  it("formatearMonto acepta numero y texto", () => {
    expect(formatearMonto(1500)).toBe("$1.500,00")
    expect(formatearMonto(1500.5)).toBe("$1.500,50")
    expect(formatearMonto(0)).toBe("$0,00")
    expect(formatearMonto(-1000.25)).toBe("-$1.000,25")
    expect(formatearMonto("5000.00")).toBe("$5.000,00")
    expect(formatearMonto(null)).toBe("$0,00")
  })

  it("sumarMontos con numeros no pierde centavos", () => {
    expect(sumarMontos([0.1, 0.2])).toBe("0.30")
    expect(sumarMontos([10000, "5000.00", -1000.5])).toBe("13999.50")
  })

  it("impuestos: porcentaje y monto fijo como numero", () => {
    expect(formatearPorcentaje(3)).toBe("3 %")
    expect(formatearPorcentaje(1.25)).toBe("1,25 %")
    expect(describirImpuesto({ kind: "percentage", percentage: 3, fixed_amount: null })).toBe("3 %")
    expect(describirImpuesto({ kind: "fixed", percentage: null, fixed_amount: 50 })).toBe("$50,00 por unidad")
    expect(valorEditable(3)).toBe("3")
    expect(valorEditable(1.5)).toBe("1.5")
    expect(valorEditable("3.0000")).toBe("3")
  })
})
