import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { Session, SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"
import App from "./App"
import { crearClienteFalso, SESION_DE_PRUEBA } from "@/test/supabaseFalso"

function crearCliente(sesion: Session | null) {
  const signOut = vi.fn().mockResolvedValue({ error: null })
  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: sesion } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      signInWithPassword: vi.fn(),
      signOut,
    },
  } as unknown as SupabaseClient
  return { client, signOut }
}

describe("App", () => {
  it("sin variables de entorno muestra la falta de configuracion", () => {
    render(<App client={null} />)

    expect(screen.getByText("Falta la configuración")).toBeInTheDocument()
    expect(screen.getByText(/VITE_SUPABASE_URL/)).toBeInTheDocument()
  })

  it("muestra el boton de modo oscuro en la barra superior", async () => {
    const { client } = crearCliente(null)
    render(<App client={client} />)

    expect(await screen.findByRole("button", { name: "Activar modo oscuro" })).toBeInTheDocument()
  })

  it("sin sesion muestra el login", async () => {
    const { client } = crearCliente(null)
    render(<App client={client} />)

    expect(await screen.findByRole("button", { name: "Ingresar" })).toBeInTheDocument()
  })

  it("con sesion existente muestra el panel con su menu y permite cerrar sesion", async () => {
    const { client, signOut } = crearClienteFalso(SESION_DE_PRUEBA)
    render(<App client={client} />)

    expect(await screen.findByRole("list", { name: "Menú de Plataforma" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Ingresar" })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }))
    expect(signOut).toHaveBeenCalledTimes(1)
  })
})
