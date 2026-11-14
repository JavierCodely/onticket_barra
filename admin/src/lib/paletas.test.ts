import { describe, expect, it } from "vitest"
import css from "../index.css?raw"
import sql from "../../../supabase/sql/21_mas_paletas.sql?raw"
import { PALETAS, PALETA_POR_DEFECTO, aplicarPaleta, esPaleta, nombrePaleta } from "./paletas"

describe("paletas", () => {
  it("son las mismas que acepta la base (CHECK del archivo 21)", () => {
    const check = /CHECK \(palette IN\s*\(([^)]*)\)\)/.exec(sql)?.[1] ?? ""
    const enBase = [...check.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort()
    expect(PALETAS.map((p) => p.codigo).sort()).toEqual(enBase)
  })

  it("cada una (salvo la de Onticket) tiene sus colores claros y oscuros en index.css", () => {
    for (const p of PALETAS) {
      if (p.codigo === PALETA_POR_DEFECTO) continue
      expect(css).toContain(`:root[data-palette="${p.codigo}"]`)
      expect(css).toContain(`:root.dark[data-palette="${p.codigo}"]`)
    }
  })

  it("rojo en modo oscuro lleva fondo negro profundo", () => {
    const bloques = css.split(':root.dark[data-palette="rojo"]').slice(1).join("")
    expect(bloques).toMatch(/--background: oklch\(0\.0\d/)
  })

  it("aplicar: una paleta pone su codigo; la de Onticket, una desconocida o ninguna lo quitan", () => {
    const raiz = document.documentElement
    aplicarPaleta("rojo")
    expect(raiz.dataset.palette).toBe("rojo")
    aplicarPaleta("violeta")
    expect(raiz.dataset.palette).toBeUndefined()
    aplicarPaleta("rojo")
    aplicarPaleta("inventada")
    expect(raiz.dataset.palette).toBeUndefined()
    expect(esPaleta("lima")).toBe(true)
    expect(nombrePaleta("indigo")).toBe("Índigo")
  })
})
