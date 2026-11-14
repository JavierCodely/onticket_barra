import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { crearClienteFalso, SESION_DE_PRUEBA } from "@/test/supabaseFalso"
import { CajasBarrasPage } from "./CajasBarrasPage"
import { formatearMonto } from "@/lib/formato"
import { ProductosPage } from "./ProductosPage"

describe("formatearMonto", () => {
  it.each([
    ["5000.00", "$5.000,00"],
    ["1234567.5", "$1.234.567,50"],
    ["0", "$0,00"],
  ])("%s se muestra como %s", (entrada, salida) => {
    expect(formatearMonto(entrada)).toBe(salida)
  })
})

describe("ProductosPage", () => {
  const VASO = { id: "cat-1", name: "Vaso", sort_order: 0, active: true }
  const DEPOSITO = { id: "dep-1", name: "Depósito", kind: "storage", active: true }

  it("lista los productos del club con su categoria y el stock del deposito", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, {
      products: [
        {
          data: [
            {
              id: "p1",
              name: "Fernet",
              sku: "FER-1",
              category_id: "cat-1",
              cost: "1500.00",
              price: "6500.00",
              active: true,
            },
          ],
          error: null,
        },
      ],
      product_categories: [{ data: [VASO], error: null }],
      inventory_locations: [{ data: [DEPOSITO], error: null }],
      inventory_balances: [{ data: [{ location_id: "dep-1", product_id: "p1", quantity: 100 }], error: null }],
    })
    render(<ProductosPage client={falso.client} clubId="club-1" />)

    expect(await screen.findByText("Fernet")).toBeInTheDocument()
    expect(screen.getByText("$6.500,00")).toBeInTheDocument()
    expect(screen.getByLabelText("Stock de Fernet en depósito: 100")).toBeInTheDocument()
    expect(screen.getAllByText("Vaso").length).toBeGreaterThan(0)
    expect(falso.consultas).toContainEqual({ tabla: "products", metodo: "eq", args: ["club_id", "club-1"] })
  })

  it("crea un producto con su categoria y solo las columnas permitidas", async () => {
    const creado = {
      id: "p2",
      name: "Gin tonic",
      sku: null,
      category_id: "cat-1",
      cost: "0",
      price: "7000",
      active: true,
    }
    const falso = crearClienteFalso(SESION_DE_PRUEBA, {
      products: [
        { data: [], error: null },
        { data: creado, error: null },
      ],
      product_categories: [{ data: [VASO], error: null }],
      inventory_locations: [{ data: [DEPOSITO], error: null }],
    })
    render(<ProductosPage client={falso.client} clubId="club-1" />)

    await userEvent.click(await screen.findByRole("button", { name: "Nuevo producto" }))
    await userEvent.type(screen.getByLabelText("Nombre"), "Gin tonic")
    await userEvent.selectOptions(screen.getByLabelText("Categoría"), "cat-1")
    await userEvent.type(screen.getByLabelText("Precio"), "7000")
    await userEvent.click(screen.getByRole("button", { name: "Crear producto" }))

    expect(await screen.findByText("Gin tonic")).toBeInTheDocument()
    expect(falso.inserciones).toEqual([
      {
        tabla: "products",
        fila: {
          club_id: "club-1",
          name: "Gin tonic",
          sku: null,
          category_id: "cat-1",
          cost: "0",
          price: "7000",
          units_per_box: null, // no viene por caja (archivo 22)
          active: true,
        },
      },
    ])
  })

  it("crea categorias del club y avisa si se repite el nombre", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, {
      product_categories: [
        { data: [VASO], error: null },
        { data: { id: "cat-2", name: "Cerveza", sort_order: 10, active: true }, error: null },
        {
          data: null,
          error: { message: "duplicate key value violates unique constraint uq_product_categories_club_name" },
        },
      ],
      inventory_locations: [{ data: [DEPOSITO], error: null }],
    })
    render(<ProductosPage client={falso.client} clubId="club-1" />)

    // boton arriba -> modal
    await userEvent.click(await screen.findByRole("button", { name: "Nueva categoría" }))
    let dialogo = await screen.findByRole("dialog")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Crear categoría" }))
    expect(within(dialogo).getByText("Ingresá el nombre de la categoría.")).toBeInTheDocument()
    await userEvent.type(within(dialogo).getByLabelText("Nombre de la categoría"), "Cerveza")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Crear categoría" }))
    expect(await screen.findByText("Cerveza")).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(falso.inserciones).toContainEqual({
      tabla: "product_categories",
      fila: { club_id: "club-1", name: "Cerveza", sort_order: 10, active: true },
    })

    await userEvent.click(screen.getByRole("button", { name: "Nueva categoría" }))
    dialogo = await screen.findByRole("dialog")
    await userEvent.type(within(dialogo).getByLabelText("Nombre de la categoría"), "cerveza")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Crear categoría" }))
    // repetida: el modal sigue abierto con el aviso
    expect(await within(dialogo).findByText("Ya hay una categoría con ese nombre.")).toBeInTheDocument()
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("sin deposito ofrece crearlo y no deja cargar stock", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, {
      products: [
        {
          data: [{ id: "p1", name: "Corona", sku: null, category_id: null, cost: "1", price: "2", active: true }],
          error: null,
        },
      ],
      inventory_locations: [
        { data: [], error: null },
        { data: DEPOSITO, error: null },
      ],
    })
    render(<ProductosPage client={falso.client} clubId="club-1" />)

    await screen.findByText("Corona")
    expect(screen.queryByRole("button", { name: "Cargar depósito de Corona" })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Crear depósito" }))
    expect(await screen.findByRole("button", { name: "Cargar depósito de Corona" })).toBeEnabled()
    expect(falso.inserciones).toContainEqual({
      tabla: "inventory_locations",
      fila: { club_id: "club-1", name: "Depósito", kind: "storage", active: true },
    })
  })
})

describe("CajasBarrasPage", () => {
  it("pide una barra antes de permitir crear cajas", async () => {
    const { client } = crearClienteFalso(SESION_DE_PRUEBA)
    render(<CajasBarrasPage client={client} clubId="club-1" />)

    expect(await screen.findByText("Creá una barra antes de crear una caja.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Agregar caja" })).not.toBeInTheDocument()
  })

  it("crea una barra y despues una caja que vende desde ella", async () => {
    const barra = { id: "loc-1", name: "Barra principal", kind: "bar", active: true }
    const caja = { id: "caja-1", name: "Caja 1", inventory_location_id: "loc-1", active: true }
    const falso = crearClienteFalso(SESION_DE_PRUEBA, {
      inventory_locations: [
        { data: [], error: null },
        { data: barra, error: null },
      ],
      cash_registers: [
        { data: [], error: null },
        { data: caja, error: null },
      ],
    })
    render(<CajasBarrasPage client={falso.client} clubId="club-1" />)

    await userEvent.type(await screen.findByLabelText("Nueva barra"), "Barra principal")
    await userEvent.click(screen.getByRole("button", { name: "Agregar barra" }))
    expect(await screen.findByText("Barra principal", { selector: "li" })).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText("Nueva caja"), "Caja 1")
    await userEvent.click(screen.getByRole("button", { name: "Agregar caja" }))
    expect(await screen.findByText("Caja 1")).toBeInTheDocument()
    expect(screen.getByText("Vende desde: Barra principal")).toBeInTheDocument()

    expect(falso.inserciones).toEqual([
      {
        tabla: "inventory_locations",
        fila: { club_id: "club-1", name: "Barra principal", kind: "bar", active: true },
      },
      {
        tabla: "cash_registers",
        fila: { club_id: "club-1", name: "Caja 1", inventory_location_id: "loc-1", active: true },
      },
    ])
  })
})
