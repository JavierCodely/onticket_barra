import { describe, expect, it } from "vitest"
import { RUTA_INICIAL, escribirRuta, leerRuta } from "./ruta"

const ID = "c0000000-0000-0000-0000-00000000000a"

describe("ruta del panel en la direccion", () => {
  it("ida y vuelta: club y seccion, o seccion global", () => {
    const club = { tipo: "club", clubId: ID, seccion: "ventas" } as const
    expect(escribirRuta(club)).toBe(`#/club/${ID}/ventas`)
    expect(leerRuta(escribirRuta(club))).toEqual(club)
    expect(leerRuta("#/logs")).toEqual({ tipo: "global", seccion: "logs" })
  })

  it("lo que no se entiende vuelve al inicio o al dashboard del club", () => {
    expect(leerRuta("")).toEqual(RUTA_INICIAL)
    expect(leerRuta("#/cualquier-cosa")).toEqual(RUTA_INICIAL)
    expect(leerRuta("#/club")).toEqual(RUTA_INICIAL)
    expect(leerRuta(`#/club/${ID}/no-existe`)).toEqual({ tipo: "club", clubId: ID, seccion: "dashboard" })
    expect(leerRuta(`#/club/${ID}`)).toEqual({ tipo: "club", clubId: ID, seccion: "dashboard" })
    expect(leerRuta("#/club/<script>/ventas")).toEqual(RUTA_INICIAL)
  })
})
