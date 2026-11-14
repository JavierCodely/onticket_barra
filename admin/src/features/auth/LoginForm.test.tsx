import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"
import {
  LoginForm,
  MENSAJE_CREDENCIALES,
  MENSAJE_ERROR_GENERICO,
} from "./LoginForm"

function crearCliente(signInWithPassword: ReturnType<typeof vi.fn>) {
  return { auth: { signInWithPassword } } as unknown as SupabaseClient
}

describe("LoginForm", () => {
  it("muestra los campos de email, contraseña y el boton Ingresar", () => {
    render(<LoginForm client={crearCliente(vi.fn())} />)

    expect(screen.getByLabelText("Email")).toBeInTheDocument()
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Ingresar" })).toBeEnabled()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("envia email y contraseña cargados a signInWithPassword", async () => {
    const signIn = vi.fn().mockResolvedValue({ error: null })
    render(<LoginForm client={crearCliente(signIn)} />)

    await userEvent.type(screen.getByLabelText("Email"), "admin@club.com")
    await userEvent.type(screen.getByLabelText("Contraseña"), "clave-secreta")
    await userEvent.click(screen.getByRole("button", { name: "Ingresar" }))

    expect(signIn).toHaveBeenCalledWith({
      email: "admin@club.com",
      password: "clave-secreta",
    })
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("con credenciales incorrectas muestra el mensaje generico", async () => {
    const signIn = vi
      .fn()
      .mockResolvedValue({ error: { status: 400, message: "Invalid login credentials" } })
    render(<LoginForm client={crearCliente(signIn)} />)

    await userEvent.type(screen.getByLabelText("Email"), "x@y.com")
    await userEvent.type(screen.getByLabelText("Contraseña"), "mal")
    await userEvent.click(screen.getByRole("button", { name: "Ingresar" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(MENSAJE_CREDENCIALES)
    // No revela detalles internos del error de Supabase.
    expect(screen.queryByText("Invalid login credentials")).not.toBeInTheDocument()
  })

  it("ante un error de red muestra un mensaje generico", async () => {
    const signIn = vi.fn().mockRejectedValue(new Error("network down"))
    render(<LoginForm client={crearCliente(signIn)} />)

    await userEvent.click(screen.getByRole("button", { name: "Ingresar" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(MENSAJE_ERROR_GENERICO)
    expect(screen.getByRole("button", { name: "Ingresar" })).toBeEnabled()
  })

  it("deshabilita el boton mientras se espera la respuesta", async () => {
    let resolver: (v: unknown) => void = () => {}
    const signIn = vi.fn(() => new Promise((r) => (resolver = r)))
    render(<LoginForm client={crearCliente(signIn)} />)

    await userEvent.click(screen.getByRole("button", { name: "Ingresar" }))

    expect(screen.getByRole("button", { name: "Ingresando..." })).toBeDisabled()
    resolver({ error: null })
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Ingresar" })).toBeEnabled(),
    )
  })
})
