import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { crearClienteFalso, SESION_DE_PRUEBA } from "@/test/supabaseFalso"
import type { EstadoNoche } from "./useNoche"
import { AVISO_PARAR, ControlNoche } from "./ControlNoche"

const CLUB = "club-1"
const NOCHE = { id: "n1", started_at: "2026-11-13T23:00:00Z", ended_at: null }
const CAJAS = [
  { id: "c1", name: "Caja 1", inventory_location_id: "l1", active: true },
  { id: "c2", name: "Caja 2", inventory_location_id: "l1", active: true },
  { id: "c3", name: "Caja vieja", inventory_location_id: "l1", active: false },
]

function estado(noche: EstadoNoche["noche"]): EstadoNoche {
  return { noche, cargando: false, error: false, recargar: vi.fn(), setNoche: vi.fn() }
}

describe("ControlNoche", () => {
  it("INICIAR: pide el cambio de cada caja activa y lo guarda en una sola insercion", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, {
      cash_registers: [{ data: CAJAS, error: null }],
      club_nights: [{ data: NOCHE, error: null }],
    })
    const e = estado(null)
    render(<ControlNoche client={falso.client} clubId={CLUB} estado={e} />)

    await userEvent.click(screen.getByRole("button", { name: "Iniciar noche" }))
    await userEvent.type(await screen.findByLabelText("Cambio de Caja 1 ($)"), "20000")
    expect(screen.getByLabelText("Cambio de Caja 2 ($)")).toHaveValue("")
    expect(screen.queryByLabelText("Cambio de Caja vieja ($)")).not.toBeInTheDocument()
    const botones = screen.getAllByRole("button", { name: "Iniciar noche" })
    await userEvent.click(botones[botones.length - 1])

    expect(e.setNoche).toHaveBeenCalledWith(NOCHE)
    // la noche: solo club_id (la hora y el autor los pone la base)
    expect(falso.inserciones[0]).toEqual({ tabla: "club_nights", fila: { club_id: CLUB } })
    // el cambio: solo las cajas con monto
    expect(falso.inserciones[1]).toEqual({
      tabla: "cash_register_floats",
      fila: [{ club_id: CLUB, night_id: "n1", cash_register_id: "c1", kind: "opening", amount: "20000" }],
    })
  })

  it("INICIAR: un monto invalido no inicia nada", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, { cash_registers: [{ data: CAJAS, error: null }] })
    render(<ControlNoche client={falso.client} clubId={CLUB} estado={estado(null)} />)
    await userEvent.click(screen.getByRole("button", { name: "Iniciar noche" }))
    await userEvent.type(await screen.findByLabelText("Cambio de Caja 1 ($)"), "abc")
    const botones = screen.getAllByRole("button", { name: "Iniciar noche" })
    await userEvent.click(botones[botones.length - 1])

    expect(screen.getByText(/Monto inválido/)).toBeInTheDocument()
    expect(falso.inserciones).toEqual([])
  })

  it("INICIAR: si ya hay una noche abierta lo avisa", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, {
      cash_registers: [{ data: [], error: null }],
      club_nights: [{ data: null, error: { message: 'duplicate key value violates unique constraint "uq_club_nights_one_open"' } }],
    })
    render(<ControlNoche client={falso.client} clubId={CLUB} estado={estado(null)} />)
    await userEvent.click(screen.getByRole("button", { name: "Iniciar noche" }))
    const botones = await screen.findAllByRole("button", { name: "Iniciar noche" })
    await userEvent.click(botones[botones.length - 1])
    expect(await screen.findByText("Ya hay una noche en curso en este club.")).toBeInTheDocument()
  })

  it("PARAR: pide confirmacion con el aviso y escribe solo ended_at", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, {
      club_nights: [{ data: { ...NOCHE, ended_at: "2026-11-14T06:00:00Z" }, error: null }],
    })
    const e = estado(NOCHE)
    render(<ControlNoche client={falso.client} clubId={CLUB} estado={e} />)

    await userEvent.click(screen.getByRole("button", { name: "Parar noche" }))
    expect(await screen.findByText(AVISO_PARAR)).toBeInTheDocument()
    expect(falso.escrituras).toEqual([])

    const botones = screen.getAllByRole("button", { name: "Parar noche" })
    await userEvent.click(botones[botones.length - 1])
    expect(e.setNoche).toHaveBeenCalledWith(null)
    expect(falso.escrituras).toHaveLength(1)
    expect(falso.escrituras[0].tabla).toBe("club_nights")
    expect(falso.escrituras[0].operacion).toBe("update")
    expect(Object.keys(falso.escrituras[0].fila as object)).toEqual(["ended_at"])
    expect(falso.escrituras[0].filtros[0]).toEqual({ metodo: "eq", args: ["id", "n1"] })
  })

  it("cancelar al parar no cambia nada", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA)
    render(<ControlNoche client={falso.client} clubId={CLUB} estado={estado(NOCHE)} />)
    await userEvent.click(screen.getByRole("button", { name: "Parar noche" }))
    await userEvent.click(await screen.findByRole("button", { name: "Cancelar" }))
    expect(falso.escrituras).toEqual([])
  })
})
