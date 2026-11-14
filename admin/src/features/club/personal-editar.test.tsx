import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { crearClienteFalso, errorDeFuncion, SESION_DE_PRUEBA, type RespuestaFalsa } from "@/test/supabaseFalso"
import { PersonalPage } from "./PersonalPage"

const CLUB = "club-1"
const JUAN = { id: "u1", full_name: "Juan", role: "cashier", active: true, username: "juan", email: null }
const LUCIA = { id: "u2", full_name: "Lucía", role: "bartender", active: true, username: "lucia", email: null }
const ENC = { id: "u3", full_name: "Encargada", role: "club_admin", active: true, username: null, email: "e@x.com" }
const CAJA1 = { id: "k1", name: "Caja 1", inventory_location_id: "l1", active: true }
const CAJA2 = { id: "k2", name: "Caja 2", inventory_location_id: "l1", active: true }
const CAJA_VIEJA = { id: "k3", name: "Caja vieja", inventory_location_id: "l1", active: false }
const BARRA = { id: "l1", name: "Barra principal", kind: "bar", active: true }
const DEPOSITO = { id: "l2", name: "Depósito", kind: "storage", active: true }
const ASIG_JUAN = { id: "a1", user_id: "u1", cash_register_id: "k1", location_id: null }

function cliente(extra: Record<string, RespuestaFalsa[]> = {}, asignaciones = [ASIG_JUAN]) {
  return crearClienteFalso(SESION_DE_PRUEBA, {
    users: [{ data: [ENC, JUAN, LUCIA], error: null }],
    cash_registers: [{ data: [CAJA1, CAJA2, CAJA_VIEJA], error: null }],
    inventory_locations: [{ data: [BARRA, DEPOSITO], error: null }],
    ...extra,
    staff_assignments: [{ data: asignaciones, error: null }, ...(extra.staff_assignments ?? [])],
  })
}

async function abrirEdicion(nombre: string) {
  render(<PersonalPage client={(falsoActual as ReturnType<typeof cliente>).client} clubId={CLUB} />)
  await userEvent.click(await screen.findByRole("button", { name: `Editar ${nombre}` }))
  return screen.findByRole("dialog")
}
let falsoActual: ReturnType<typeof cliente> | null = null

describe("Personal: columna Asignado a", () => {
  it("muestra la caja del cajero, 'Sin asignar' y nada para el encargado", async () => {
    falsoActual = cliente()
    render(<PersonalPage client={falsoActual.client} clubId={CLUB} />)
    expect(await screen.findByLabelText("Juan asignado a: Caja 1")).toHaveTextContent("Caja 1")
    expect(screen.getByLabelText("Lucía asignado a: nada")).toHaveTextContent("Sin asignar")
    expect(screen.getByLabelText("Encargada asignado a: nada")).toHaveTextContent("—")
  })
})

describe("Personal: editar", () => {
  it("cambia el nombre por la Edge Function, solo con lo que cambió", async () => {
    falsoActual = cliente({ "fn:admin-update-user": [{ data: { ...JUAN, full_name: "Juan Pérez" }, error: null }] })
    const dialogo = await abrirEdicion("Juan")
    const nombre = within(dialogo).getByLabelText("Nombre")
    await userEvent.clear(nombre)
    await userEvent.type(nombre, "Juan Pérez")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar cambios" }))

    expect(await screen.findByRole("button", { name: "Editar Juan Pérez" })).toBeInTheDocument()
    expect(falsoActual.invocaciones).toEqual([
      { nombre: "admin-update-user", body: { club_id: CLUB, user_id: "u1", full_name: "Juan Pérez" } },
    ])
    // users no se escribe nunca desde el panel; la asignacion no cambio
    expect(falsoActual.escrituras).toEqual([])
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("desactivar manda solo active=false", async () => {
    falsoActual = cliente({ "fn:admin-update-user": [{ data: { ...LUCIA, active: false }, error: null }] })
    const dialogo = await abrirEdicion("Lucía")
    await userEvent.click(within(dialogo).getByRole("switch", { name: "Activo" }))
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar cambios" }))
    await screen.findByRole("button", { name: "Editar Lucía" })
    expect(falsoActual.invocaciones[0].body).toEqual({ club_id: CLUB, user_id: "u2", active: false })
  })

  it("nombre vacío: no llama a nada", async () => {
    falsoActual = cliente()
    const dialogo = await abrirEdicion("Juan")
    await userEvent.clear(within(dialogo).getByLabelText("Nombre"))
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar cambios" }))
    expect(await within(dialogo).findByText("Ingresá el nombre.")).toBeInTheDocument()
    expect(falsoActual.invocaciones).toEqual([])
  })

  it("muestra el error de la función y deja el diálogo abierto", async () => {
    falsoActual = cliente({
      "fn:admin-update-user": [errorDeFuncion(400, { error: "No podes desactivarte a vos mismo." })],
    })
    const dialogo = await abrirEdicion("Encargada")
    await userEvent.click(within(dialogo).getByRole("switch", { name: "Activo" }))
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar cambios" }))
    expect(await within(dialogo).findByRole("alert")).toHaveTextContent("No podes desactivarte a vos mismo.")
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("si la función no está desplegada en Supabase, lo dice en vez de un error genérico", async () => {
    falsoActual = cliente({
      // Respuesta de Supabase cuando la función no existe
      "fn:admin-update-user": [errorDeFuncion(404, { code: "NOT_FOUND", message: "Requested function was not found" })],
    })
    const dialogo = await abrirEdicion("Lucía")
    await userEvent.click(within(dialogo).getByRole("switch", { name: "Activo" }))
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar cambios" }))
    expect(await within(dialogo).findByRole("alert")).toHaveTextContent(
      "El servidor todavía no tiene la función admin-update-user. Falta desplegarla en Supabase.",
    )
  })

  it("sin conexión con la función (red o CORS), lo dice", async () => {
    falsoActual = cliente({
      "fn:admin-update-user": [{ data: null, error: { name: "FunctionsFetchError", context: new TypeError("Failed to fetch") } }],
    })
    const dialogo = await abrirEdicion("Lucía")
    await userEvent.click(within(dialogo).getByRole("switch", { name: "Activo" }))
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar cambios" }))
    expect(await within(dialogo).findByRole("alert")).toHaveTextContent(
      "No se pudo conectar con la función admin-update-user. Revisá la conexión o que esté desplegada en Supabase.",
    )
  })

  it("el encargado no tiene selector de rol ni de asignación", async () => {
    falsoActual = cliente()
    const dialogo = await abrirEdicion("Encargada")
    expect(within(dialogo).queryByLabelText("Rol")).not.toBeInTheDocument()
    expect(within(dialogo).queryByLabelText(/asignada/)).not.toBeInTheDocument()
    expect(within(dialogo).getByText(/El rol de un encargado no se/)).toBeInTheDocument()
  })
})

describe("Personal: asignar caja o barra", () => {
  it("cajero: ofrece solo cajas activas y cambia de caja con UPDATE", async () => {
    falsoActual = cliente({ staff_assignments: [{ data: { ...ASIG_JUAN, cash_register_id: "k2" }, error: null }] })
    const dialogo = await abrirEdicion("Juan")
    const selector = within(dialogo).getByLabelText("Caja asignada")
    const opciones = within(selector)
      .getAllByRole("option")
      .map((o) => o.textContent)
    expect(opciones).toEqual(["Sin asignar", "Caja 1", "Caja 2"]) // sin la inactiva ni barras
    await userEvent.selectOptions(selector, "k2")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar cambios" }))

    expect(await screen.findByLabelText("Juan asignado a: Caja 2")).toBeInTheDocument()
    expect(falsoActual.invocaciones).toEqual([]) // sin cambios en la persona
    const esc = falsoActual.escrituras
    expect(esc).toHaveLength(1)
    expect(esc[0]).toMatchObject({ tabla: "staff_assignments", operacion: "update" })
    expect(esc[0].fila).toEqual({ cash_register_id: "k2", location_id: null })
  })

  it("barra sin asignar: inserta con club, persona y barra", async () => {
    falsoActual = cliente({
      staff_assignments: [
        { data: { id: "a9", user_id: "u2", cash_register_id: null, location_id: "l1" }, error: null },
      ],
    })
    const dialogo = await abrirEdicion("Lucía")
    const selector = within(dialogo).getByLabelText("Barra asignada")
    expect(
      within(selector)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Sin asignar", "Barra principal"]) // el depósito no es una barra
    await userEvent.selectOptions(selector, "l1")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar cambios" }))

    expect(await screen.findByLabelText("Lucía asignado a: Barra principal")).toBeInTheDocument()
    expect(falsoActual.escrituras[0]).toMatchObject({ tabla: "staff_assignments", operacion: "insert" })
    expect(falsoActual.escrituras[0].fila).toEqual({
      club_id: CLUB,
      user_id: "u2",
      cash_register_id: null,
      location_id: "l1",
    })
  })

  it("quitar: 'Sin asignar' borra la asignación por id", async () => {
    falsoActual = cliente()
    const dialogo = await abrirEdicion("Juan")
    await userEvent.selectOptions(within(dialogo).getByLabelText("Caja asignada"), "")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar cambios" }))

    expect(await screen.findByLabelText("Juan asignado a: nada")).toBeInTheDocument()
    expect(falsoActual.escrituras).toHaveLength(1)
    expect(falsoActual.escrituras[0]).toMatchObject({ tabla: "staff_assignments", operacion: "delete" })
    expect(falsoActual.escrituras[0].filtros).toContainEqual({ metodo: "eq", args: ["id", "a1"] })
  })

  it("cambiar de cajero a barra: la base quitó la caja, se inserta la barra nueva", async () => {
    falsoActual = cliente({
      "fn:admin-update-user": [{ data: { ...JUAN, role: "bartender" }, error: null }],
      staff_assignments: [
        { data: { id: "a2", user_id: "u1", cash_register_id: null, location_id: "l1" }, error: null },
      ],
    })
    const dialogo = await abrirEdicion("Juan")
    await userEvent.selectOptions(within(dialogo).getByLabelText("Rol"), "bartender")
    // al cambiar el rol, la lista pasa a barras y arranca sin asignar
    const selector = within(dialogo).getByLabelText("Barra asignada")
    expect(selector).toHaveValue("")
    await userEvent.selectOptions(selector, "l1")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar cambios" }))

    expect(await screen.findByLabelText("Juan asignado a: Barra principal")).toBeInTheDocument()
    expect(falsoActual.invocaciones[0].body).toEqual({ club_id: CLUB, user_id: "u1", role: "bartender" })
    // insert (no update de la fila vieja, que la base ya borro)
    expect(falsoActual.escrituras).toHaveLength(1)
    expect(falsoActual.escrituras[0]).toMatchObject({ tabla: "staff_assignments", operacion: "insert" })
  })

  it("si falla la asignación lo dice, sin perder lo ya guardado", async () => {
    falsoActual = cliente({
      staff_assignments: [{ data: null, error: { code: "23514", message: "no es una barra activa" } }],
    })
    const dialogo = await abrirEdicion("Lucía")
    await userEvent.selectOptions(within(dialogo).getByLabelText("Barra asignada"), "l1")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar cambios" }))
    expect(await within(dialogo).findByRole("alert")).toHaveTextContent("no se pudo cambiar la asignación")
    expect(screen.getByRole("dialog")).toBeInTheDocument() // sigue abierto para reintentar
    expect(screen.getByLabelText("Lucía asignado a: nada")).toBeInTheDocument()
  })
})
