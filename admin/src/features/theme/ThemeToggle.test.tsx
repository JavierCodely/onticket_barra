import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ThemeProvider } from "./ThemeProvider"
import { ThemeToggle } from "./ThemeToggle"
import { CLAVE_TEMA } from "./theme-config"

function renderizar() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  )
}

describe("ThemeToggle", () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.className = ""
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: false, media: "", addEventListener: vi.fn() }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("arranca en claro y ofrece activar el modo oscuro", () => {
    renderizar()

    expect(screen.getByRole("button", { name: "Activar modo oscuro" })).toBeInTheDocument()
    expect(document.documentElement).not.toHaveClass("dark")
  })

  it("al pulsar cambia a oscuro, aplica la clase y guarda la preferencia", async () => {
    renderizar()

    await userEvent.click(screen.getByRole("button", { name: "Activar modo oscuro" }))

    expect(document.documentElement).toHaveClass("dark")
    expect(window.localStorage.getItem(CLAVE_TEMA)).toBe("dark")
    expect(screen.getByRole("button", { name: "Activar modo claro" })).toBeInTheDocument()
  })

  it("al pulsar de nuevo vuelve a claro", async () => {
    renderizar()

    await userEvent.click(screen.getByRole("button", { name: "Activar modo oscuro" }))
    await userEvent.click(screen.getByRole("button", { name: "Activar modo claro" }))

    expect(document.documentElement).not.toHaveClass("dark")
    expect(window.localStorage.getItem(CLAVE_TEMA)).toBe("light")
  })

  it("respeta la preferencia guardada al montar", () => {
    window.localStorage.setItem(CLAVE_TEMA, "dark")
    renderizar()

    expect(screen.getByRole("button", { name: "Activar modo claro" })).toBeInTheDocument()
    expect(document.documentElement).toHaveClass("dark")
  })
})
