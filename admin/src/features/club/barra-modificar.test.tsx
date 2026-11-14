import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { crearClienteFalso, SESION_DE_PRUEBA } from "@/test/supabaseFalso"
import { calcularAjusteConteo, validarDevolucion } from "@/lib/validaciones"
import { StockBarraPage } from "./StockBarraPage"

const CLUB = "club-1"
const CORONA = { id: "p1", name: "Corona", sku: null, category_id: null, cost: 1000, price: 5000, image_url: null, active: true }
const BARRA = { id: "l1", name: "Barra principal", kind: "bar", active: true }
const DEPOSITO = { id: "l2", name: "Depósito", kind: "storage", active: true }

type Respuesta = { data: unknown; error: unknown }

function cliente(saldosDespues: Respuesta[] = [], ubicaciones = [BARRA, DEPOSITO]) {
  return crearClienteFalso(SESION_DE_PRUEBA, {
    products: [{ data: [CORONA], error: null }],
    inventory_locations: [{ data: ubicaciones, error: null }],
    inventory_balances: [
      {
        data: [
          { location_id: "l2", product_id: "p1", quantity: 100 },
          { location_id: "l1", product_id: "p1", quantity: 48 },
        ],
        error: null,
      },
      ...saldosDespues,
    ],
  })
}

async function abrirModificar() {
  await userEvent.click(await screen.findByRole("button", { name: "Barra principal" }))
  await userEvent.click(screen.getByRole("button", { name: "Modificar stock de Corona en la barra" }))
  return screen.findByRole("dialog")
}

const filaMovimientos = (falso: ReturnType<typeof cliente>) =>
  falso.escrituras.find((e) => e.tabla === "inventory_movements")?.fila as Record<string, unknown>[] | undefined

describe("validaciones al modificar el stock de una barra", () => {
  it("corregir conteo: registra la diferencia con lo que figura", () => {
    expect(calcularAjusteConteo("45", 48)).toEqual({ ok: true, valor: -3 })
    expect(calcularAjusteConteo("50", 48)).toEqual({ ok: true, valor: 2 })
    expect(calcularAjusteConteo("0", 48)).toEqual({ ok: true, valor: -48 })
    expect(calcularAjusteConteo("0", -2)).toEqual({ ok: true, valor: 2 }) // sobreventa: vuelve a 0
    expect(calcularAjusteConteo("48", 48).ok).toBe(false)
    for (const mal of ["", "-1", "1.5", "abc"]) expect(calcularAjusteConteo(mal, 48).ok).toBe(false)
  })

  it("devolver: no mas de lo que hay en la barra", () => {
    expect(validarDevolucion("10", 48)).toEqual({ ok: true, valor: 10 })
    expect(validarDevolucion("48", 48)).toEqual({ ok: true, valor: 48 })
    const demas = validarDevolucion("49", 48)
    expect(!demas.ok && demas.errores).toBe("En la barra hay 48: no se puede devolver más que eso.")
    expect(validarDevolucion("1", 0).ok).toBe(false)
    expect(validarDevolucion("0", 48).ok).toBe(false)
  })
})

describe("Stock en barra: modificar", () => {
  it("cada producto de la barra tiene el boton Modificar", async () => {
    const { client } = cliente()
    render(<StockBarraPage client={client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Barra principal" }))
    expect(screen.getByRole("button", { name: "Modificar stock de Corona en la barra" })).toBeEnabled()
  })

  it("CORREGIR CONTEO: se escribe lo que hay y se registra un ajuste por la diferencia en la barra", async () => {
    const falso = cliente([
      {
        data: [
          { location_id: "l2", product_id: "p1", quantity: 100 },
          { location_id: "l1", product_id: "p1", quantity: 45 },
        ],
        error: null,
      },
    ])
    render(<StockBarraPage client={falso.client} clubId={CLUB} />)
    const dialogo = await abrirModificar()
    expect(within(dialogo).getByText(/hay 48/)).toBeInTheDocument()
    expect(within(dialogo).getByLabelText(/Corregir conteo/)).toBeChecked()

    await userEvent.type(within(dialogo).getByLabelText("Cantidad real en la barra"), "45")
    expect(within(dialogo).getByText("Figura 48: se registra un ajuste de -3.")).toBeInTheDocument()
    await userEvent.type(within(dialogo).getByLabelText("Motivo (opcional)"), "3 botellas rotas")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar conteo" }))

    expect(filaMovimientos(falso)).toEqual([
      { club_id: CLUB, product_id: "p1", note: "3 botellas rotas", location_id: "l1", movement_type: "adjustment", quantity: -3 },
    ])
    // el saldo lo calcula la base: se vuelve a leer, nunca se escribe
    expect(falso.escrituras.filter((e) => e.tabla === "inventory_balances")).toEqual([])
    expect(await screen.findByLabelText("Corona en barra: 45")).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("CORREGIR CONTEO: la misma cantidad no registra nada", async () => {
    const falso = cliente()
    render(<StockBarraPage client={falso.client} clubId={CLUB} />)
    const dialogo = await abrirModificar()
    await userEvent.type(within(dialogo).getByLabelText("Cantidad real en la barra"), "48")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar conteo" }))
    expect(within(dialogo).getByRole("alert")).toHaveTextContent("no hay nada que corregir")
    expect(falso.escrituras).toEqual([])
  })

  it("DEVOLVER AL DEPOSITO: transferencia barra -> deposito en una sola insercion", async () => {
    const falso = cliente([
      {
        data: [
          { location_id: "l2", product_id: "p1", quantity: 110 },
          { location_id: "l1", product_id: "p1", quantity: 38 },
        ],
        error: null,
      },
    ])
    render(<StockBarraPage client={falso.client} clubId={CLUB} />)
    const dialogo = await abrirModificar()
    await userEvent.click(within(dialogo).getByLabelText(/Devolver al depósito/))
    await userEvent.type(within(dialogo).getByLabelText("Cantidad a devolver"), "10")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Devolver" }))

    expect(falso.escrituras.filter((e) => e.tabla === "inventory_movements")).toHaveLength(1)
    expect(filaMovimientos(falso)).toEqual([
      { club_id: CLUB, product_id: "p1", note: "Devolución de barra", location_id: "l1", movement_type: "transfer_out", quantity: -10 },
      { club_id: CLUB, product_id: "p1", note: "Devolución de barra", location_id: "l2", movement_type: "transfer_in", quantity: 10 },
    ])
    expect(await screen.findByLabelText("Corona en barra: 38")).toBeInTheDocument()
    expect(screen.getByLabelText("Corona en depósito: 110")).toBeInTheDocument()
  })

  it("DEVOLVER: no se devuelve mas de lo que hay en la barra", async () => {
    const falso = cliente()
    render(<StockBarraPage client={falso.client} clubId={CLUB} />)
    const dialogo = await abrirModificar()
    await userEvent.click(within(dialogo).getByLabelText(/Devolver al depósito/))
    await userEvent.type(within(dialogo).getByLabelText("Cantidad a devolver"), "60")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Devolver" }))
    expect(within(dialogo).getByRole("alert")).toHaveTextContent("En la barra hay 48")
    expect(falso.escrituras).toEqual([])
  })

  it("sin deposito se puede corregir el conteo, pero no devolver", async () => {
    const falso = cliente([], [BARRA])
    render(<StockBarraPage client={falso.client} clubId={CLUB} />)
    const dialogo = await abrirModificar()
    expect(within(dialogo).getByLabelText(/Devolver al depósito/)).toBeDisabled()
    expect(within(dialogo).getByLabelText(/Corregir conteo/)).toBeEnabled()
  })
})
