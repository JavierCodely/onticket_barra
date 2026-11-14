import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  CLAVE_TEMA,
  aplicarTema,
  esTema,
  guardarTema,
  leerTemaGuardado,
  temaInicial,
  temaOpuesto,
} from "./theme-config"

function simularSistema(oscuro: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches: oscuro, media: "", addEventListener: vi.fn() }),
  )
}

describe("theme-config", () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.className = ""
    document.documentElement.removeAttribute("style")
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("esTema acepta solo light y dark", () => {
    expect(esTema("light")).toBe(true)
    expect(esTema("dark")).toBe(true)
    expect(esTema("system")).toBe(false)
    expect(esTema(null)).toBe(false)
  })

  it("temaOpuesto invierte el tema", () => {
    expect(temaOpuesto("light")).toBe("dark")
    expect(temaOpuesto("dark")).toBe("light")
  })

  it("guarda y lee el tema en localStorage", () => {
    guardarTema("dark")
    expect(window.localStorage.getItem(CLAVE_TEMA)).toBe("dark")
    expect(leerTemaGuardado()).toBe("dark")
  })

  it("ignora un valor guardado que no es un tema valido", () => {
    window.localStorage.setItem(CLAVE_TEMA, "rosa")
    expect(leerTemaGuardado()).toBeNull()
  })

  it("sin acceso a localStorage no rompe y devuelve null", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked")
      })
    expect(leerTemaGuardado()).toBeNull()
    spy.mockRestore()
  })

  it("sin acceso a localStorage al guardar no lanza error", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota")
      })
    expect(() => guardarTema("dark")).not.toThrow()
    spy.mockRestore()
  })

  it("temaInicial usa la preferencia guardada antes que el sistema", () => {
    simularSistema(true)
    window.localStorage.setItem(CLAVE_TEMA, "light")
    expect(temaInicial()).toBe("light")
  })

  it("temaInicial sigue al sistema cuando no hay preferencia guardada", () => {
    simularSistema(true)
    expect(temaInicial()).toBe("dark")
    simularSistema(false)
    expect(temaInicial()).toBe("light")
  })

  it("aplicarTema pone o quita la clase dark y el colorScheme", () => {
    aplicarTema("dark")
    expect(document.documentElement).toHaveClass("dark")
    expect(document.documentElement.style.colorScheme).toBe("dark")

    aplicarTema("light")
    expect(document.documentElement).not.toHaveClass("dark")
    expect(document.documentElement.style.colorScheme).toBe("light")
  })
})
