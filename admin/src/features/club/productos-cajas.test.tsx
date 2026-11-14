import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { crearClienteFalso, SESION_DE_PRUEBA } from "@/test/supabaseFalso"
import { controlarCosto, notaDeCompra, unidadesDeCompra, validarPorCaja } from "@/lib/compra"
import { ProductosPage } from "./ProductosPage"

const CLUB = "club-1"
const DEPOSITO = { id: "dep-1", name: "Depósito", kind: "storage", active: true }
// Corona: viene en cajas de 6 y cuesta $1.000 la unidad.
const CORONA = { id: "p1", name: "Corona", sku: null, category_id: null, cost: 1000, price: 5000, active: true, units_per_box: 6 }
const AGUA = { id: "p2", name: "Agua", sku: null, category_id: null, cost: 300, price: 1500, active: true, units_per_box: null }

type Respuesta = { data: unknown; error: unknown }

function cliente(products: Respuesta[] = []) {
  return crearClienteFalso(SESION_DE_PRUEBA, {
    products: [{ data: [AGUA, CORONA], error: null }, ...products],
    inventory_locations: [{ data: [DEPOSITO], error: null }],
    inventory_balances: [{ data: [{ location_id: "dep-1", product_id: "p1", quantity: 10 }], error: null }],
  })
}

async function abrirCarga(nombre: string) {
  await userEvent.click(await screen.findByRole("button", { name: `Cargar depósito de ${nombre}` }))
  return screen.findByRole("dialog")
}

describe("compra: cuentas", () => {
  it("cajas a unidades, y la nota que queda en el libro", () => {
    expect(unidadesDeCompra("cajas", "2", 6)).toBe(12)
    expect(unidadesDeCompra("unidades", "2", 6)).toBe(2)
    expect(unidadesDeCompra("cajas", "0", 6)).toBeNull()
    expect(unidadesDeCompra("cajas", "1.5", 6)).toBeNull()
    expect(notaDeCompra("cajas", "2", 6, "")).toBe("2 cajas x 6")
    expect(notaDeCompra("cajas", "1", 6, " Proveedor X ")).toBe("1 caja x 6 · Proveedor X")
    expect(notaDeCompra("unidades", "2", 6, "Suelto")).toBe("Suelto")
  })

  it("total segun costo y comparacion con la factura (en centavos, sin float)", () => {
    const sinFactura = controlarCosto(1000, 12, 6, "")
    expect(sinFactura).toMatchObject({ costoUnidad: "1000.00", costoCaja: "6000.00", totalSegunCosto: "12000.00", sentido: null })

    expect(controlarCosto(1000, 12, 6, "13200")).toMatchObject({
      costoUnidadFactura: "1100.00", diferenciaUnidad: "100.00", variacion: "10 %", sentido: "subio",
    })
    expect(controlarCosto(1000, 12, 6, "10800,00")).toMatchObject({ costoUnidadFactura: "900.00", sentido: "bajo" })
    expect(controlarCosto(1000, 12, 6, "12000")).toMatchObject({ sentido: "igual" })
    // 100 / 3 = 33,333... -> 33,33
    expect(controlarCosto("33.33", 3, null, "100")).toMatchObject({ costoUnidadFactura: "33.33", sentido: "igual" })
    expect(controlarCosto(1000, 12, 6, "mucho").facturaInvalida).toBe(true)
    // Sin cantidad todavia no se compara
    expect(controlarCosto(1000, null, 6, "13200").costoUnidadFactura).toBeNull()
  })

  it("unidades por caja: de 2 a 1000; sin caja = null", () => {
    expect(validarPorCaja(false, "abc")).toEqual({ ok: true, valor: null })
    expect(validarPorCaja(true, "6")).toEqual({ ok: true, valor: 6 })
    expect(validarPorCaja(true, "1").ok).toBe(false)
    expect(validarPorCaja(true, "").ok).toBe(false)
  })
})

describe("Productos: viene por caja", () => {
  it("crear con 'Viene por caja' valida y guarda las unidades por caja", async () => {
    const creado = { ...AGUA, id: "p9", name: "Quilmes", units_per_box: 6 }
    const falso = cliente([{ data: creado, error: null }])
    render(<ProductosPage client={falso.client} clubId={CLUB} />)

    await userEvent.click(await screen.findByRole("button", { name: "Nuevo producto" }))
    await userEvent.type(screen.getByLabelText("Nombre"), "Quilmes")
    await userEvent.type(screen.getByLabelText("Precio"), "4000")
    await userEvent.click(screen.getByRole("checkbox", { name: /Viene por caja/ }))
    await userEvent.type(screen.getByLabelText("Unidades por caja"), "1")
    await userEvent.click(screen.getByRole("button", { name: "Crear producto" }))
    expect(screen.getByText("Ingresá cuántas unidades trae cada caja (de 2 a 1000).")).toBeInTheDocument()
    expect(falso.inserciones).toEqual([])

    await userEvent.clear(screen.getByLabelText("Unidades por caja"))
    await userEvent.type(screen.getByLabelText("Unidades por caja"), "6")
    await userEvent.click(screen.getByRole("button", { name: "Crear producto" }))
    expect(await screen.findByText("Quilmes")).toBeInTheDocument()
    expect(falso.inserciones[0].fila).toMatchObject({ name: "Quilmes", units_per_box: 6 })
    // La lista muestra la caja (Corona y Quilmes)
    expect(screen.getAllByText("Caja x 6")).toHaveLength(2)
  })
})

describe("Cargar depósito: compra por cajas y control del costo", () => {
  it("por defecto Compra y por Cajas: 2 cajas de 6 entran como 12 unidades", async () => {
    const falso = cliente()
    render(<ProductosPage client={falso.client} clubId={CLUB} />)
    const dialogo = await abrirCarga("Corona")

    expect(within(dialogo).getByLabelText("Tipo")).toHaveValue("purchase")
    expect(within(dialogo).getByRole("button", { name: "Cajas (x 6)" })).toHaveAttribute("aria-pressed", "true")
    await userEvent.type(within(dialogo).getByLabelText("Cantidad de cajas"), "2")
    expect(within(dialogo).getByTestId("unidades-de-cajas")).toHaveTextContent("= 12 unidades")

    const costo = within(dialogo).getByRole("region", { name: "Costo de compra" })
    expect(within(costo).getByText("$1.000,00")).toBeInTheDocument() // por unidad
    expect(within(costo).getByText("$6.000,00")).toBeInTheDocument() // por caja
    expect(within(costo).getByTestId("total-segun-costo")).toHaveTextContent("$12.000,00")

    await userEvent.click(within(dialogo).getByRole("button", { name: "Registrar" }))
    const [fila] = falso.escrituras.find((e) => e.tabla === "inventory_movements")!.fila as Record<string, unknown>[]
    expect(fila).toMatchObject({ movement_type: "purchase", quantity: 12, note: "2 cajas x 6", product_id: "p1" })
    // Sin factura no se toca el costo
    expect(falso.escrituras.filter((e) => e.tabla === "products")).toEqual([])
  })

  it("tambien por unidades sueltas", async () => {
    const falso = cliente()
    render(<ProductosPage client={falso.client} clubId={CLUB} />)
    const dialogo = await abrirCarga("Corona")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Unidades" }))
    await userEvent.type(within(dialogo).getByLabelText("Cantidad de unidades"), "5")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Registrar" }))
    const [fila] = falso.escrituras.find((e) => e.tabla === "inventory_movements")!.fila as Record<string, unknown>[]
    expect(fila).toMatchObject({ quantity: 5, note: null })
  })

  it("la factura dice que subio: avisa y, si se marca, actualiza solo el costo", async () => {
    const falso = cliente([{ data: { ...CORONA, cost: "1100.00" }, error: null }])
    render(<ProductosPage client={falso.client} clubId={CLUB} />)
    const dialogo = await abrirCarga("Corona")
    await userEvent.type(within(dialogo).getByLabelText("Cantidad de cajas"), "2")
    await userEvent.type(within(dialogo).getByLabelText("Total de la factura (opcional)"), "13200")

    const comparacion = within(dialogo).getByTestId("comparacion-factura")
    expect(comparacion).toHaveTextContent("cada unidad costó $1.100,00")
    expect(comparacion).toHaveTextContent("Subió $100,00 por unidad (10 %)")
    await userEvent.click(within(dialogo).getByRole("checkbox", { name: /Actualizar el costo del producto a \$1\.100,00/ }))
    await userEvent.click(within(dialogo).getByRole("button", { name: "Registrar" }))

    const costo = await escrituraDe(falso, "products")
    expect(costo.fila).toEqual({ cost: "1100.00" })
    expect(costo.filtros).toContainEqual({ metodo: "eq", args: ["id", "p1"] })
    expect(await screen.findByText("$1.100,00")).toBeInTheDocument() // la lista ya muestra el costo nuevo
  })

  it("la factura dice que bajo; si no se marca, el costo no cambia", async () => {
    const falso = cliente()
    render(<ProductosPage client={falso.client} clubId={CLUB} />)
    const dialogo = await abrirCarga("Corona")
    await userEvent.type(within(dialogo).getByLabelText("Cantidad de cajas"), "2")
    await userEvent.type(within(dialogo).getByLabelText("Total de la factura (opcional)"), "10800")
    expect(within(dialogo).getByTestId("comparacion-factura")).toHaveTextContent("Bajó $100,00 por unidad (10 %)")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Registrar" }))
    await screen.findByLabelText(/Stock de Corona en depósito/)
    expect(falso.escrituras.filter((e) => e.tabla === "products")).toEqual([])
  })

  it("un producto sin caja se carga por unidades, sin opcion de cajas", async () => {
    const { client } = cliente()
    render(<ProductosPage client={client} clubId={CLUB} />)
    const dialogo = await abrirCarga("Agua")
    expect(within(dialogo).queryByRole("button", { name: /Cajas/ })).not.toBeInTheDocument()
    expect(within(dialogo).getByLabelText("Cantidad de unidades")).toBeInTheDocument()
  })
})

// La escritura del costo llega despues de la del movimiento.
async function escrituraDe(falso: ReturnType<typeof crearClienteFalso>, tabla: string) {
  let encontrada: (typeof falso.escrituras)[number] | undefined
  await waitFor(() => {
    encontrada = falso.escrituras.find((e) => e.tabla === tabla && e.operacion === "update")
    expect(encontrada).toBeDefined()
  })
  return encontrada!
}
