import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { crearClienteFalso, SESION_DE_PRUEBA } from "@/test/supabaseFalso"
import { ProductosPage } from "./ProductosPage"

const CLUB = "club-1"
const VASO = { id: "cat-vaso", name: "Vaso", sort_order: 0, active: true }
const TRAGOS = { id: "cat-tragos", name: "Tragos", sort_order: 10, active: true }
const DEPOSITO = { id: "dep-1", name: "Depósito", kind: "storage", active: true }
// Montos como numero: asi los manda Supabase.
const FERNET = { id: "p1", name: "Fernet", sku: null, category_id: "cat-vaso", cost: 1500, price: 6500, active: true }
const GIN = { id: "p2", name: "Gin tonic", sku: null, category_id: "cat-tragos", cost: 2000, price: 7000, active: true }
const AGUA = { id: "p3", name: "Agua", sku: null, category_id: null, cost: 300, price: 1500, active: true }

type Respuesta = { data: unknown; error: unknown }

function cliente(products: Respuesta[] = [], extra: Record<string, Respuesta[]> = {}) {
  return crearClienteFalso(SESION_DE_PRUEBA, {
    products: [{ data: [AGUA, FERNET, GIN], error: null }, ...products],
    product_categories: [{ data: [VASO, TRAGOS], error: null }],
    inventory_locations: [{ data: [DEPOSITO], error: null }],
    inventory_balances: [{ data: [{ location_id: "dep-1", product_id: "p1", quantity: 100 }], error: null }],
    ...extra,
  })
}

const filas = () => screen.getAllByRole("row").slice(1)

describe("Productos: filtro por categoria", () => {
  it("arriba de la lista: Todas, cada categoria y Sin categoria; filtra la tabla", async () => {
    const { client } = cliente()
    render(<ProductosPage client={client} clubId={CLUB} />)
    await screen.findByText("Fernet")

    const filtro = screen.getByRole("group", { name: "Filtrar por categoría" })
    const opciones = within(filtro)
      .getAllByRole("button")
      .map((b) => b.textContent)
    expect(opciones).toEqual(["Todas3", "Vaso1", "Tragos1", "Sin categoría1"])
    expect(within(filtro).getByRole("button", { name: "Todas" })).toHaveAttribute("aria-pressed", "true")
    expect(filas()).toHaveLength(3)

    await userEvent.click(within(filtro).getByRole("button", { name: "Vaso" }))
    expect(within(filtro).getByRole("button", { name: "Vaso" })).toHaveAttribute("aria-pressed", "true")
    expect(filas()).toHaveLength(1)
    expect(screen.getByText("Fernet")).toBeInTheDocument()
    expect(screen.queryByText("Gin tonic")).not.toBeInTheDocument()

    await userEvent.click(within(filtro).getByRole("button", { name: "Sin categoría" }))
    expect(filas()).toHaveLength(1)
    expect(screen.getByText("Agua")).toBeInTheDocument()

    await userEvent.click(within(filtro).getByRole("button", { name: "Todas" }))
    expect(filas()).toHaveLength(3)
  })
})

describe("Productos: acciones por producto", () => {
  it("cada producto tiene Editar, Cargar deposito e Inhabilitar", async () => {
    const { client } = cliente()
    render(<ProductosPage client={client} clubId={CLUB} />)
    await screen.findByText("Fernet")
    for (const nombre of ["Fernet", "Gin tonic", "Agua"]) {
      expect(screen.getByRole("button", { name: `Editar ${nombre}` })).toBeEnabled()
      expect(screen.getByRole("button", { name: `Cargar depósito de ${nombre}` })).toBeEnabled()
      expect(screen.getByRole("button", { name: `Inhabilitar ${nombre}` })).toBeEnabled()
    }
  })

  it("EDITAR: abre con los datos cargados y guarda solo las columnas permitidas", async () => {
    const editado = { ...FERNET, price: 7200.5, category_id: "cat-tragos" }
    const falso = cliente([{ data: editado, error: null }])
    render(<ProductosPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Editar Fernet" }))

    const dialogo = await screen.findByRole("dialog")
    expect(within(dialogo).getByLabelText("Nombre")).toHaveValue("Fernet")
    expect(within(dialogo).getByLabelText("Costo")).toHaveValue("1500")
    expect(within(dialogo).getByLabelText("Precio")).toHaveValue("6500")
    expect(within(dialogo).getByLabelText("Categoría")).toHaveValue("cat-vaso")

    await userEvent.clear(within(dialogo).getByLabelText("Precio"))
    await userEvent.type(within(dialogo).getByLabelText("Precio"), "7200.50")
    await userEvent.selectOptions(within(dialogo).getByLabelText("Categoría"), "cat-tragos")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar cambios" }))

    const escritura = falso.escrituras.find((e) => e.tabla === "products" && e.operacion === "update")!
    expect(escritura.fila).toEqual({
      name: "Fernet",
      sku: null,
      category_id: "cat-tragos",
      cost: "1500",
      price: "7200.50",
      units_per_box: null,
    })
    expect(escritura.filtros).toContainEqual({ metodo: "eq", args: ["id", "p1"] })
    expect(await screen.findByText("$7.200,50")).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("EDITAR: un precio invalido no guarda nada", async () => {
    const falso = cliente()
    render(<ProductosPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Editar Fernet" }))
    const dialogo = await screen.findByRole("dialog")
    await userEvent.clear(within(dialogo).getByLabelText("Precio"))
    await userEvent.type(within(dialogo).getByLabelText("Precio"), "abc")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar cambios" }))
    expect(within(dialogo).getByText(/Ingresá un precio válido/)).toBeInTheDocument()
    expect(falso.escrituras).toEqual([])
  })

  it("EDITAR: nombre repetido muestra el aviso", async () => {
    const falso = cliente([
      { data: null, error: { message: 'duplicate key value violates unique constraint "uq_products_club_name"' } },
    ])
    render(<ProductosPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Editar Fernet" }))
    const dialogo = await screen.findByRole("dialog")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar cambios" }))
    expect(await within(dialogo).findByText("Ya hay un producto con ese nombre en este club.")).toBeInTheDocument()
  })

  it("INHABILITAR y volver a HABILITAR: solo cambia active", async () => {
    const falso = cliente([
      { data: { ...FERNET, active: false }, error: null },
      { data: FERNET, error: null },
    ])
    render(<ProductosPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Inhabilitar Fernet" }))

    expect(falso.escrituras[0].fila).toEqual({ active: false })
    expect(falso.escrituras[0].filtros).toContainEqual({ metodo: "eq", args: ["id", "p1"] })
    expect(await screen.findByText("Inhabilitado")).toBeInTheDocument()
    // inhabilitado no se carga al deposito: ni boton ni fila clickeable
    expect(screen.queryByRole("button", { name: "Cargar depósito de Fernet" })).not.toBeInTheDocument()
    await userEvent.click(screen.getByText("Inhabilitado"))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Habilitar Fernet" }))
    expect(falso.escrituras[1].fila).toEqual({ active: true })
    expect(await screen.findByRole("button", { name: "Inhabilitar Fernet" })).toBeInTheDocument()
  })

  it("CARGAR DEPOSITO: carga ese producto en el deposito como compra (ya tiene stock)", async () => {
    const falso = cliente([], {
      inventory_balances: [
        { data: [{ location_id: "dep-1", product_id: "p1", quantity: 100 }], error: null },
        { data: [{ location_id: "dep-1", product_id: "p1", quantity: 124 }], error: null },
      ],
    })
    render(<ProductosPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Cargar depósito de Fernet" }))

    const dialogo = await screen.findByRole("dialog")
    expect(within(dialogo).getByText("Cargar depósito: Fernet")).toBeInTheDocument()
    expect(within(dialogo).getByLabelText("Tipo")).toHaveValue("purchase")
    // el producto ya esta elegido: no se pregunta
    expect(within(dialogo).queryByLabelText("Producto")).not.toBeInTheDocument()
    await userEvent.type(within(dialogo).getByLabelText("Cantidad de unidades"), "24")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Registrar" }))

    const [fila] = falso.escrituras.find((e) => e.tabla === "inventory_movements")!.fila as Record<string, unknown>[]
    expect(fila).toEqual({
      club_id: CLUB,
      product_id: "p1",
      note: null,
      location_id: "dep-1",
      movement_type: "purchase",
      quantity: 24,
    })
    expect(await screen.findByLabelText("Stock de Fernet en depósito: 124")).toBeInTheDocument()
    // nadie escribe el saldo
    expect(falso.escrituras.filter((e) => e.tabla === "inventory_balances")).toEqual([])
  })

  it("CARGAR DEPOSITO: siempre propone Compra / reposicion, aunque no tenga stock", async () => {
    const { client } = cliente()
    render(<ProductosPage client={client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Cargar depósito de Gin tonic" }))
    const dialogo = await screen.findByRole("dialog")
    expect(within(dialogo).getByLabelText("Tipo")).toHaveValue("purchase")
    // Stock inicial sigue disponible
    expect(within(dialogo).getByRole("option", { name: "Stock inicial" })).toBeInTheDocument()
  })

  it("CARGAR DEPOSITO: sin deposito la fila no abre nada", async () => {
    const { client } = cliente([], { inventory_locations: [{ data: [], error: null }] })
    render(<ProductosPage client={client} clubId={CLUB} />)
    await userEvent.click(await screen.findByText("Fernet"))
    expect(screen.queryByRole("button", { name: "Cargar depósito de Fernet" })).not.toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("CARGAR DEPOSITO: tocar cualquier parte de la fila abre el modal", async () => {
    const { client } = cliente()
    render(<ProductosPage client={client} clubId={CLUB} />)
    // el precio, el stock, la categoria: cualquier celda
    await userEvent.click(await screen.findByText("$6.500,00"))
    expect(within(await screen.findByRole("dialog")).getByText("Cargar depósito: Fernet")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    await userEvent.click(screen.getByLabelText("Stock de Gin tonic en depósito: 0"))
    expect(within(await screen.findByRole("dialog")).getByText("Cargar depósito: Gin tonic")).toBeInTheDocument()
  })

  it("Editar e Inhabilitar no abren Cargar depósito", async () => {
    const falso = cliente([{ data: { ...FERNET, active: false }, error: null }])
    render(<ProductosPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Editar Fernet" }))
    expect(within(await screen.findByRole("dialog")).getByText("Editar producto: Fernet")).toBeInTheDocument()
    expect(screen.queryByText("Cargar depósito: Fernet")).not.toBeInTheDocument()
    await userEvent.keyboard("{Escape}")
    await userEvent.click(screen.getByRole("button", { name: "Inhabilitar Fernet" }))
    expect(await screen.findByText("Inhabilitado")).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("ya no hay boton general Cargar stock", async () => {
    const { client } = cliente()
    render(<ProductosPage client={client} clubId={CLUB} />)
    await screen.findByText("Fernet")
    expect(screen.queryByRole("button", { name: "Cargar stock" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Cargar stock/ })).not.toBeInTheDocument()
  })
})
