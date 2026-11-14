import { describe, expect, it } from "vitest"
import { describirImpuesto, formatearPorcentaje, sumarMontos, valorEditable } from "./formato"
import { diaSiguiente } from "./datos"
import {
  esPinTrivial,
  validarCambio,
  validarCargaBarra,
  validarImpuesto,
  validarMovimiento,
  validarPersonal,
} from "./validaciones"

describe("validarImpuesto", () => {
  const base = { name: "Comisión tarjeta", kind: "percentage" as const, valor: "3", metodos: ["card"] }

  it("porcentaje: guarda percentage y deja fixed_amount en null", () => {
    expect(validarImpuesto(base)).toEqual({
      ok: true,
      valor: { name: "Comisión tarjeta", kind: "percentage", percentage: "3", fixed_amount: null, metodos: ["card"] },
    })
  })

  it("monto fijo: guarda fixed_amount y deja percentage en null (CHECK de la base)", () => {
    const r = validarImpuesto({ ...base, kind: "fixed", valor: "50" })
    expect(r.ok && [r.valor.percentage, r.valor.fixed_amount]).toEqual([null, "50"])
  })

  it("acepta coma decimal", () => {
    const r = validarImpuesto({ ...base, valor: "1,2" })
    expect(r.ok && r.valor.percentage).toBe("1.2")
  })

  it.each(["0", "-3", "100.1", "abc", "", "3.12345"])("rechaza el porcentaje %j", (valor) => {
    const r = validarImpuesto({ ...base, valor })
    expect(!r.ok && r.errores.valor).toBeTruthy()
  })

  it("acepta el limite de 100 %", () => {
    expect(validarImpuesto({ ...base, valor: "100" }).ok).toBe(true)
  })

  it.each(["0", "-1", "5.555"])("rechaza el monto fijo %j", (valor) => {
    const r = validarImpuesto({ ...base, kind: "fixed", valor })
    expect(!r.ok && r.errores.valor).toBeTruthy()
  })

  it("exige al menos un metodo de pago", () => {
    const r = validarImpuesto({ ...base, metodos: [] })
    expect(!r.ok && r.errores.metodos).toBeTruthy()
  })

  it("no repite metodos", () => {
    const r = validarImpuesto({ ...base, metodos: ["card", "card", "transfer"] })
    expect(r.ok && r.valor.metodos).toEqual(["card", "transfer"])
  })
})

describe("validarMovimiento", () => {
  const base = { tipo: "initial" as const, productoId: "p1", ubicacionId: "l1", destinoId: "", cantidad: "10", nota: "" }

  it("stock inicial: una linea positiva", () => {
    expect(validarMovimiento(base)).toEqual({
      ok: true,
      valor: [{ product_id: "p1", note: null, location_id: "l1", movement_type: "initial", quantity: 10 }],
    })
  })

  it("compra con nota", () => {
    const r = validarMovimiento({ ...base, tipo: "purchase", nota: " Factura 12 " })
    expect(r.ok && r.valor[0]).toMatchObject({ movement_type: "purchase", quantity: 10, note: "Factura 12" })
  })

  it.each(["0", "-1", "1.5", "abc", "", "1000001"])("compra o inicial rechaza la cantidad %j", (cantidad) => {
    const r = validarMovimiento({ ...base, cantidad })
    expect(!r.ok && r.errores.cantidad).toBeTruthy()
  })

  it("ajuste negativo descuenta", () => {
    const r = validarMovimiento({ ...base, tipo: "adjustment", cantidad: "-3" })
    expect(r.ok && r.valor[0]).toMatchObject({ movement_type: "adjustment", quantity: -3 })
  })

  it("ajuste de 0 no tiene sentido", () => {
    expect(validarMovimiento({ ...base, tipo: "adjustment", cantidad: "0" }).ok).toBe(false)
  })

  it("transferencia: dos lineas que suman cero (sale de un lado, entra en el otro)", () => {
    const r = validarMovimiento({ ...base, tipo: "transfer", destinoId: "l2", cantidad: "4" })
    expect(r.ok && r.valor).toEqual([
      { product_id: "p1", note: null, location_id: "l1", movement_type: "transfer_out", quantity: -4 },
      { product_id: "p1", note: null, location_id: "l2", movement_type: "transfer_in", quantity: 4 },
    ])
  })

  it("transferencia a la misma ubicacion o sin destino", () => {
    for (const destinoId of ["l1", ""]) {
      const r = validarMovimiento({ ...base, tipo: "transfer", destinoId })
      expect(!r.ok && r.errores.destinoId).toBeTruthy()
    }
  })

  it("exige producto y ubicacion", () => {
    const r = validarMovimiento({ ...base, productoId: "", ubicacionId: "" })
    expect(!r.ok && r.errores.productoId && r.errores.ubicacionId).toBeTruthy()
  })
})

describe("validarPersonal", () => {
  const base = { fullName: "Juan", role: "cashier" as const, username: "Juan", pin: "482913", email: "", password: "" }

  it("cajero: usuario en minusculas y PIN", () => {
    expect(validarPersonal(base)).toEqual({
      ok: true,
      valor: { full_name: "Juan", role: "cashier", username: "juan", pin: "482913" },
    })
  })

  it("encargado: email y contrasena, sin PIN", () => {
    const r = validarPersonal({ ...base, role: "club_admin", email: " Enc@Club.com ", password: "clave-larga" })
    expect(r).toEqual({
      ok: true,
      valor: { full_name: "Juan", role: "club_admin", email: "enc@club.com", password: "clave-larga" },
    })
  })

  it.each(["12345", "123456", "111111", "123456789", "12a456"])("rechaza el PIN %j", (pin) => {
    const r = validarPersonal({ ...base, pin })
    expect(!r.ok && r.errores.pin).toBeTruthy()
  })

  it("el PIN trivial se detecta igual que en la Edge Function", () => {
    expect(esPinTrivial("987654") && esPinTrivial("000000")).toBe(true)
    expect(esPinTrivial("482913")).toBe(false)
  })
})

describe("formato de impuestos", () => {
  it.each([
    ["3.0000", "3 %"],
    ["1.2500", "1,25 %"],
    ["100.0000", "100 %"],
  ])("porcentaje %s -> %s", (entrada, salida) => {
    expect(formatearPorcentaje(entrada)).toBe(salida)
  })

  it("describe un impuesto fijo por unidad", () => {
    expect(describirImpuesto({ kind: "fixed", percentage: null, fixed_amount: "50.00" })).toBe("$50,00 por unidad")
  })

  it("valor editable sin ceros de mas", () => {
    expect(valorEditable("3.0000")).toBe("3")
    expect(valorEditable("1.2500")).toBe("1.25")
    expect(valorEditable("50.00")).toBe("50")
    expect(valorEditable("100")).toBe("100")
    expect(valorEditable(null)).toBe("")
  })
})

describe("cambio en efectivo y carga de barra", () => {
  it("cambio: vacio o 0 es sin cambio; acepta coma; rechaza texto", () => {
    expect(validarCambio("")).toEqual({ ok: true, valor: "0" })
    expect(validarCambio("0")).toEqual({ ok: true, valor: "0" })
    expect(validarCambio("20000,50")).toEqual({ ok: true, valor: "20000.50" })
    expect(validarCambio("abc").ok).toBe(false)
    expect(validarCambio("-5").ok).toBe(false)
  })

  it("refuerzo de cambio: el monto es obligatorio", () => {
    expect(validarCambio("", true).ok).toBe(false)
    expect(validarCambio("5000", true)).toEqual({ ok: true, valor: "5000" })
  })

  it("en una barra se carga parte de lo que hay (50 de 100), nunca mas", () => {
    expect(validarCargaBarra("50", 100)).toEqual({ ok: true, valor: 50 })
    expect(validarCargaBarra("100", 100)).toEqual({ ok: true, valor: 100 })
    const demas = validarCargaBarra("101", 100)
    expect(!demas.ok && demas.errores).toBe("En el depósito hay 100: no se puede cargar más que eso.")
    for (const mal of ["0", "-1", "1.5", "abc", ""]) expect(validarCargaBarra(mal, 100).ok).toBe(false)
  })
})

describe("sumas de dinero y fechas", () => {
  it("suma montos en centavos, sin float", () => {
    expect(sumarMontos(["0.10", "0.20"])).toBe("0.30")
    expect(sumarMontos(["10000.00", "5000", "-1000.5"])).toBe("13999.50")
    expect(sumarMontos([])).toBe("0.00")
  })

  it("el filtro 'hasta' incluye todo el dia (pasa al dia siguiente)", () => {
    expect(diaSiguiente("2026-11-14")).toBe("2026-11-15")
    expect(diaSiguiente("2026-12-31")).toBe("2027-01-01")
  })
})
