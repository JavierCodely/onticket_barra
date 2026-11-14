import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { crearClienteFalso, SESION_DE_PRUEBA } from "@/test/supabaseFalso"
import { formatearFechaHora } from "@/lib/formato"
import { armarFilasInicioCierre, autorDeRecarga, jornadaDe } from "@/lib/inicio-cierre"
import type { FotoStock, Noche, Recarga } from "@/lib/datos"
import { InicioCierrePage } from "./InicioCierrePage"

const CLUB = { id: "club-1", timezone: "America/Argentina/Buenos_Aires", business_day_start_hour: 12 }

// Viernes 13/11 22:00 (Buenos Aires) a sabado 06:00; y la del viernes anterior.
const NOCHE = { id: "n2", started_at: "2026-11-14T01:00:00Z", ended_at: "2026-11-14T09:00:00Z" }
const NOCHE_VIEJA = { id: "n1", started_at: "2026-11-07T01:00:00Z", ended_at: "2026-11-07T09:00:00Z" }
const ABIERTA: Noche = { id: "n3", started_at: "2026-11-15T01:00:00Z", ended_at: null }

const CERVEZAS = { id: "c1", name: "Cervezas", sort_order: 1, active: true }
const TRAGOS = { id: "c2", name: "Tragos", sort_order: 2, active: true }
const prod = (id: string, name: string, category_id: string | null) => ({
  id, name, sku: null, category_id, cost: "1.00", price: "2.00", image_url: null, active: true,
})
const PRODUCTOS = [prod("p1", "Corona", "c1"), prod("p2", "Fernet", "c2")]
const BARRA = { id: "l1", name: "Barra principal", kind: "bar", active: true }
const BARRA_VIP = { id: "l3", name: "Barra VIP", kind: "bar", active: true }
const DEPOSITO = { id: "l2", name: "Depósito", kind: "storage", active: true }
const PERSONAL = [{ id: "u1", full_name: "Juan Barra", role: "bartender", active: true, username: "juan", email: null }]

const foto = (location_id: string, product_id: string, kind: FotoStock["kind"], quantity: number): FotoStock => ({
  location_id, product_id, kind, quantity,
})
const recarga = (id: string, location_id: string, product_id: string, quantity: number, extra: Partial<Recarga> = {}): Recarga => ({
  id, location_id, product_id, quantity, occurred_at: "2026-11-14T02:00:00Z", note: "Carga de barra",
  actor_type: "user", actor_id: "u1", ...extra,
})

const FOTOS = [
  foto("l1", "p1", "opening", 10),
  foto("l1", "p1", "closing", 4),
  foto("l1", "p2", "opening", 5),
  foto("l1", "p2", "closing", 5),
  foto("l3", "p1", "opening", 99),
]
const RECARGAS = [
  recarga("m1", "l1", "p1", 24),
  recarga("m2", "l1", "p1", 12, { occurred_at: "2026-11-14T04:30:00Z", actor_type: "platform_admin", actor_id: "a1" }),
  recarga("m3", "l2", "p1", 6), // devolucion al deposito: no es de la barra
]

function cliente(noches: Noche[] = [NOCHE, NOCHE_VIEJA], extra: Record<string, { data: unknown; error: unknown }[]> = {}) {
  return crearClienteFalso(SESION_DE_PRUEBA, {
    club_nights: [{ data: noches, error: null }],
    products: [{ data: PRODUCTOS, error: null }],
    product_categories: [{ data: [CERVEZAS, TRAGOS], error: null }],
    inventory_locations: [{ data: [BARRA, DEPOSITO, BARRA_VIP], error: null }],
    users: [{ data: PERSONAL, error: null }],
    night_stock_snapshots: [{ data: FOTOS, error: null }],
    inventory_movements: [{ data: RECARGAS, error: null }],
    ...extra,
  })
}

const fila = (nombre: string) => screen.getByRole("button", { name: `Ver detalle de ${nombre}` }).closest("tr")!
const celdas = (nombre: string) => within(fila(nombre)).getAllByRole("cell").map((c) => c.textContent)

describe("inicio y cierre: armado de filas", () => {
  it("inicio y cierre salen de las fotos; dos recargas se suman y conservan su detalle", () => {
    const filas = armarFilasInicioCierre("l1", FOTOS, RECARGAS, [], false)
    const corona = filas.find((f) => f.productId === "p1")!
    expect([corona.inicio, corona.recarga, corona.cierre]).toEqual([10, 36, 4])
    expect(corona.recargas.map((r) => r.id)).toEqual(["m1", "m2"])
    expect(filas.find((f) => f.productId === "p2")).toMatchObject({ inicio: 5, recarga: 0, cierre: 5 })
  })

  it("solo cuenta la barra elegida", () => {
    const vip = armarFilasInicioCierre("l3", FOTOS, RECARGAS, [], false)
    expect(vip).toEqual([{ productId: "p1", inicio: 99, recarga: 0, cierre: 0, recargas: [] }])
  })

  it("noche en curso: el cierre es el saldo actual, no una foto", () => {
    const saldos = [
      { location_id: "l1", product_id: "p1", quantity: 30 },
      { location_id: "l2", product_id: "p1", quantity: 500 },
    ]
    const filas = armarFilasInicioCierre("l1", FOTOS, RECARGAS, saldos, true)
    expect(filas.find((f) => f.productId === "p1")!.cierre).toBe(30)
    expect(filas.find((f) => f.productId === "p2")!.cierre).toBe(0)
  })

  it("un producto sin stock al iniciar pero recargado aparece con inicio 0", () => {
    const filas = armarFilasInicioCierre("l1", [], [recarga("m9", "l1", "p2", 8)], [], false)
    expect(filas).toMatchObject([{ productId: "p2", inicio: 0, recarga: 8 }])
  })

  it("jornada: la noche que empieza despues de medianoche pertenece al dia anterior (regla 27)", () => {
    expect(jornadaDe("2026-11-14T01:00:00Z", CLUB.timezone, 12)).toBe("2026-11-13") // vie 22:00
    expect(jornadaDe("2026-11-14T06:00:00Z", CLUB.timezone, 12)).toBe("2026-11-13") // sab 03:00
    expect(jornadaDe("2026-11-14T16:00:00Z", CLUB.timezone, 12)).toBe("2026-11-14") // sab 13:00
    expect(jornadaDe("2026-11-14T06:00:00Z", "Zona/Inventada", 0)).toBe("2026-11-14")
  })

  it("autor: personal por nombre, administrador por rol", () => {
    const gente = new Map([["u1", "Juan Barra"]])
    expect(autorDeRecarga({ actor_type: "user", actor_id: "u1" }, gente)).toBe("Juan Barra")
    expect(autorDeRecarga({ actor_type: "platform_admin", actor_id: "a1" }, gente)).toBe("Administrador")
    expect(autorDeRecarga({ actor_type: "user", actor_id: "zz" }, gente)).toBe("Usuario dado de baja")
    expect(autorDeRecarga({ actor_type: null, actor_id: null }, gente)).toBe("Sistema")
    // Con el nombre que da club_admin_names (archivo 19)
    expect(autorDeRecarga({ actor_type: "platform_admin", actor_id: "a1" }, gente, new Map([["a1", "Ana Perez"]]))).toBe(
      "Ana Perez",
    )
  })
})

describe("Inicio y cierre (pantalla)", () => {
  it("muestra la ultima noche y la primera barra: PRODUCTO - INICIO - RECARGA - CIERRE", async () => {
    const falso = cliente()
    render(<InicioCierrePage client={falso.client} club={CLUB} nocheAbierta={null} />)

    expect(await screen.findByRole("button", { name: "Ver detalle de Corona" })).toBeInTheDocument()
    expect(screen.getByLabelText("Fecha (jornada)")).toHaveValue("2026-11-13")
    expect(screen.getByRole("button", { name: "Barra principal" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Producto", "Inicio", "Recarga", "Cierre"])
    expect(celdas("Corona")).toEqual(["CoronaCervezas", "10", "+36", "4"])
    expect(celdas("Fernet")).toEqual(["FernetTragos", "5", "—", "5"])
    expect(screen.getByText("Noche cerrada")).toBeInTheDocument()
  })

  it("lee solo las recargas (transfer_in) del club dentro del horario de la noche", async () => {
    const falso = cliente()
    render(<InicioCierrePage client={falso.client} club={CLUB} nocheAbierta={null} />)
    await screen.findByRole("button", { name: "Ver detalle de Corona" })

    const filtros = falso.consultas.filter((c) => c.tabla === "inventory_movements").map((c) => [c.metodo, ...c.args])
    expect(filtros).toEqual(
      expect.arrayContaining([
        ["eq", "club_id", "club-1"],
        ["eq", "movement_type", "transfer_in"],
        ["gte", "occurred_at", NOCHE.started_at],
        ["lte", "occurred_at", NOCHE.ended_at],
      ]),
    )
    expect(falso.consultas).toContainEqual({ tabla: "night_stock_snapshots", metodo: "eq", args: ["night_id", "n2"] })
    expect(falso.escrituras).toEqual([]) // solo lectura
  })

  it("al tocar el producto se ve cada recarga: hora, quien y cantidad", async () => {
    render(<InicioCierrePage client={cliente().client} club={CLUB} nocheAbierta={null} />)
    await userEvent.click(await screen.findByRole("button", { name: "Ver detalle de Corona" }))

    const dialogo = await screen.findByRole("dialog")
    const items = within(dialogo).getAllByRole("listitem")
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent("Juan Barra")
    expect(items[0]).toHaveTextContent(formatearFechaHora("2026-11-14T02:00:00Z"))
    expect(items[0]).toHaveTextContent("+24")
    expect(items[1]).toHaveTextContent("Administrador")
    expect(items[1]).toHaveTextContent(formatearFechaHora("2026-11-14T04:30:00Z"))
    expect(items[1]).toHaveTextContent("+12")
  })

  it("tocar cualquier parte de la fila tambien abre el detalle", async () => {
    render(<InicioCierrePage client={cliente().client} club={CLUB} nocheAbierta={null} />)
    await screen.findByRole("button", { name: "Ver detalle de Fernet" })
    await userEvent.click(within(fila("Fernet")).getAllByRole("cell")[3])
    expect(await screen.findByText("No hubo recargas de este producto en la noche.")).toBeInTheDocument()
  })

  it("filtra por categoria", async () => {
    render(<InicioCierrePage client={cliente().client} club={CLUB} nocheAbierta={null} />)
    await screen.findByRole("button", { name: "Ver detalle de Corona" })
    await userEvent.click(within(screen.getByRole("group", { name: "Filtrar por categoría" })).getByRole("button", { name: /Tragos/ }))
    expect(screen.queryByRole("button", { name: "Ver detalle de Corona" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Ver detalle de Fernet" })).toBeInTheDocument()
  })

  it("cada barra tiene lo suyo", async () => {
    render(<InicioCierrePage client={cliente().client} club={CLUB} nocheAbierta={null} />)
    await screen.findByRole("button", { name: "Ver detalle de Corona" })
    await userEvent.click(screen.getByRole("button", { name: "Barra VIP" }))
    expect(celdas("Corona")).toEqual(["CoronaCervezas", "99", "—", "0"])
    expect(screen.queryByRole("button", { name: "Ver detalle de Fernet" })).not.toBeInTheDocument()
  })

  it("filtrar por fecha cambia la noche y vuelve a leer", async () => {
    const falso = cliente()
    render(<InicioCierrePage client={falso.client} club={CLUB} nocheAbierta={null} />)
    await screen.findByRole("button", { name: "Ver detalle de Corona" })

    fireEvent.change(screen.getByLabelText("Fecha (jornada)"), { target: { value: "2026-11-06" } })
    expect(screen.getByLabelText("Noche")).toHaveValue("n1")
    expect(await screen.findByText("Esta barra no tuvo stock ni recargas en esta noche.")).toBeInTheDocument()
    expect(falso.consultas).toContainEqual({ tabla: "night_stock_snapshots", metodo: "eq", args: ["night_id", "n1"] })

    fireEvent.change(screen.getByLabelText("Fecha (jornada)"), { target: { value: "2026-10-01" } })
    expect(screen.getByText("No hay noches en esa fecha. Elegí otra.")).toBeInTheDocument()
  })

  it("noche en curso: el cierre es el stock de ahora", async () => {
    const falso = cliente([ABIERTA, NOCHE], {
      night_stock_snapshots: [{ data: [foto("l1", "p1", "opening", 10)], error: null }],
      inventory_movements: [{ data: [recarga("m1", "l1", "p1", 24)], error: null }],
      inventory_balances: [{ data: [{ location_id: "l1", product_id: "p1", quantity: 31 }], error: null }],
    })
    render(<InicioCierrePage client={falso.client} club={CLUB} nocheAbierta={ABIERTA} />)

    expect(await screen.findByText("Noche en curso")).toBeInTheDocument()
    expect(await screen.findByRole("columnheader", { name: "Cierre (ahora)" })).toBeInTheDocument()
    expect(celdas("Corona")).toEqual(["CoronaCervezas", "10", "+24", "31"])
    expect(falso.consultas.some((c) => c.tabla === "inventory_movements" && c.metodo === "lte")).toBe(false)
  })

  it("sin noches avisa que hay que iniciar una", async () => {
    render(<InicioCierrePage client={cliente([]).client} club={CLUB} nocheAbierta={null} />)
    expect(await screen.findByText(/Todavía no se inició ninguna noche/)).toBeInTheDocument()
  })

  it("si falla la lectura muestra el error", async () => {
    const falso = cliente(undefined, { night_stock_snapshots: [{ data: null, error: { message: "permiso" } }] })
    render(<InicioCierrePage client={falso.client} club={CLUB} nocheAbierta={null} />)
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar el inicio y cierre de la noche.")
  })
})
