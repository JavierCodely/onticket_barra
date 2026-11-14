import { render as renderBase, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { crearClienteFalso, SESION_DE_PRUEBA } from "@/test/supabaseFalso"
import { ThemeProvider } from "@/features/theme/ThemeProvider"
import { PanelAdmin } from "./PanelAdmin"

function render(ui: React.ReactElement) {
  return renderBase(<ThemeProvider>{ui}</ThemeProvider>)
}

const ADMIN = { data: { id: "admin-1" }, error: null }
const SIN_ADMIN = { data: null, error: null }
const CLUB_CENTRO = {
  id: "club-1",
  name: "Club Centro",
  slug: "club-centro",
  timezone: "America/Argentina/Buenos_Aires",
  business_day_start_hour: 12,
  active: true,
}

function titulosDelMenu(nombre: string) {
  const menu = screen.getByRole("list", { name: nombre })
  return within(menu)
    .getAllByRole("button")
    .map((b) => b.textContent)
}

describe("PanelAdmin", () => {
  it("sin club muestra Dashboard, Clubs y Logs, y abre en Clubs", async () => {
    const { client } = crearClienteFalso(SESION_DE_PRUEBA, { platform_admins: [ADMIN] })
    render(<PanelAdmin client={client} authUserId="auth-admin-1" />)

    expect(titulosDelMenu("Menú de Plataforma")).toEqual([
      "DashboardEn desarrollo",
      "Clubs",
      "LogsEn desarrollo",
    ])
    expect(await screen.findByText("Todavía no hay clubs. Creá el primero.")).toBeInTheDocument()
  })

  it("un administrador abre Mi perfil y ve su nombre", async () => {
    const perfil = { id: "admin-1", email: "ana@test.com", full_name: "Ana Perez", first_name: "Ana", last_name: "Perez", phone: null }
    const { client } = crearClienteFalso(SESION_DE_PRUEBA, {
      platform_admins: [ADMIN, { data: perfil, error: null }],
    })
    render(<PanelAdmin client={client} authUserId="auth-admin-1" />)
    await userEvent.click(await screen.findByRole("button", { name: "Mi perfil" }))
    expect(await screen.findByDisplayValue("Perez")).toBeInTheDocument()
  })

  it("quien no es administrador de plataforma no ve Mi perfil", async () => {
    const { client } = crearClienteFalso(SESION_DE_PRUEBA, { platform_admins: [SIN_ADMIN] })
    render(<PanelAdmin client={client} authUserId="auth-encargado" />)
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole("button", { name: "Mi perfil" })).not.toBeInTheDocument()
  })

  it("cada club tiene su paleta: entrar la aplica, salir vuelve a la de Onticket, otro club usa la suya", async () => {
    const OTRO = { ...CLUB_CENTRO, id: "club-2", name: "Club Norte", slug: "club-norte" }
    const { client } = crearClienteFalso(SESION_DE_PRUEBA, {
      platform_admins: [ADMIN],
      clubs: [{ data: [CLUB_CENTRO, OTRO], error: null }],
      club_settings: [{ data: { palette: "esmeralda" }, error: null }, { data: { palette: "rosa" }, error: null }],
    })
    render(<PanelAdmin client={client} authUserId="auth-admin-1" />)
    const raiz = document.documentElement

    await userEvent.click(await screen.findByRole("button", { name: /Club Centro/ }))
    await waitFor(() => expect(raiz.dataset.palette).toBe("esmeralda"))

    await userEvent.click(screen.getByRole("button", { name: "Todos los clubs" }))
    await waitFor(() => expect(raiz.dataset.palette).toBeUndefined())

    await userEvent.click(await screen.findByRole("button", { name: /Club Norte/ }))
    await waitFor(() => expect(raiz.dataset.palette).toBe("rosa"))
  })

  it("recargar vuelve al mismo club y la misma seccion", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, {
      platform_admins: [ADMIN, ADMIN],
      clubs: [{ data: [CLUB_CENTRO], error: null }, { data: [CLUB_CENTRO], error: null }],
    })
    const { unmount } = render(<PanelAdmin client={falso.client} authUserId="auth-admin-1" />)
    await userEvent.click(await screen.findByRole("button", { name: /Club Centro/ }))
    await userEvent.click(screen.getByRole("button", { name: "Historial" }))
    expect(window.location.hash).toBe("#/club/club-1/historial")
    unmount()

    // "Recarga": el panel arranca de cero con la misma direccion
    render(<PanelAdmin client={falso.client} authUserId="auth-admin-1" />)
    expect(await screen.findByRole("heading", { name: "Historial", level: 1 })).toBeInTheDocument()
    expect(screen.getByRole("list", { name: "Menú de Club Centro" })).toBeInTheDocument()
  })

  it("una direccion con un club que no se ve (otro administrador o borrado) vuelve a la lista de clubs", async () => {
    window.history.replaceState(null, "", "/#/club/club-ajeno/ventas")
    const { client } = crearClienteFalso(SESION_DE_PRUEBA, {
      platform_admins: [ADMIN],
      clubs: [{ data: [CLUB_CENTRO], error: null }],
    })
    render(<PanelAdmin client={client} authUserId="auth-admin-1" />)
    expect(await screen.findByRole("button", { name: /Club Centro/ })).toBeInTheDocument()
    expect(screen.getByRole("list", { name: "Menú de Plataforma" })).toBeInTheDocument()
    expect(window.location.hash).toBe("#/clubs")
  })

  it("Atras del navegador vuelve a la seccion anterior; cerrar sesion borra la direccion", async () => {
    const { client } = crearClienteFalso(SESION_DE_PRUEBA, {
      platform_admins: [ADMIN],
      clubs: [{ data: [CLUB_CENTRO], error: null }],
    })
    render(<PanelAdmin client={client} authUserId="auth-admin-1" />)
    await userEvent.click(await screen.findByRole("button", { name: /Club Centro/ }))
    await userEvent.click(screen.getByRole("button", { name: "Historial" }))
    window.history.replaceState(null, "", "/#/club/club-1/dashboard")
    window.dispatchEvent(new PopStateEvent("popstate"))
    expect(await screen.findByText(/Esta sección todavía no tiene datos/)).toBeInTheDocument()

    window.history.replaceState(null, "", "/#/clubs")
    window.dispatchEvent(new PopStateEvent("popstate"))
    expect(await screen.findByRole("list", { name: "Menú de Plataforma" })).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }))
    expect(window.location.hash).toBe("")
  })

  it("Dashboard y Logs muestran el aviso de en desarrollo", async () => {
    const { client } = crearClienteFalso(SESION_DE_PRUEBA, { platform_admins: [ADMIN] })
    render(<PanelAdmin client={client} authUserId="auth-admin-1" />)

    await userEvent.click(screen.getByRole("button", { name: /^Logs/ }))
    expect(screen.getByText(/Esta sección todavía no tiene datos/)).toBeInTheDocument()
  })

  it("crea un club enviando solo las columnas permitidas y lo muestra en la lista", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, {
      platform_admins: [ADMIN],
      clubs: [{ data: [], error: null }, { data: CLUB_CENTRO, error: null }],
    })
    render(<PanelAdmin client={falso.client} authUserId="auth-admin-1" />)

    await userEvent.click(await screen.findByRole("button", { name: "Nuevo club" }))
    await userEvent.type(screen.getByLabelText("Nombre"), "Club Centro")
    expect(screen.getByLabelText("Identificador (slug)")).toHaveValue("club-centro")
    await userEvent.click(screen.getByRole("button", { name: "Crear club" }))

    expect(await screen.findByRole("button", { name: /Club Centro/ })).toBeInTheDocument()
    // Contrato de CLAUDE.md, seccion 5: clubs admite estas columnas y ninguna mas.
    expect(falso.inserciones).toEqual([
      {
        tabla: "clubs",
        fila: {
          created_by_admin_id: "admin-1",
          name: "Club Centro",
          slug: "club-centro",
          timezone: "America/Argentina/Buenos_Aires",
          business_day_start_hour: 12,
        },
      },
    ])
  })

  it("no envia el club si el formulario es invalido", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, { platform_admins: [ADMIN] })
    render(<PanelAdmin client={falso.client} authUserId="auth-admin-1" />)

    await userEvent.click(await screen.findByRole("button", { name: "Nuevo club" }))
    await userEvent.click(screen.getByRole("button", { name: "Crear club" }))

    expect(screen.getByText("Ingresá el nombre del club.")).toBeInTheDocument()
    expect(falso.inserciones).toEqual([])
  })

  it("un usuario que no es administrador no puede crear clubs", async () => {
    const { client } = crearClienteFalso(SESION_DE_PRUEBA, { platform_admins: [SIN_ADMIN] })
    render(<PanelAdmin client={client} authUserId="auth-admin-1" />)

    expect(await screen.findByText(/no es administrador de la plataforma/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Nuevo club" })).not.toBeInTheDocument()
  })

  it("al abrir un club muestra su menu en el orden pedido y permite volver", async () => {
    const { client } = crearClienteFalso(SESION_DE_PRUEBA, {
      platform_admins: [ADMIN],
      clubs: [{ data: [CLUB_CENTRO], error: null }],
    })
    render(<PanelAdmin client={client} authUserId="auth-admin-1" />)

    await userEvent.click(await screen.findByRole("button", { name: /Club Centro/ }))

    expect(titulosDelMenu("Menú de Club Centro")).toEqual([
      "DashboardEn desarrollo",
      "Ventas",
      "Productos",
      "Stock en barra",
      "Inicio y cierre",
      "Combos",
      "Promociones",
      "Cajas/Barras",
      "Impuestos",
      "Personal",
      "Historial",
      "Configuración",
    ])
    expect(screen.getByText(/Esta sección todavía no tiene datos/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Todos los clubs" }))
    expect(screen.getByRole("list", { name: "Menú de Plataforma" })).toBeInTheDocument()
  })

  it("con un club abierto aparece el boton maestro: Iniciar noche, o Parar noche si hay una en curso", async () => {
    const sinNoche = crearClienteFalso(SESION_DE_PRUEBA, {
      platform_admins: [ADMIN],
      clubs: [{ data: [CLUB_CENTRO], error: null }],
    })
    const { unmount } = render(<PanelAdmin client={sinNoche.client} authUserId="auth-admin-1" />)
    expect(screen.queryByRole("button", { name: "Iniciar noche" })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole("button", { name: /Club Centro/ }))
    expect(await screen.findByRole("button", { name: "Iniciar noche" })).toBeInTheDocument()
    // se escucha en vivo si otro encargado inicia o para la noche
    expect(sinNoche.canales.some((c) => c.tablas.includes("club_nights"))).toBe(true)
    unmount()
    window.history.replaceState(null, "", "/") // otra sesion, desde la lista de clubs

    const conNoche = crearClienteFalso(SESION_DE_PRUEBA, {
      platform_admins: [ADMIN],
      clubs: [{ data: [CLUB_CENTRO], error: null }],
      club_nights: [{ data: { id: "n1", started_at: "2026-11-13T23:00:00Z", ended_at: null }, error: null }],
    })
    render(<PanelAdmin client={conNoche.client} authUserId="auth-admin-1" />)
    await userEvent.click(await screen.findByRole("button", { name: /Club Centro/ }))
    expect(await screen.findByRole("button", { name: "Parar noche" })).toBeInTheDocument()
  })

  it("Personal consulta solo el personal del club abierto y sin columnas secretas", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, {
      platform_admins: [ADMIN],
      clubs: [{ data: [CLUB_CENTRO], error: null }],
      users: [
        {
          data: [
            {
              id: "u1",
              full_name: "Ana Pérez",
              role: "cashier",
              active: true,
              username: "ana",
              email: null,
            },
          ],
          error: null,
        },
      ],
    })
    render(<PanelAdmin client={falso.client} authUserId="auth-admin-1" />)

    await userEvent.click(await screen.findByRole("button", { name: /Club Centro/ }))
    await userEvent.click(screen.getByRole("button", { name: "Personal" }))

    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument()
    expect(screen.getByText("Cajero")).toBeInTheDocument()

    const consultasUsers = falso.consultas.filter((c) => c.tabla === "users")
    expect(consultasUsers).toContainEqual({ tabla: "users", metodo: "eq", args: ["club_id", "club-1"] })
    const columnas = String(consultasUsers.find((c) => c.metodo === "select")?.args[0])
    for (const secreto of ["pin_hash", "failed_attempts", "locked_until", "*"]) {
      expect(columnas).not.toContain(secreto)
    }
  })

  it("cerrar sesion llama a signOut", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, { platform_admins: [ADMIN] })
    render(<PanelAdmin client={falso.client} authUserId="auth-admin-1" />)

    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }))
    expect(falso.signOut).toHaveBeenCalledTimes(1)
  })
})
