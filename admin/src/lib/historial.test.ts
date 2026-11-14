import { describe, expect, it } from "vitest"
import {
  NOMBRES_VACIOS,
  agruparPorDia,
  armarMes,
  autorDe,
  describirActividad,
  describirCambios,
  fechaLarga,
  horaEn,
  hoyEn,
  nivelDe,
  sumarDias,
  textoCelda,
  type Actividad,
  type NombresHistorial,
} from "./historial"
import { validarPerfil } from "./perfil"

const NOMBRES: NombresHistorial = {
  ...NOMBRES_VACIOS,
  ubicaciones: new Map([["l1", "Barra VIP"], ["l2", "Depósito"]]),
  cajas: new Map([["r1", "Caja 1"]]),
  categorias: new Map([["c1", "Cervezas"], ["c2", "Tragos"]]),
  productos: new Map([["p2", "Fernet"]]),
  metodos: new Map([["pix", "PIX"]]),
  administradores: new Map([["a1", "Ana Perez"]]),
}

const fila = (extra: Partial<Actividad>): Actividad => ({
  id: "x",
  club_id: "club-1",
  occurred_at: "2026-11-14T02:30:00Z",
  local_date: "2026-11-13",
  actor_type: "platform_admin",
  actor_id: "a1",
  actor_name: null,
  action: "product.updated",
  entity_type: "product",
  entity_id: "p1",
  entity_name: "Corona",
  details: {},
  ...extra,
})
const titulo = (extra: Partial<Actividad>) => describirActividad(fila(extra), NOMBRES).titulo
const detalles = (extra: Partial<Actividad>) => describirActividad(fila(extra), NOMBRES).detalles

describe("historial: que se hizo", () => {
  it("cambio de precio y nombre de un producto, con el antes y el despues", () => {
    const d = describirActividad(
      fila({ details: { price: { from: 5000, to: "5500.00" }, name: { from: "Corona", to: "Corona 710" } } }),
      NOMBRES,
    )
    expect(d.titulo).toBe("Editó el producto «Corona»")
    expect(d.detalles).toEqual(["Precio: $5.000,00 → $5.500,00", "Nombre: Corona → Corona 710"])
  })

  it("traduce ids a nombres y oculta lo que cambia la base sola", () => {
    expect(
      describirCambios(
        { category_id: { from: "c1", to: null }, updated_at: { from: "a", to: "b" }, image_url: { from: null, to: "u" } },
        NOMBRES,
      ),
    ).toEqual(["Categoría: Cervezas → vacío", "Foto: agregó una"])
    expect(describirCambios({ units_per_box: { from: null, to: 6 } }, NOMBRES)).toEqual(["Unidades por caja: vacío → 6"])
  })

  it("habilitar, inhabilitar y crear", () => {
    expect(titulo({ action: "product.deactivated" })).toBe("Inhabilitó el producto «Corona»")
    expect(titulo({ action: "tax.activated", entity_type: "tax", entity_name: "IIBB" })).toBe("Habilitó el impuesto «IIBB»")
    expect(titulo({ action: "inventory_location.created", entity_type: "inventory_location", entity_name: "VIP" })).toBe(
      "Creó la ubicación «VIP»",
    )
  })

  it("precio por barra: puesto, cambiado y quitado", () => {
    expect(detalles({ action: "product_price.bar_set", details: { location_id: "l1", new_price: 6000 } })).toEqual([
      "Barra VIP: $6.000,00",
    ])
    expect(
      detalles({ action: "product_price.bar_changed", details: { location_id: "l1", old_price: 6000, new_price: 6500 } }),
    ).toEqual(["Barra VIP: $6.000,00 → $6.500,00"])
    expect(titulo({ action: "product_price.bar_removed", details: { location_id: "l1", old_price: 6500 } })).toBe(
      "Quitó el precio de barra de «Corona»",
    )
  })

  it("combos: producto agregado con cantidad y precio", () => {
    const d = describirActividad(
      fila({ action: "combo.item_added", entity_name: "Combo Fernet", details: { product_id: "p2", new_quantity: 1, new_unit_price: 9000 } }),
      NOMBRES,
    )
    expect(d).toEqual({ titulo: "Sumó «Fernet» al combo «Combo Fernet»", detalles: ["1 × $9.000,00"] })
  })

  it("stock: compra con nota, ajuste con signo y transferencia", () => {
    expect(
      describirActividad(
        fila({ action: "stock.purchase", details: { location_id: "l2", quantity: 24, note: "Proveedor" } }),
        NOMBRES,
      ),
    ).toEqual({ titulo: "Registró una compra de «Corona»", detalles: ["24 unidades en Depósito", "Nota: Proveedor"] })
    expect(detalles({ action: "stock.adjustment", details: { location_id: "l1", quantity: -1 } })).toEqual([
      "-1 unidad en Barra VIP",
    ])
    expect(titulo({ action: "stock.transfer_in", details: { location_id: "l1", quantity: 10 } })).toBe(
      "Pasó «Corona» a Barra VIP",
    )
  })

  it("noche, cambio en efectivo, impuestos, promociones y personal", () => {
    expect(titulo({ action: "night.started", entity_type: "night", entity_name: null })).toBe("Inició la noche")
    expect(
      describirActividad(
        fila({ action: "cash_float.top_up", entity_type: "cash_register", entity_name: "Caja 1", details: { amount: 20000 } }),
        NOMBRES,
      ),
    ).toEqual({ titulo: "Agregó cambio a «Caja 1»", detalles: ["$20.000,00"] })
    expect(titulo({ action: "tax.method_added", entity_name: "IIBB", details: { method: "pix" } })).toBe(
      "Sumó PIX al impuesto «IIBB»",
    )
    expect(titulo({ action: "promotion.bar_added", entity_name: "2x1", details: { location_id: "l1" } })).toBe(
      "Sumó Barra VIP a la promoción «2x1»",
    )
    expect(titulo({ action: "staff_assignment.assigned", entity_name: "Juan", details: { cash_register_id: "r1" } })).toBe(
      "Asignó a «Juan» a la caja Caja 1",
    )
    expect(detalles({ action: "user.updated", entity_name: "Juan", details: { role: { from: "cashier", to: "bartender" } } })).toEqual([
      "Rol: Cajero/a → Barra",
    ])
    expect(detalles({ action: "user.created", entity_name: "Juan", details: { role: "cashier", full_name: "Juan" } })).toEqual([
      "Rol: Cajero/a",
    ])
  })
})

describe("historial: configuracion", () => {
  it("cambio de paleta con sus nombres", () => {
    expect(
      describirActividad(
        fila({ action: "club_settings.updated", entity_type: "club", entity_name: "Club Centro",
               details: { palette: { from: "violeta", to: "ambar" } } }),
        NOMBRES,
      ),
    ).toEqual({ titulo: "Cambió la paleta de colores", detalles: ["Paleta: Violeta → Ámbar"] })
  })
})

describe("historial: quien", () => {
  it("nombre de la vista, o el del administrador (club_admin_names), o el rol", () => {
    expect(autorDe({ actor_type: "user", actor_id: "u1", actor_name: "Juan" }, NOMBRES)).toBe("Juan")
    expect(autorDe({ actor_type: "platform_admin", actor_id: "a1", actor_name: null }, NOMBRES)).toBe("Ana Perez")
    expect(autorDe({ actor_type: "platform_admin", actor_id: "a9", actor_name: null }, NOMBRES)).toBe("Administrador")
    expect(autorDe({ actor_type: null, actor_id: null, actor_name: null }, NOMBRES)).toBe("Sistema")
  })
})

describe("historial: cuando", () => {
  it("hoy y la hora en la zona horaria del club, no la del navegador", () => {
    const ahora = new Date("2026-11-15T02:30:00Z") // 23:30 del 14 en Buenos Aires
    expect(hoyEn("America/Argentina/Buenos_Aires", ahora)).toBe("2026-11-14")
    expect(hoyEn("UTC", ahora)).toBe("2026-11-15")
    expect(horaEn("2026-11-15T02:30:00Z", "America/Argentina/Buenos_Aires")).toBe("23:30")
    expect(hoyEn("Zona/Inexistente", ahora)).toBe("2026-11-15")
  })

  it("suma dias cruzando meses y anios, y nombra el dia", () => {
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01")
    expect(sumarDias("2026-03-01", -1)).toBe("2026-02-28")
    expect(fechaLarga("2026-11-14")).toBe("sábado 14/11/2026")
  })

  it("agrupa por dia respetando el orden", () => {
    const g = agruparPorDia([
      fila({ id: "1", local_date: "2026-11-14" }),
      fila({ id: "2", local_date: "2026-11-14" }),
      fila({ id: "3", local_date: "2026-11-12" }),
    ])
    expect(g.map((x) => [x.fecha, x.filas.length])).toEqual([["2026-11-14", 2], ["2026-11-12", 1]])
  })
})

describe("historial: calendario del mes", () => {
  it("solo el mes en curso, en semanas de lunes a domingo; los dias que faltan quedan marcados", () => {
    const m = armarMes("2026-11-14", new Map()) // 1/11/2026 es domingo
    expect(m.desde).toBe("2026-11-01")
    expect(m.hasta).toBe("2026-11-30")
    expect(m.nombre).toBe("noviembre de 2026")
    expect(m.semanas.every((s) => s.length === 7)).toBe(true)
    // La primera fila: lunes a sabado vacios (octubre), domingo 1
    expect(m.semanas[0].slice(0, 6)).toEqual([null, null, null, null, null, null])
    expect(m.semanas[0][6]?.fecha).toBe("2026-11-01")
    const celdas = m.semanas.flat().filter((c) => c !== null)
    expect(celdas).toHaveLength(30)
    expect(celdas.find((c) => c.fecha === "2026-11-14")?.futuro).toBe(false)
    expect(celdas.find((c) => c.fecha === "2026-11-15")?.futuro).toBe(true)
    // Febrero de anio no bisiesto y diciembre (cambio de anio)
    expect(armarMes("2027-02-10", new Map()).hasta).toBe("2027-02-28")
    expect(armarMes("2026-12-31", new Map()).hasta).toBe("2026-12-31")
    expect(armarMes("2026-12-31", new Map()).nombre).toBe("diciembre de 2026")
  })

  it("niveles segun el dia de mas cambios del mes; otros meses no cuentan", () => {
    const m = armarMes("2026-11-14", new Map([["2026-11-14", 8], ["2026-11-13", 1], ["2026-11-12", 4], ["2026-10-31", 99]]))
    const celdas = m.semanas.flat().filter((c) => c !== null)
    const de = (f: string) => celdas.find((c) => c.fecha === f)
    expect([de("2026-11-14")?.nivel, de("2026-11-13")?.nivel, de("2026-11-12")?.nivel, de("2026-11-11")?.nivel]).toEqual([
      4, 1, 2, 0,
    ])
    expect(m.total).toBe(13)
    expect(nivelDe(0, 0)).toBe(0)
    expect(textoCelda({ fecha: "2026-11-13", dia: 13, cambios: 1, nivel: 1, futuro: false })).toBe(
      "1 cambio el viernes 13/11/2026",
    )
  })
})

describe("mi perfil: validacion", () => {
  it("arma lo que se guarda, sin espacios de mas y con vacios como null", () => {
    expect(validarPerfil({ nombre: " Ana ", apellido: "", telefono: " +54 9 11 5555-0000 " })).toEqual({
      ok: true,
      valor: { first_name: "Ana", last_name: null, phone: "+54 9 11 5555-0000" },
    })
  })

  it("nombre obligatorio y telefono con formato", () => {
    const r = validarPerfil({ nombre: " ", apellido: "x".repeat(61), telefono: "llamame" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errores).sort()).toEqual(["apellido", "nombre", "telefono"])
  })
})
