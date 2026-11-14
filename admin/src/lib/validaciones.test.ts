import { describe, expect, it } from "vitest"
import { slugDesdeNombre, validarClub, validarProducto } from "./validaciones"

describe("slugDesdeNombre", () => {
  it("quita tildes, pasa a minusculas y une con guiones", () => {
    expect(slugDesdeNombre("Club Centro Ñandú")).toBe("club-centro-nandu")
  })

  it("no deja guiones al principio, al final ni repetidos", () => {
    expect(slugDesdeNombre("  ¡La  Rosa!  ")).toBe("la-rosa")
  })
})

describe("validarClub", () => {
  const valido = {
    name: " Club Centro ",
    slug: "club-centro",
    timezone: "America/Argentina/Buenos_Aires",
    businessDayStartHour: 12,
  }

  it("acepta datos validos y recorta espacios", () => {
    const r = validarClub(valido)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.valor.name).toBe("Club Centro")
  })

  it("exige nombre", () => {
    const r = validarClub({ ...valido, name: "   " })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errores.name).toBeDefined()
  })

  it.each(["Club-Centro", "club centro", "-club", "club--centro", ""])(
    "rechaza el slug %j (mismo formato que el CHECK de la base)",
    (slug) => {
      const r = validarClub({ ...valido, slug })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errores.slug).toBeDefined()
    },
  )

  it.each([-1, 24, 3.5, Number.NaN])("rechaza la hora de jornada %p", (hora) => {
    const r = validarClub({ ...valido, businessDayStartHour: hora })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errores.businessDayStartHour).toBeDefined()
  })

  it.each([0, 23])("acepta la hora limite %p", (hora) => {
    expect(validarClub({ ...valido, businessDayStartHour: hora }).ok).toBe(true)
  })
})

describe("validarProducto", () => {
  const valido = { name: "Corona", sku: "", categoryId: "", cost: "", price: "5000" }

  it("acepta un producto minimo: sku y categoria vacios pasan a null, costo vacio a 0", () => {
    const r = validarProducto(valido)
    expect(r).toEqual({
      ok: true,
      valor: { name: "Corona", sku: null, category_id: null, cost: "0", price: "5000" },
    })
  })

  it("mantiene el dinero como texto, sin pasar por float", () => {
    const r = validarProducto({ ...valido, price: "5000.10", cost: "1200.5" })
    expect(r.ok && r.valor.price).toBe("5000.10")
    expect(r.ok && r.valor.cost).toBe("1200.5")
  })

  it.each(["", "-5", "5,50", "5.555", "abc"])("rechaza el precio %j", (price) => {
    const r = validarProducto({ ...valido, price })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errores.price).toBeDefined()
  })

  it("rechaza costo negativo", () => {
    const r = validarProducto({ ...valido, cost: "-1" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errores.cost).toBeDefined()
  })

  it("exige nombre", () => {
    const r = validarProducto({ ...valido, name: " " })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errores.name).toBeDefined()
  })
})
