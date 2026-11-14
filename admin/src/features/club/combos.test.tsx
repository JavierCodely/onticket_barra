import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { crearClienteFalso, SESION_DE_PRUEBA } from "@/test/supabaseFalso"
import {
  planificarComboItems,
  porcentaje,
  resumirCombo,
  validarCombo,
  type LineaCombo,
} from "@/lib/combos"
import { CombosPage } from "./CombosPage"

const CLUB = "club-1"
// Montos como numero: asi los manda Supabase.
const prod = (id: string, name: string, cost: number, price: number, extra = {}) => ({
  id, name, sku: null, category_id: null, cost, price, image_url: null, active: true, kind: "product", ...extra,
})
const FERNET = prod("p1", "Fernet", 1500, 6500)
const COCA = prod("p2", "Coca-Cola", 500, 2000)
const AGUA = prod("p3", "Agua", 300, 1500, { active: false })
const COMBO = { ...prod("c1", "Fernet con 2 Cocas", 2500, 9000), kind: "combo" }
const ITEMS = [
  { id: "i1", combo_id: "c1", product_id: "p1", quantity: 1, unit_price: 6000 },
  { id: "i2", combo_id: "c1", product_id: "p2", quantity: 2, unit_price: 1500 },
]
const VIP = { id: "l3", name: "Barra VIP", kind: "bar", active: true }

type Respuesta = { data: unknown; error: unknown }
const ok = (data: unknown): Respuesta => ({ data, error: null })

function cliente(extra: { products?: Respuesta[]; combo_items?: Respuesta[]; product_location_prices?: Respuesta[] } = {}, combos = [COMBO], items = ITEMS) {
  return crearClienteFalso(SESION_DE_PRUEBA, {
    // 1) combos  2) productos  y despues lo que prepare cada prueba
    products: [ok(combos), ok([AGUA, COCA, FERNET]), ...(extra.products ?? [])],
    combo_items: [ok(items), ...(extra.combo_items ?? [])],
    inventory_locations: [ok([VIP])],
    product_location_prices: [ok([{ id: "pb1", product_id: "c1", location_id: "l3", price: 10000 }]), ...(extra.product_location_prices ?? [])],
  })
}

const linea = (productId: string, cantidad: string, costo: number, normal: number, enCombo: string): LineaCombo => ({
  productId, nombre: productId, cantidad, costoUnitario: costo, precioNormalUnitario: normal, precioEnCombo: enCombo,
})

describe("combos: cuentas del formulario", () => {
  it("1 Fernet + 2 Cocas: costo, precio normal, precio del combo, margen y descuento", () => {
    const r = resumirCombo([linea("p1", "1", 1500, 6500, "6000"), linea("p2", "2", 500, 2000, "1500")])
    expect(r).toEqual({
      costo: "2500.00", // 1500 + 2 x 500
      precioNormal: "10500.00", // 6500 + 2 x 2000
      precioCombo: "9000.00", // 6000 + 2 x 1500
      margen: "6500.00",
      margenPorcentaje: "72,2 %", // 6500 / 9000
      descuento: "1500.00",
      descuentoPorcentaje: "14,3 %", // 1500 / 10500
    })
  })

  it("sin decimales de punto flotante y con montos en texto", () => {
    const r = resumirCombo([linea("p1", "3", 0.1, 0.1, "0.10"), linea("p2", "1", 0.2, 0.2, "0,20")])
    expect(r.precioCombo).toBe("0.50")
    expect(r.costo).toBe("0.50")
  })

  it("porcentajes: redondeo a la decima, sin total, y margen negativo", () => {
    expect(porcentaje(1n, 3n)).toBe("33,3 %")
    expect(porcentaje(1n, 2n)).toBe("50 %")
    expect(porcentaje(5n, 0n)).toBeNull()
    expect(porcentaje(-500n, 2000n)).toBe("-25 %")
  })

  it("valida nombre, al menos un producto, cantidad y precio por producto", () => {
    expect(validarCombo({ nombre: " ", sku: "", categoriaId: "", lineas: [] })).toEqual({
      ok: false,
      errores: { nombre: "Ingresá el nombre del combo.", lineas: "Agregá al menos un producto." },
    })
    const mal = validarCombo({ nombre: "X", sku: "", categoriaId: "", lineas: [linea("p1", "0", 1, 1, "abc")] })
    expect(mal).toEqual({
      ok: false,
      errores: { cantidad: { p1: "Cantidad de 1 a 1000." }, precio: { p1: "Precio inválido (ej: 4000 o 4000.50)." } },
    })
    expect(validarCombo({ nombre: " Combo ", sku: "", categoriaId: "c9", lineas: [linea("p1", "2", 1, 1, "4000,5")] })).toEqual({
      ok: true,
      valor: { name: "Combo", sku: null, category_id: "c9", items: [{ product_id: "p1", quantity: 2, unit_price: "4000.50" }] },
    })
  })

  it("plan de la composicion: agrega, cambia y quita solo lo necesario", () => {
    const plan = planificarComboItems(ITEMS, [
      { product_id: "p2", quantity: 3, unit_price: "1500.00" },
      { product_id: "p3", quantity: 1, unit_price: "1000.00" },
    ])
    expect(plan).toEqual({
      insertar: [{ product_id: "p3", quantity: 1, unit_price: "1000.00" }],
      actualizar: [{ id: "i2", quantity: 3, unit_price: "1500.00" }],
      borrar: ["i1"],
    })
    expect(planificarComboItems(ITEMS, [
      { product_id: "p1", quantity: 1, unit_price: "6000.00" },
      { product_id: "p2", quantity: 2, unit_price: "1500" },
    ])).toEqual({ insertar: [], actualizar: [], borrar: [] })
  })
})

describe("Combos (pantalla)", () => {
  it("lista cada combo con sus productos, costo, precio (y de barra) y margen", async () => {
    render(<CombosPage client={cliente().client} clubId={CLUB} />)
    const fila = (await screen.findByText("Fernet con 2 Cocas")).closest("tr")!
    expect(fila).toHaveTextContent("1 × Fernet")
    expect(fila).toHaveTextContent("2 × Coca-Cola")
    expect(fila).toHaveTextContent("$2.500,00")
    expect(fila).toHaveTextContent("$9.000,00")
    expect(fila).toHaveTextContent("Barra VIP: $10.000,00")
    expect(fila).toHaveTextContent("$6.500,00")
    expect(fila).toHaveTextContent("72,2 %")
    expect(within(fila).getByRole("button", { name: "Editar Fernet con 2 Cocas" })).toBeEnabled()
    expect(within(fila).getByRole("button", { name: "Inhabilitar Fernet con 2 Cocas" })).toBeEnabled()
  })

  it("lee combos y productos por separado (kind)", async () => {
    const falso = cliente()
    render(<CombosPage client={falso.client} clubId={CLUB} />)
    await screen.findByText("Fernet con 2 Cocas")
    const kinds = falso.consultas.filter((c) => c.tabla === "products" && c.metodo === "eq" && c.args[0] === "kind")
    expect(kinds.map((c) => c.args[1])).toEqual(["combo", "product"])
  })

  it("NUEVO COMBO: por producto muestra costo y precio normal (por cantidad), y abajo totales, margen y descuento", async () => {
    const creado = { ...COMBO, id: "c2", name: "Promo Fernet", price: 0, cost: 0 }
    const falso = cliente(
      { products: [ok(creado), ok({ ...creado, price: 9000, cost: 2500 })], combo_items: [ok(null), ok(ITEMS.map((i) => ({ ...i, combo_id: "c2" })))] },
      [],
      [],
    )
    render(<CombosPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Nuevo combo" }))
    const dialogo = await screen.findByRole("dialog")

    await userEvent.type(within(dialogo).getByLabelText("Nombre"), "Promo Fernet")
    // Solo productos activos en el catalogo (Agua esta inhabilitada)
    const catalogo = within(dialogo).getByRole("region", { name: "Catálogo de productos" })
    expect(within(catalogo).queryByText("Agua")).not.toBeInTheDocument()
    await userEvent.click(within(catalogo).getByRole("button", { name: "Agregar Fernet al combo" }))
    await userEvent.click(within(catalogo).getByRole("button", { name: "Agregar Coca-Cola al combo" }))
    // Ya agregado: el boton pasa a "Sacar"
    expect(within(catalogo).getByRole("button", { name: "Sacar Fernet del combo" })).toBeInTheDocument()

    // Por defecto el precio en el combo es el precio normal
    expect(within(dialogo).getByLabelText("Precio de Fernet en el combo")).toHaveValue("6500")
    await userEvent.clear(within(dialogo).getByLabelText("Precio de Fernet en el combo"))
    await userEvent.type(within(dialogo).getByLabelText("Precio de Fernet en el combo"), "6000")
    await userEvent.clear(within(dialogo).getByLabelText("Cantidad de Coca-Cola"))
    await userEvent.type(within(dialogo).getByLabelText("Cantidad de Coca-Cola"), "2")
    await userEvent.clear(within(dialogo).getByLabelText("Precio de Coca-Cola en el combo"))
    await userEvent.type(within(dialogo).getByLabelText("Precio de Coca-Cola en el combo"), "1500")

    const coca = within(dialogo).getByRole("listitem", { name: "Coca-Cola" })
    expect(within(coca).getByRole("group", { name: "Costo (× 2)" })).toHaveTextContent("$1.000,00")
    expect(within(coca).getByRole("group", { name: "Precio normal (× 2)" })).toHaveTextContent("$4.000,00")
    expect(coca).toHaveTextContent("En el combo: $3.000,00")

    const resumen = within(dialogo).getByRole("region", { name: "Resumen del combo" })
    expect(within(resumen).getByRole("group", { name: "Costo total" })).toHaveTextContent("$2.500,00")
    expect(within(resumen).getByRole("group", { name: "Precio normal total" })).toHaveTextContent("$10.500,00")
    expect(within(resumen).getByRole("group", { name: "Precio del combo" })).toHaveTextContent("$9.000,00")
    expect(within(resumen).getByRole("group", { name: "Margen" })).toHaveTextContent("$6.500,0072,2 %")
    expect(within(resumen).getByRole("group", { name: "Descuento" })).toHaveTextContent("$1.500,0014,3 %")

    await userEvent.click(within(dialogo).getByRole("button", { name: "Crear combo" }))

    expect(await screen.findByText("Promo Fernet")).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    const [alta, composicion] = falso.escrituras
    // El panel nunca pone el precio ni el costo del combo: los calcula la base
    expect(alta).toMatchObject({
      tabla: "products",
      operacion: "insert",
      fila: { club_id: CLUB, kind: "combo", name: "Promo Fernet", sku: null, category_id: null, price: "0", cost: "0", active: true },
    })
    expect(composicion).toMatchObject({
      tabla: "combo_items",
      operacion: "insert",
      fila: [
        { club_id: CLUB, combo_id: "c2", product_id: "p1", quantity: 1, unit_price: "6000.00" },
        { club_id: CLUB, combo_id: "c2", product_id: "p2", quantity: 2, unit_price: "1500.00" },
      ],
    })
    expect(screen.getByText("Promo Fernet").closest("tr")).toHaveTextContent("$9.000,00")
  })

  it("NUEVO COMBO ocupa toda la pantalla y el catalogo se filtra por categoria y por busqueda", async () => {
    const cervezas = { id: "k1", club_id: CLUB, name: "Cervezas", sort_order: 1, active: true }
    const bebidas = { id: "k2", club_id: CLUB, name: "Bebidas", sort_order: 2, active: true }
    const QUILMES = prod("p4", "Quilmes", 800, 3000, { category_id: "k1", sku: "QLM-1" })
    const falso = crearClienteFalso(SESION_DE_PRUEBA, {
      products: [ok([]), ok([QUILMES, COCA, FERNET].map((x) => (x === COCA ? { ...x, category_id: "k2" } : x)))],
      combo_items: [ok([])],
      inventory_locations: [ok([VIP])],
      product_location_prices: [ok([])],
      product_categories: [ok([cervezas, bebidas])],
    })
    render(<CombosPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Nuevo combo" }))
    const dialogo = await screen.findByRole("dialog")
    expect(dialogo.className).toMatch(/h-dvh/)
    expect(dialogo.className).toMatch(/max-w-none/)

    const catalogo = within(dialogo).getByRole("region", { name: "Catálogo de productos" })
    const nombres = () => within(catalogo).getAllByRole("listitem").map((li) => li.querySelector(".font-medium")?.textContent)
    expect(nombres()).toEqual(["Quilmes", "Coca-Cola", "Fernet"])
    expect(within(catalogo).getAllByRole("listitem")[0]).toHaveTextContent("Cervezas")

    await userEvent.click(within(catalogo).getByRole("button", { name: /^Cervezas/ }))
    expect(nombres()).toEqual(["Quilmes"])
    await userEvent.click(within(catalogo).getByRole("button", { name: /^Sin categoría/ }))
    expect(nombres()).toEqual(["Fernet"])
    await userEvent.click(within(catalogo).getByRole("button", { name: /^Todas/ }))

    await userEvent.type(within(catalogo).getByLabelText("Buscar producto"), "qlm")
    expect(nombres()).toEqual(["Quilmes"])
    await userEvent.clear(within(catalogo).getByLabelText("Buscar producto"))
    await userEvent.type(within(catalogo).getByLabelText("Buscar producto"), "zzz")
    expect(within(catalogo).getByText("Ningún producto coincide.")).toBeInTheDocument()

    // Agregar y sacar desde el catalogo actualiza la lista del combo
    await userEvent.clear(within(catalogo).getByLabelText("Buscar producto"))
    await userEvent.click(within(catalogo).getByRole("button", { name: "Agregar Quilmes al combo" }))
    expect(within(dialogo).getByRole("listitem", { name: "Quilmes" })).toBeInTheDocument()
    await userEvent.click(within(catalogo).getByRole("button", { name: "Sacar Quilmes del combo" }))
    expect(within(dialogo).queryByRole("listitem", { name: "Quilmes" })).not.toBeInTheDocument()
  })

  it("sin productos no se crea", async () => {
    const falso = cliente({}, [], [])
    render(<CombosPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Nuevo combo" }))
    const dialogo = await screen.findByRole("dialog")
    await userEvent.type(within(dialogo).getByLabelText("Nombre"), "Vacío")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Crear combo" }))
    expect(within(dialogo).getByRole("alert")).toHaveTextContent("Agregá al menos un producto.")
    expect(falso.escrituras).toEqual([])
  })

  it("si los productos no se guardan, el combo queda creado y lo avisa", async () => {
    const creado = { ...COMBO, id: "c2", name: "Promo", price: 0, cost: 0 }
    const falso = cliente({ products: [ok(creado)], combo_items: [{ data: null, error: { message: "x" } }] }, [], [])
    render(<CombosPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Nuevo combo" }))
    const dialogo = await screen.findByRole("dialog")
    await userEvent.type(within(dialogo).getByLabelText("Nombre"), "Promo")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Agregar Fernet al combo" }))
    await userEvent.click(within(dialogo).getByRole("button", { name: "Crear combo" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("El combo se creó, pero no se guardaron sus productos")
    expect(screen.getByText("Promo").closest("tr")).toHaveTextContent("Sin productos")
  })

  it("EDITAR: cambia nombre (nunca precio ni costo) y la composicion con lo minimo", async () => {
    const falso = cliente({
      products: [ok(null), ok({ ...COMBO, name: "Fernet + 3 Cocas", price: 10500, cost: 3000 })],
      combo_items: [ok(null), ok(null), ok([{ ...ITEMS[1], quantity: 3 }])],
    })
    render(<CombosPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Editar Fernet con 2 Cocas" }))
    const dialogo = await screen.findByRole("dialog")
    // Foto y precio por barra tambien estan en Editar
    expect(within(dialogo).getByRole("region", { name: "Foto del producto" })).toBeInTheDocument()
    expect(within(dialogo).getByLabelText("Barra VIP")).toHaveValue("10000")

    const nombre = within(dialogo).getByLabelText("Nombre")
    await userEvent.clear(nombre)
    await userEvent.type(nombre, "Fernet + 3 Cocas")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Quitar Fernet del combo" }))
    await userEvent.clear(within(dialogo).getByLabelText("Cantidad de Coca-Cola"))
    await userEvent.type(within(dialogo).getByLabelText("Cantidad de Coca-Cola"), "3")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar combo" }))

    expect(await screen.findByText("Fernet + 3 Cocas")).toBeInTheDocument()
    const [datos, borrado, cambio] = falso.escrituras
    expect(datos).toMatchObject({ tabla: "products", operacion: "update", fila: { name: "Fernet + 3 Cocas", sku: null, category_id: null } })
    expect(Object.keys(datos.fila as object)).not.toContain("price")
    expect(Object.keys(datos.fila as object)).not.toContain("cost")
    expect(borrado).toMatchObject({ tabla: "combo_items", operacion: "delete", filtros: [{ metodo: "in", args: ["id", ["i1"]] }] })
    expect(cambio).toMatchObject({ tabla: "combo_items", operacion: "update", fila: { quantity: 3, unit_price: "1500.00" } })
    expect(screen.getByText("Fernet + 3 Cocas").closest("tr")).toHaveTextContent("3 × Coca-Cola")
  })

  it("EDITAR: guardar el precio por barra solo guarda ese precio (no el combo) y el modal sigue abierto", async () => {
    const falso = cliente({
      product_location_prices: [ok(null), ok([{ id: "pb1", product_id: "c1", location_id: "l3", price: 12000 }])],
    })
    render(<CombosPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Editar Fernet con 2 Cocas" }))
    const dialogo = await screen.findByRole("dialog")
    // El editor de precio por barra no puede quedar dentro del formulario del combo
    expect(within(dialogo).getByLabelText("Barra VIP").closest("form")?.querySelector("button[type=submit]")).toHaveTextContent(
      "Guardar precios por barra",
    )

    await userEvent.clear(within(dialogo).getByLabelText("Barra VIP"))
    await userEvent.type(within(dialogo).getByLabelText("Barra VIP"), "12000")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar precios por barra" }))

    expect(await within(dialogo).findByRole("status")).toBeInTheDocument()
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(falso.escrituras).toMatchObject([
      { tabla: "product_location_prices", operacion: "update", fila: { price: "12000" } },
    ])
    expect(falso.escrituras.some((w) => w.tabla === "products" || w.tabla === "combo_items")).toBe(false)
  })

  it("inhabilitar un combo no lo borra", async () => {
    const falso = cliente({ products: [ok({ ...COMBO, active: false })] })
    render(<CombosPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Inhabilitar Fernet con 2 Cocas" }))
    expect(await screen.findByText("Inhabilitado")).toBeInTheDocument()
    expect(falso.escrituras).toMatchObject([{ tabla: "products", operacion: "update", fila: { active: false } }])
  })

  it("sin combos lo dice", async () => {
    render(<CombosPage client={cliente({}, [], []).client} clubId={CLUB} />)
    expect(await screen.findByText("Este club todavía no tiene combos.")).toBeInTheDocument()
  })
})
