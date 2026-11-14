import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { Input } from "@/components/ui/input"
import { crearClienteFalso, SESION_DE_PRUEBA } from "@/test/supabaseFalso"
import { ProductosPage } from "./ProductosPage"

const CLUB = "club-1"
const DEPOSITO = { id: "dep-1", name: "Depósito", kind: "storage", active: true }
const FERNET = { id: "p1", name: "Fernet", sku: null, category_id: null, cost: 1500, price: 6500, active: true }

function cliente(products: { data: unknown; error: unknown }[] = []) {
  return crearClienteFalso(SESION_DE_PRUEBA, {
    products: [{ data: [FERNET], error: null }, ...products],
    inventory_locations: [{ data: [DEPOSITO], error: null }],
  })
}

describe("campos sin autocompletado", () => {
  it("por defecto el navegador no sugiere lo escrito antes; quien lo necesite lo pide explicito", () => {
    render(
      <>
        <Input aria-label="cualquiera" />
        <Input aria-label="login" autoComplete="current-password" />
      </>,
    )
    expect(screen.getByLabelText("cualquiera")).toHaveAttribute("autocomplete", "off")
    expect(screen.getByLabelText("login")).toHaveAttribute("autocomplete", "current-password")
  })

  it("en los formularios de producto ningun campo autocompleta", async () => {
    const { client } = cliente()
    render(<ProductosPage client={client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Nuevo producto" }))
    const campos = within(screen.getByRole("dialog")).getAllByRole("textbox")
    expect(campos.length).toBeGreaterThan(2)
    for (const campo of campos) expect(campo).toHaveAttribute("autocomplete", "off")
  })
})

describe("Productos: modales", () => {
  it("Nuevo producto se abre en un modal y Cancelar lo cierra", async () => {
    const { client } = cliente()
    render(<ProductosPage client={client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Nuevo producto" }))
    const dialogo = screen.getByRole("dialog")
    expect(within(dialogo).getByRole("heading", { name: "Nuevo producto" })).toBeInTheDocument()
    expect(within(dialogo).getByRole("button", { name: "Crear producto" })).toBeInTheDocument()
    await userEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("al crear, el modal se cierra y el producto aparece en la lista", async () => {
    const creado = { ...FERNET, id: "p2", name: "Gin", units_per_box: null }
    const falso = cliente([{ data: creado, error: null }])
    render(<ProductosPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Nuevo producto" }))
    await userEvent.type(screen.getByLabelText("Nombre"), "Gin")
    await userEvent.type(screen.getByLabelText("Precio"), "7000")
    await userEvent.click(screen.getByRole("button", { name: "Crear producto" }))
    expect(await screen.findByText("Gin")).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("Editar ocupa toda la pantalla", async () => {
    const { client } = cliente()
    render(<ProductosPage client={client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Editar Fernet" }))
    const dialogo = await screen.findByRole("dialog")
    expect(within(dialogo).getByText("Editar producto: Fernet")).toBeInTheDocument()
    expect(dialogo.className).toMatch(/\bh-dvh\b/)
    expect(dialogo.className).toMatch(/\bw-full\b/)
    expect(dialogo.className).toMatch(/\bmax-w-none\b/)
  })
})
