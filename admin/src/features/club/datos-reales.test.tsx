// Regresion: Supabase (PostgREST) devuelve las columnas numeric como NUMERO
// en el JSON (1500), no como texto ("1500.00"). Las pruebas viejas usaban
// texto y no vieron que Productos se rompia con "monto.split is not a
// function". Aca cada pagina recibe los datos con la forma real.
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { crearClienteFalso, SESION_DE_PRUEBA } from "@/test/supabaseFalso"
import { ImpuestosPage } from "./ImpuestosPage"
import { ProductosPage } from "./ProductosPage"
import { StockBarraPage } from "./StockBarraPage"
import { VentasPage } from "./VentasPage"

const CLUB = "club-1"
const METODOS = [
  { code: "pix", label: "PIX", active: true },
  { code: "transfer", label: "Transferencia", active: true },
  { code: "cash", label: "Efectivo", active: true },
]

describe("con datos como los manda Supabase (numeric = numero)", () => {
  it("Productos muestra costo y precio", async () => {
    const { client } = crearClienteFalso(SESION_DE_PRUEBA, {
      products: [
        { data: [{ id: "p1", name: "Fernet", sku: null, category_id: null, cost: 1500, price: 6500.5, active: true }], error: null },
      ],
      product_categories: [{ data: [{ id: "c", name: "Vaso", sort_order: 0, active: true }], error: null }],
      inventory_locations: [{ data: [{ id: "d", name: "Depósito", kind: "storage", active: true }], error: null }],
      inventory_balances: [{ data: [{ location_id: "d", product_id: "p1", quantity: 100 }], error: null }],
    })
    render(<ProductosPage client={client} clubId={CLUB} />)
    expect(await screen.findByText("Fernet")).toBeInTheDocument()
    expect(screen.getByText("$1.500,00")).toBeInTheDocument()
    expect(screen.getByText("$6.500,50")).toBeInTheDocument()
  })

  it("Impuestos muestra el valor y lo deja editar", async () => {
    const { client } = crearClienteFalso(SESION_DE_PRUEBA, {
      taxes: [
        {
          data: [
            { id: "t1", name: "Comision PIX", kind: "percentage", percentage: 3.5, fixed_amount: null, active: true },
            { id: "t2", name: "Tasa", kind: "fixed", percentage: null, fixed_amount: 50, active: true },
          ],
          error: null,
        },
      ],
      tax_payment_methods: [{ data: [{ tax_id: "t1", method: "pix" }, { tax_id: "t2", method: "cash" }], error: null }],
      payment_methods: [{ data: METODOS, error: null }],
    })
    render(<ImpuestosPage client={client} clubId={CLUB} />)
    expect(await screen.findByText("3,5 %")).toBeInTheDocument()
    expect(screen.getByText("$50,00 por unidad")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Editar Comision PIX" }))
    expect(screen.getByLabelText("Porcentaje (%)")).toHaveValue("3.5")
  })

  it("Ventas: lista, resumen y detalle con montos numericos", async () => {
    const noche = { id: "n1", started_at: "2026-11-13T23:00:00Z", ended_at: null }
    const venta = {
      id: "v1", night_id: "n1", ticket_number: "C1-000001", total: 5000, status: "pending",
      created_at_device: "2026-11-14T02:10:00Z", delivered_at: null, cash_register_id: "c1",
      cash_register_name: "Caja 1", cashier_user_id: "u1", cashier_name: "Juan", delivered_by_name: null,
      payment_methods: ["pix", "cash"], is_mixed: true, cash_amount: 3000, pix_amount: 2000, transfer_amount: 0,
      outside_night: false,
    }
    const resumen = {
      cash_register_id: "c1", cash_register_name: "Caja 1", opening_float: 10000, added_float: 0, float_total: 10000,
      tickets: 1, sales_total: 5000, cash_sales: 3000, pix_sales: 2000, transfer_sales: 0, expected_cash: 13000,
    }
    const { client } = crearClienteFalso(SESION_DE_PRUEBA, {
      club_nights: [{ data: [noche], error: null }],
      cash_registers: [{ data: [], error: null }],
      users: [{ data: [], error: null }],
      payment_methods: [{ data: METODOS, error: null }],
      v_sales_list: [{ data: [venta], error: null }],
      v_night_register_summary: [{ data: [resumen], error: null }],
      sale_items: [{ data: [{ id: "i1", product_name: "Corona", quantity: 1, unit_price: 5000, line_total: 5000 }], error: null }],
      sale_payments: [{ data: [{ method: "pix", amount: 2000 }, { method: "cash", amount: 3000 }], error: null }],
      sale_item_substitutions: [{ data: [], error: null }],
    })
    render(<VentasPage client={client} clubId={CLUB} nocheAbierta={noche} />)
    expect(await screen.findByLabelText("Efectivo en caja: $13.000,00")).toBeInTheDocument()
    await userEvent.click(await screen.findByRole("button", { name: "Venta C1-000001" }))
    const pagos = await screen.findByRole("region", { name: "Pagos" })
    expect(within(pagos).getByLabelText("PIX: $2.000,00")).toBeInTheDocument()
  })

  it("Stock en barra con cantidades numericas", async () => {
    const { client } = crearClienteFalso(SESION_DE_PRUEBA, {
      products: [{ data: [{ id: "p1", name: "Corona", sku: null, category_id: null, cost: 1000, price: 5000, active: true }], error: null }],
      inventory_locations: [
        {
          data: [
            { id: "l1", name: "Barra principal", kind: "bar", active: true },
            { id: "l2", name: "Depósito", kind: "storage", active: true },
          ],
          error: null,
        },
      ],
      inventory_balances: [{ data: [{ location_id: "l2", product_id: "p1", quantity: 100 }], error: null }],
    })
    render(<StockBarraPage client={client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Barra principal" }))
    expect(screen.getByLabelText("Corona en depósito: 100")).toBeInTheDocument()
  })
})
