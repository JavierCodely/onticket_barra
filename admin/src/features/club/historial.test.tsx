import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { crearClienteFalso, SESION_DE_PRUEBA } from "@/test/supabaseFalso"
import { MiPerfil } from "@/features/perfil/MiPerfil"
import { HistorialPage } from "./HistorialPage"

const CLUB = { id: "club-1", timezone: "America/Argentina/Buenos_Aires" }
const ok = (data: unknown) => ({ data, error: null })

const CAMBIO_PRECIO = {
  id: "e1",
  club_id: "club-1",
  occurred_at: "2026-11-14T13:05:00Z", // 10:05 en Buenos Aires
  local_date: "2026-11-14",
  actor_type: "platform_admin",
  actor_id: "a1",
  actor_name: null,
  action: "product.updated",
  entity_type: "product",
  entity_id: "p1",
  entity_name: "Corona",
  details: { price: { from: 5000, to: 5500 } },
}
const COMPRA = {
  ...CAMBIO_PRECIO,
  id: "e2",
  occurred_at: "2026-11-13T23:40:00Z",
  local_date: "2026-11-13",
  actor_type: "user",
  actor_id: "u1",
  actor_name: "Marta Encargada",
  action: "stock.purchase",
  details: { location_id: "l2", quantity: 24, note: null },
}

beforeEach(() => {
  // Sabado 14/11/2026 12:00 en Buenos Aires. Solo el reloj: los timers son reales.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-14T15:00:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

function preparar(extra: Record<string, { data: unknown; error: unknown }[]> = {}) {
  return crearClienteFalso(SESION_DE_PRUEBA, {
    "rpc:club_activity_by_day": [ok([{ day: "2026-11-14", changes: 1 }, { day: "2026-11-13", changes: "1" }])],
    "rpc:club_activity": [ok([CAMBIO_PRECIO, COMPRA]), ok([COMPRA])],
    "rpc:club_admin_names": [ok([{ admin_id: "a1", full_name: "Ana Perez" }])],
    inventory_locations: [ok([{ id: "l2", name: "Depósito", kind: "storage", active: true }])],
    ...extra,
  })
}

describe("Historial", () => {
  it("lista que se hizo, quien (tambien el nombre del administrador) y a que hora del club", async () => {
    const falso = preparar()
    render(<HistorialPage client={falso.client} club={CLUB} />)

    const sabado = await screen.findByRole("region", { name: "sábado 14/11/2026" })
    expect(within(sabado).getByText("Editó el producto «Corona»")).toBeInTheDocument()
    expect(within(sabado).getByText("Precio: $5.000,00 → $5.500,00")).toBeInTheDocument()
    expect(within(sabado).getByText("por Ana Perez")).toBeInTheDocument()
    expect(within(sabado).getByText("10:05")).toBeInTheDocument()

    const viernes = screen.getByRole("region", { name: "viernes 13/11/2026" })
    expect(within(viernes).getByText("Registró una compra de «Corona»")).toBeInTheDocument()
    expect(within(viernes).getByText("24 unidades en Depósito")).toBeInTheDocument()
    expect(within(viernes).getByText("por Marta Encargada")).toBeInTheDocument()
    expect(within(viernes).getByText("20:40")).toBeInTheDocument()

    // Por defecto, los ultimos 7 dias; el calendario, el mes en curso
    expect(falso.rpcs.find((r) => r.nombre === "club_activity")?.args).toEqual({
      p_club_id: "club-1",
      p_from: "2026-11-08",
      p_to: "2026-11-14",
      p_limit: 500,
    })
    expect(falso.rpcs.find((r) => r.nombre === "club_activity_by_day")?.args).toEqual({
      p_club_id: "club-1",
      p_from: "2026-11-01",
      p_to: "2026-11-14",
    })
    expect(screen.getByRole("heading", { name: "noviembre de 2026" })).toBeInTheDocument()
    expect(screen.getByText("2 cambios en el mes")).toBeInTheDocument()
  })

  it("tocar un dia del calendario filtra ese dia", async () => {
    const falso = preparar()
    render(<HistorialPage client={falso.client} club={CLUB} />)
    await screen.findByText("Editó el producto «Corona»")

    const grilla = screen.getByRole("group", { name: "Cambios por día del mes" })
    // Solo el mes en curso: 14 dias que se pueden tocar (los que vienen, no)
    expect(within(grilla).getAllByRole("button")).toHaveLength(14)
    expect(within(grilla).queryByRole("button", { name: /octubre|\/10\// })).not.toBeInTheDocument()
    const cuadro = within(grilla).getByRole("button", { name: "1 cambio el viernes 13/11/2026" })
    await userEvent.click(cuadro)

    expect(screen.getByLabelText("Desde")).toHaveValue("2026-11-13")
    expect(screen.getByLabelText("Hasta")).toHaveValue("2026-11-13")
    expect(cuadro).toHaveAttribute("aria-pressed", "true")
    await waitFor(() => expect(screen.queryByText("Editó el producto «Corona»")).not.toBeInTheDocument())
    expect(falso.rpcs.filter((r) => r.nombre === "club_activity").at(-1)?.args).toMatchObject({
      p_from: "2026-11-13",
      p_to: "2026-11-13",
    })
    expect(screen.getByText("Registró una compra de «Corona»")).toBeInTheDocument()
    // Los dias que vienen no son cuadros
    expect(within(grilla).queryByRole("button", { name: /domingo 15\/11\/2026/ })).not.toBeInTheDocument()
  })

  it("rango al reves: avisa y no consulta; dia sin cambios", async () => {
    const falso = preparar({ "rpc:club_activity": [ok([])] })
    render(<HistorialPage client={falso.client} club={CLUB} />)
    expect(await screen.findByText("Sin cambios en esas fechas.")).toBeInTheDocument()
    const antes = falso.rpcs.filter((r) => r.nombre === "club_activity").length

    await userEvent.clear(screen.getByLabelText("Desde"))
    await userEvent.type(screen.getByLabelText("Desde"), "2026-11-20")
    expect(await screen.findByText(/posterior a/)).toBeInTheDocument()
    expect(falso.rpcs.filter((r) => r.nombre === "club_activity").length).toBe(antes)
  })

  it("sin permiso o sin red: muestra el error", async () => {
    const falso = preparar({ "rpc:club_activity": [{ data: null, error: { message: "permission denied" } }] })
    render(<HistorialPage client={falso.client} club={CLUB} />)
    expect(await screen.findByText("No se pudo cargar el historial.")).toBeInTheDocument()
  })

  it("si no llegan los nombres de administradores, se muestra el rol", async () => {
    const falso = preparar({ "rpc:club_admin_names": [{ data: null, error: { message: "x" } }] })
    render(<HistorialPage client={falso.client} club={CLUB} />)
    expect(await screen.findByText("por Administrador")).toBeInTheDocument()
  })
})

describe("Mi perfil", () => {
  const PERFIL = {
    id: "admin-1",
    email: "ana@test.com",
    full_name: "Ana Perez",
    first_name: "Ana",
    last_name: "Perez",
    phone: null,
  }

  it("carga los datos, guarda solo nombre, apellido y telefono, y el email no se edita", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, {
      platform_admins: [ok(PERFIL), ok({ ...PERFIL, phone: "+54 9 11 5555-0000" })],
    })
    render(<MiPerfil client={falso.client} authUserId="auth-1" abierto onCerrar={() => undefined} />)

    expect(await screen.findByDisplayValue("Ana")).toBeInTheDocument()
    expect(screen.getByLabelText("Email")).toHaveValue("ana@test.com")
    expect(screen.getByLabelText("Email")).toBeDisabled()

    await userEvent.type(screen.getByLabelText("Teléfono"), "+54 9 11 5555-0000")
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }))

    expect(await screen.findByText("Perfil guardado.")).toBeInTheDocument()
    expect(falso.escrituras).toEqual([
      expect.objectContaining({
        tabla: "platform_admins",
        operacion: "update",
        fila: { first_name: "Ana", last_name: "Perez", phone: "+54 9 11 5555-0000" },
      }),
    ])
  })

  it("con datos invalidos no guarda", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, { platform_admins: [ok(PERFIL)] })
    render(<MiPerfil client={falso.client} authUserId="auth-1" abierto onCerrar={() => undefined} />)
    await screen.findByDisplayValue("Ana")
    await userEvent.clear(screen.getByLabelText("Nombre"))
    await userEvent.type(screen.getByLabelText("Teléfono"), "llamame")
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }))
    expect(screen.getByText("Escribí tu nombre.")).toBeInTheDocument()
    expect(screen.getByText(/Solo números/)).toBeInTheDocument()
    expect(falso.escrituras).toEqual([])
  })
})
