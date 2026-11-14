import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it } from "vitest"
import { crearClienteFalso, SESION_DE_PRUEBA } from "@/test/supabaseFalso"
import { PALETAS, aplicarPaleta, type CodigoPaleta } from "@/lib/paletas"
import { ConfiguracionPage } from "./ConfiguracionPage"

// Como en el panel: la paleta vive arriba y se aplica a la pagina.
function Pagina({ client }: { client: ReturnType<typeof crearClienteFalso>["client"] }) {
  const [paleta, setPaleta] = useState<CodigoPaleta>("violeta")
  return (
    <ConfiguracionPage
      client={client}
      clubId="club-1"
      paleta={paleta}
      onCambio={(p) => {
        setPaleta(p)
        aplicarPaleta(p)
      }}
    />
  )
}

describe("Configuración: paleta de colores", () => {
  it("muestra todas las paletas con la del club elegida", () => {
    const { client } = crearClienteFalso(SESION_DE_PRUEBA)
    render(<Pagina client={client} />)
    expect(screen.getAllByRole("radio")).toHaveLength(PALETAS.length)
    expect(screen.getByRole("radio", { name: "Violeta" })).toHaveAttribute("aria-checked", "true")
  })

  it("elegir una la aplica al momento y la guarda en el club (solo la paleta)", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, { club_settings: [{ data: [{ palette: "azul" }], error: null }] })
    render(<Pagina client={falso.client} />)
    await userEvent.click(screen.getByRole("radio", { name: "Azul" }))

    expect(document.documentElement.dataset.palette).toBe("azul")
    expect(await screen.findByText("Paleta guardada para este club.")).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Azul" })).toHaveAttribute("aria-checked", "true")
    expect(falso.escrituras).toEqual([
      expect.objectContaining({
        tabla: "club_settings",
        operacion: "update",
        fila: { palette: "azul" },
        filtros: expect.arrayContaining([{ metodo: "eq", args: ["club_id", "club-1"] }]),
      }),
    ])
  })

  it("si no se guarda (error o sin permiso), vuelve la paleta anterior y avisa", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, { club_settings: [{ data: [], error: null }] })
    render(<Pagina client={falso.client} />)
    await userEvent.click(screen.getByRole("radio", { name: "Rosa" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar la paleta.")
    await waitFor(() => expect(document.documentElement.dataset.palette).toBeUndefined())
    expect(screen.getByRole("radio", { name: "Violeta" })).toHaveAttribute("aria-checked", "true")
  })
})
