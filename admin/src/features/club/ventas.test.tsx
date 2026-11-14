import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { crearClienteFalso, SESION_DE_PRUEBA } from "@/test/supabaseFalso"
import { VentasPage } from "./VentasPage"

const CLUB = "club-1"
const NOCHE = { id: "n1", started_at: "2026-11-13T23:00:00Z", ended_at: null }
const METODOS = [
  { code: "pix", label: "PIX", active: true },
  { code: "transfer", label: "Transferencia", active: true },
  { code: "cash", label: "Efectivo", active: true },
  { code: "card", label: "Tarjeta", active: false },
]
const JUAN = { id: "u1", full_name: "Juan", role: "cashier", active: true, username: "juan", email: null }
const PEDRO = { id: "u2", full_name: "Pedro", role: "bartender", active: true, username: "pedro", email: null }
const CAJA1 = { id: "c1", name: "Caja 1", inventory_location_id: "l1", active: true }

const MIXTA = {
  id: "v1",
  night_id: "n1",
  ticket_number: "C1-000001",
  total: "5000.00",
  status: "delivered",
  created_at_device: "2026-11-14T02:10:00Z",
  delivered_at: "2026-11-14T02:15:00Z",
  cash_register_id: "c1",
  cash_register_name: "Caja 1",
  cashier_user_id: "u1",
  cashier_name: "Juan",
  delivered_by_name: "Pedro",
  payment_methods: ["pix", "cash"],
  is_mixed: true,
  cash_amount: "3000.00",
  pix_amount: "2000.00",
  transfer_amount: "0",
  outside_night: false,
}
const PENDIENTE = {
  ...MIXTA,
  id: "v2",
  ticket_number: "C1-000002",
  total: "6000.00",
  status: "pending",
  delivered_at: null,
  delivered_by_name: null,
  payment_methods: ["transfer"],
  is_mixed: false,
  cash_amount: "0",
  pix_amount: "0",
  transfer_amount: "6000.00",
}
const RESUMEN_CAJA1 = {
  cash_register_id: "c1",
  cash_register_name: "Caja 1",
  opening_float: "10000.00",
  added_float: "5000.00",
  float_total: "15000.00",
  tickets: 2,
  sales_total: "11000.00",
  cash_sales: "3000.00",
  pix_sales: "2000.00",
  transfer_sales: "6000.00",
  expected_cash: "18000.00",
}

function clienteVentas(extra: Record<string, { data: unknown; error: unknown }[]> = {}) {
  return crearClienteFalso(SESION_DE_PRUEBA, {
    club_nights: [{ data: [NOCHE], error: null }],
    cash_registers: [{ data: [CAJA1], error: null }],
    users: [{ data: [JUAN, PEDRO], error: null }],
    payment_methods: [{ data: METODOS, error: null }],
    v_sales_list: [{ data: [MIXTA, PENDIENTE], error: null }],
    v_night_register_summary: [{ data: [RESUMEN_CAJA1], error: null }],
    ...extra,
  })
}

describe("VentasPage", () => {
  it("lista cajero, metodo (mixto), monto y estado de cada venta, de la noche en curso", async () => {
    const falso = clienteVentas()
    render(<VentasPage client={falso.client} clubId={CLUB} nocheAbierta={NOCHE} />)

    const mixta = await screen.findByRole("button", { name: "Venta C1-000001" })
    expect(within(mixta).getAllByText("Juan").length).toBeGreaterThan(0)
    expect(within(mixta).getByText("Mixto")).toBeInTheDocument()
    expect(within(mixta).getByText("PIX + Efectivo")).toBeInTheDocument()
    expect(within(mixta).getAllByText("$5.000,00").length).toBeGreaterThan(0)
    expect(within(mixta).getByText("Retirado")).toBeInTheDocument()

    const pendiente = screen.getByRole("button", { name: "Venta C1-000002" })
    expect(within(pendiente).getByText("Transferencia")).toBeInTheDocument()
    expect(within(pendiente).getByText("Pendiente")).toBeInTheDocument()

    // por defecto muestra la noche en curso
    expect(falso.consultas).toContainEqual({ tabla: "v_sales_list", metodo: "eq", args: ["night_id", "n1"] })
    expect(falso.consultas).toContainEqual({ tabla: "v_sales_list", metodo: "eq", args: ["club_id", CLUB] })
  })

  it("resumen: el efectivo suma las ventas en efectivo y el cambio dado a la caja", async () => {
    const { client } = clienteVentas()
    render(<VentasPage client={client} clubId={CLUB} nocheAbierta={NOCHE} />)

    expect(await screen.findByLabelText("Efectivo en caja: $18.000,00")).toBeInTheDocument()
    expect(screen.getByText("Ventas $3.000,00 + cambio $15.000,00")).toBeInTheDocument()
    expect(screen.getByLabelText("PIX: $2.000,00")).toBeInTheDocument()
    expect(screen.getByLabelText("Transferencia: $6.000,00")).toBeInTheDocument()
    expect(screen.getByLabelText("Efectivo en Caja 1: $18.000,00")).toBeInTheDocument()
    expect(screen.getByText("inicial $10.000,00 + $5.000,00")).toBeInTheDocument()
  })

  it("filtra por metodo, cajero, estado y fechas (el hasta incluye todo el dia)", async () => {
    const falso = clienteVentas()
    render(<VentasPage client={falso.client} clubId={CLUB} nocheAbierta={NOCHE} />)
    await screen.findByRole("button", { name: "Venta C1-000001" })

    // solo los metodos activos, mas Mixto
    const opcionesMetodo = within(screen.getByLabelText("Método de pago")).getAllByRole("option").map((o) => o.textContent)
    expect(opcionesMetodo).toEqual(["Todos", "PIX", "Transferencia", "Efectivo", "Mixto"])
    // en Cajero/a solo aparecen cajeros
    const opcionesCajero = within(screen.getByLabelText("Cajero/a")).getAllByRole("option").map((o) => o.textContent)
    expect(opcionesCajero).toEqual(["Todos", "Juan"])

    await userEvent.selectOptions(screen.getByLabelText("Método de pago"), "pix")
    expect(falso.consultas).toContainEqual({ tabla: "v_sales_list", metodo: "contains", args: ["payment_methods", ["pix"]] })
    await userEvent.selectOptions(screen.getByLabelText("Método de pago"), "mixto")
    expect(falso.consultas).toContainEqual({ tabla: "v_sales_list", metodo: "eq", args: ["is_mixed", true] })
    await userEvent.selectOptions(screen.getByLabelText("Cajero/a"), "u1")
    expect(falso.consultas).toContainEqual({ tabla: "v_sales_list", metodo: "eq", args: ["cashier_user_id", "u1"] })
    await userEvent.selectOptions(screen.getByLabelText("Estado"), "pending")
    expect(falso.consultas).toContainEqual({ tabla: "v_sales_list", metodo: "eq", args: ["status", "pending"] })
    await userEvent.type(screen.getByLabelText("Hasta"), "2026-11-14")
    expect(falso.consultas).toContainEqual({ tabla: "v_sales_list", metodo: "lt", args: ["created_at_device", "2026-11-15"] })
  })

  it("al tocar una venta muestra productos, cantidades y cuanto se pago con cada metodo", async () => {
    const falso = clienteVentas({
      sale_items: [
        {
          data: [{ id: "i1", product_name: "Corona", quantity: 1, unit_price: "5000.00", line_total: "5000.00" }],
          error: null,
        },
      ],
      sale_payments: [
        {
          data: [
            { method: "pix", amount: "2000.00" },
            { method: "cash", amount: "3000.00" },
          ],
          error: null,
        },
      ],
      sale_item_substitutions: [
        { data: [{ sale_item_id: "i1", quantity: 1, substitute_product_name: "Heineken" }], error: null },
      ],
    })
    render(<VentasPage client={falso.client} clubId={CLUB} nocheAbierta={NOCHE} />)
    await userEvent.click(await screen.findByRole("button", { name: "Venta C1-000001" }))

    expect(await screen.findByText("Ticket C1-000001")).toBeInTheDocument()
    expect(await screen.findByText("Corona")).toBeInTheDocument()
    expect(screen.getByText("Pago mixto")).toBeInTheDocument()
    const pagos = screen.getByRole("region", { name: "Pagos" })
    expect(within(pagos).getByLabelText("PIX: $2.000,00")).toBeInTheDocument()
    expect(within(pagos).getByLabelText("Efectivo: $3.000,00")).toBeInTheDocument()
    expect(screen.getByText("Se entregó 1 × Heineken en su lugar")).toBeInTheDocument()
    expect(screen.getByText(/por Pedro/)).toBeInTheDocument()
    expect(falso.consultas).toContainEqual({ tabla: "sale_items", metodo: "eq", args: ["sale_id", "v1"] })
  })

  it("en tiempo real: una venta nueva o un retiro vuelven a leer la lista", async () => {
    const nueva = { ...PENDIENTE, id: "v3", ticket_number: "C1-000003" }
    const falso = clienteVentas({
      v_sales_list: [
        { data: [MIXTA], error: null },
        { data: [nueva, MIXTA], error: null },
      ],
    })
    render(<VentasPage client={falso.client} clubId={CLUB} nocheAbierta={NOCHE} />)
    await screen.findByRole("button", { name: "Venta C1-000001" })
    expect(screen.getByText("En vivo")).toBeInTheDocument()
    expect(falso.canales.some((c) => ["sales", "sale_payments", "cash_register_floats"].every((t) => c.tablas.includes(t)))).toBe(
      true,
    )

    await act(async () => {
      falso.emitir("sales")
      await new Promise((r) => setTimeout(r, 350))
    })
    expect(await screen.findByRole("button", { name: "Venta C1-000003" })).toBeInTheDocument()
  })

  it("agregar cambio a una caja durante la noche (refuerzo)", async () => {
    const falso = clienteVentas()
    render(<VentasPage client={falso.client} clubId={CLUB} nocheAbierta={NOCHE} />)
    await userEvent.click(await screen.findByRole("button", { name: "Agregar cambio a Caja 1" }))
    await userEvent.type(screen.getByLabelText("Monto ($)"), "5000")
    await userEvent.type(screen.getByLabelText("Nota (opcional)"), "Refuerzo 1 AM")
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambio" }))

    expect(falso.inserciones).toContainEqual({
      tabla: "cash_register_floats",
      fila: {
        club_id: CLUB,
        night_id: "n1",
        cash_register_id: "c1",
        kind: "top_up",
        amount: "5000",
        note: "Refuerzo 1 AM",
      },
    })
  })

  it("sin noche en curso avisa que los posnets no venden y no ofrece agregar cambio", async () => {
    const cerrada = { ...NOCHE, ended_at: "2026-11-14T06:00:00Z" }
    const { client } = clienteVentas({ club_nights: [{ data: [cerrada], error: null }] })
    render(<VentasPage client={client} clubId={CLUB} nocheAbierta={null} />)
    expect(await screen.findByText(/los posnets no venden/)).toBeInTheDocument()
    await screen.findByRole("button", { name: "Venta C1-000001" })
    expect(screen.queryByRole("button", { name: /Agregar cambio/ })).not.toBeInTheDocument()
  })

  it("marca las ventas hechas fuera de una noche abierta", async () => {
    const { client } = clienteVentas({ v_sales_list: [{ data: [{ ...PENDIENTE, outside_night: true }], error: null }] })
    render(<VentasPage client={client} clubId={CLUB} nocheAbierta={NOCHE} />)
    const fila = await screen.findByRole("button", { name: "Venta C1-000002" })
    expect(within(fila).getByText("Fuera de noche")).toBeInTheDocument()
  })
})
