import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { crearClienteFalso, SESION_DE_PRUEBA } from "@/test/supabaseFalso"
import { mismoMonto, planificarPreciosBarra, type PrecioBarra } from "@/lib/precios-barra"
import { ProductosPage } from "./ProductosPage"

const CLUB = "club-1"
// Montos como numero: asi los manda Supabase.
const CORONA = { id: "p1", name: "Corona", sku: null, category_id: null, cost: 1000, price: 5000, image_url: null, active: true }
const BARRA = { id: "l1", name: "Barra principal", kind: "bar", active: true }
const VIP = { id: "l3", name: "Barra VIP", kind: "bar", active: true }
const VIEJA = { id: "l4", name: "Barra vieja", kind: "bar", active: false }
const DEPOSITO = { id: "l2", name: "Depósito", kind: "storage", active: true }
const PRECIO_VIP: PrecioBarra = { id: "pb1", product_id: "p1", location_id: "l3", price: 7000 }

type Respuesta = { data: unknown; error: unknown }

function cliente(precios: Respuesta[] = [{ data: [PRECIO_VIP], error: null }]) {
  return crearClienteFalso(SESION_DE_PRUEBA, {
    products: [{ data: [CORONA], error: null }],
    inventory_locations: [{ data: [BARRA, DEPOSITO, VIP, VIEJA], error: null }],
    product_location_prices: precios,
  })
}

async function abrirEditar() {
  await userEvent.click(await screen.findByRole("button", { name: "Editar Corona" }))
  return screen.findByRole("dialog")
}

const escrituras = (falso: ReturnType<typeof cliente>) =>
  falso.escrituras.filter((e) => e.tabla === "product_location_prices")

describe("precio por barra: que se agrega, cambia o borra", () => {
  const actuales: PrecioBarra[] = [PRECIO_VIP, { id: "pb2", product_id: "p1", location_id: "l1", price: "5500.00" }]

  it("casilla nueva -> insertar; distinta -> actualizar; vacia -> borrar; igual -> nada", () => {
    const plan = planificarPreciosBarra("p1", actuales, { l3: "7500", l1: "", l9: "6000,50" })
    expect(plan).toEqual({
      ok: true,
      valor: { insertar: [{ location_id: "l9", price: "6000.50" }], actualizar: [{ id: "pb1", price: "7500" }], borrar: ["pb2"] },
    })
    expect(planificarPreciosBarra("p1", actuales, { l3: "7000.00", l1: "5500" })).toEqual({
      ok: true,
      valor: { insertar: [], actualizar: [], borrar: [] },
    })
  })

  it("solo mira los precios del producto que se edita", () => {
    const otro: PrecioBarra = { id: "pb9", product_id: "p2", location_id: "l3", price: 1 }
    const plan = planificarPreciosBarra("p1", [otro], { l3: "" })
    expect(plan.ok && plan.valor.borrar).toEqual([])
  })

  it("rechaza precios invalidos, por barra", () => {
    for (const mal of ["-1", "abc", "1.234", "99999999999"]) {
      expect(planificarPreciosBarra("p1", [], { l3: mal })).toEqual({
        ok: false,
        errores: { l3: "Precio inválido (ej: 7000 o 7000.50)." },
      })
    }
  })

  it("compara montos sin importar si llegan como numero o texto", () => {
    expect(mismoMonto(7000, "7000.00")).toBe(true)
    expect(mismoMonto("7000.5", 7000.5)).toBe(true)
    expect(mismoMonto(7000, "7000.01")).toBe(false)
  })
})

describe("Productos: precio por barra", () => {
  it("la lista muestra el precio general y, debajo, el de cada barra", async () => {
    render(<ProductosPage client={cliente().client} clubId={CLUB} />)
    const fila = (await screen.findByText("Corona")).closest("tr")!
    expect(fila).toHaveTextContent("$5.000,00")
    expect(fila).toHaveTextContent("Barra VIP: $7.000,00")
  })

  it("Editar tiene una casilla por barra activa (no depositos); vacia = precio general", async () => {
    render(<ProductosPage client={cliente().client} clubId={CLUB} />)
    const dialogo = await abrirEditar()
    const seccion = within(dialogo).getByRole("region", { name: "Precio por barra" })
    expect(within(seccion).getByLabelText("Barra VIP")).toHaveValue("7000")
    expect(within(seccion).getByLabelText("Barra principal")).toHaveValue("")
    expect(within(seccion).getByLabelText("Barra principal")).toHaveAttribute("placeholder", "5000")
    expect(within(seccion).queryByLabelText(/Depósito/)).not.toBeInTheDocument()
    expect(within(seccion).queryByLabelText(/Barra vieja/)).not.toBeInTheDocument()
  })

  it("asignar un precio a la Barra VIP: inserta solo club, producto, barra y precio", async () => {
    const falso = cliente([{ data: [], error: null }, { data: null, error: null }, { data: [PRECIO_VIP], error: null }])
    render(<ProductosPage client={falso.client} clubId={CLUB} />)
    const dialogo = await abrirEditar()
    const seccion = within(dialogo).getByRole("region", { name: "Precio por barra" })

    await userEvent.type(within(seccion).getByLabelText("Barra VIP"), "7000")
    await userEvent.click(within(seccion).getByRole("button", { name: "Guardar precios por barra" }))

    expect(await within(seccion).findByText("Precios por barra guardados.")).toBeInTheDocument()
    expect(escrituras(falso)).toEqual([
      {
        tabla: "product_location_prices",
        operacion: "insert",
        fila: [{ club_id: CLUB, product_id: "p1", location_id: "l3", price: "7000" }],
        filtros: [],
      },
    ])
    // La lista ya muestra el precio nuevo
    expect(screen.getByText("Corona").closest("tr")).toHaveTextContent("Barra VIP: $7.000,00")
  })

  it("cambiar el precio actualiza solo price; vaciar la casilla borra la fila (vuelve el general)", async () => {
    const falso = cliente([
      { data: [PRECIO_VIP], error: null }, // lista
      { data: null, error: null }, // update
      { data: [{ ...PRECIO_VIP, price: 7500 }], error: null }, // relectura
      { data: null, error: null }, // delete
      { data: [], error: null }, // relectura
    ])
    render(<ProductosPage client={falso.client} clubId={CLUB} />)
    const dialogo = await abrirEditar()
    const seccion = within(dialogo).getByRole("region", { name: "Precio por barra" })
    const vip = within(seccion).getByLabelText("Barra VIP")
    const guardar = within(seccion).getByRole("button", { name: "Guardar precios por barra" })

    await userEvent.clear(vip)
    await userEvent.type(vip, "7500")
    await userEvent.click(guardar)
    await within(seccion).findByText("Precios por barra guardados.")

    await userEvent.clear(vip)
    await userEvent.click(guardar)
    await within(seccion).findByText("Precios por barra guardados.")

    const [cambio, borrado] = escrituras(falso)
    expect(cambio).toMatchObject({ operacion: "update", fila: { price: "7500" }, filtros: [{ metodo: "eq", args: ["id", "pb1"] }] })
    expect(borrado).toMatchObject({ operacion: "delete", filtros: [{ metodo: "in", args: ["id", ["pb1"]] }] })
    expect(screen.getByText("Corona").closest("tr")).not.toHaveTextContent("Barra VIP")
  })

  it("un precio invalido no se guarda y avisa en la barra", async () => {
    const falso = cliente()
    render(<ProductosPage client={falso.client} clubId={CLUB} />)
    const dialogo = await abrirEditar()
    const seccion = within(dialogo).getByRole("region", { name: "Precio por barra" })
    await userEvent.type(within(seccion).getByLabelText("Barra principal"), "abc")
    await userEvent.click(within(seccion).getByRole("button", { name: "Guardar precios por barra" }))
    expect(within(seccion).getByRole("alert")).toHaveTextContent("Precio inválido")
    expect(within(seccion).getByLabelText("Barra principal")).toHaveAttribute("aria-invalid", "true")
    expect(escrituras(falso)).toEqual([])
  })

  it("si la base rechaza el cambio, lo dice", async () => {
    const falso = cliente([{ data: [], error: null }, { data: null, error: { message: "permission denied" } }])
    render(<ProductosPage client={falso.client} clubId={CLUB} />)
    const dialogo = await abrirEditar()
    const seccion = within(dialogo).getByRole("region", { name: "Precio por barra" })
    await userEvent.type(within(seccion).getByLabelText("Barra VIP"), "7000")
    await userEvent.click(within(seccion).getByRole("button", { name: "Guardar precios por barra" }))
    expect(await within(seccion).findByRole("alert")).toHaveTextContent("No se pudieron guardar los precios por barra")
  })

  it("si no se pueden leer los precios por barra, la lista de productos se ve igual", async () => {
    render(<ProductosPage client={cliente([{ data: null, error: { message: "no existe" } }]).client} clubId={CLUB} />)
    const fila = (await screen.findByText("Corona")).closest("tr")!
    expect(fila).toHaveTextContent("$5.000,00")
    const dialogo = await abrirEditar()
    expect(within(dialogo).getByText("No se pudieron cargar los precios por barra.")).toBeInTheDocument()
  })

  it("una barra inactiva con precio aparece, para poder quitarlo", async () => {
    const viejo: PrecioBarra = { id: "pb4", product_id: "p1", location_id: "l4", price: 4000 }
    render(<ProductosPage client={cliente([{ data: [viejo], error: null }]).client} clubId={CLUB} />)
    const dialogo = await abrirEditar()
    expect(within(dialogo).getByLabelText(/Barra vieja/)).toHaveValue("4000")
  })
})
