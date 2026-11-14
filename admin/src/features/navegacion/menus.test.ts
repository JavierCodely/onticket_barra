import { describe, expect, it } from "vitest"
import { MENU_CLUB, MENU_GLOBAL } from "./menus"

// El orden y el estado de cada opcion estan definidos en CLAUDE.md, seccion 4 bis.
describe("menus del panel", () => {
  it("sin club: Dashboard (en desarrollo), Clubs y Logs (en desarrollo)", () => {
    expect(MENU_GLOBAL.map((o) => [o.titulo, o.estado])).toEqual([
      ["Dashboard", "en_desarrollo"],
      ["Clubs", "activa"],
      ["Logs", "en_desarrollo"],
    ])
  })

  it("con club: el orden pedido", () => {
    expect(MENU_CLUB.map((o) => o.titulo)).toEqual([
      "Dashboard",
      "Ventas",
      "Productos",
      "Stock en barra",
      "Inicio y cierre",
      "Combos",
      "Promociones",
      "Cajas/Barras",
      "Impuestos",
      "Personal",
      "Historial",
      "Configuración",
    ])
  })

  it("con club: Dashboard en desarrollo; Promociones todavia no se implementa; Combos e Impuestos activas", () => {
    const estado = Object.fromEntries(MENU_CLUB.map((o) => [o.id, o.estado]))
    expect(estado.dashboard).toBe("en_desarrollo")
    expect(estado.combos).toBe("activa")
    expect(estado.promociones).toBe("activa")
    expect(estado.ventas).toBe("activa")
    expect(estado.productos).toBe("activa")
    expect(estado.stock_barra).toBe("activa")
    expect(estado.inicio_cierre).toBe("activa")
    expect(estado.cajas).toBe("activa")
    expect(estado.personal).toBe("activa")
    expect(estado.impuestos).toBe("activa")
    expect(estado.historial).toBe("activa")
    expect(estado.configuracion).toBe("activa")
  })

  it("no repite identificadores", () => {
    expect(new Set(MENU_CLUB.map((o) => o.id)).size).toBe(MENU_CLUB.length)
    expect(new Set(MENU_GLOBAL.map((o) => o.id)).size).toBe(MENU_GLOBAL.length)
  })
})
