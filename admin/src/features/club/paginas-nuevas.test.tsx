import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { crearClienteFalso, errorDeFuncion, SESION_DE_PRUEBA } from "@/test/supabaseFalso"
import { AVISO_DESACTIVAR, ImpuestosPage } from "./ImpuestosPage"
import { PersonalPage } from "./PersonalPage"
import { ProductosPage } from "./ProductosPage"
import { StockBarraPage } from "./StockBarraPage"

const CLUB = "club-1"

// =====================================================================
// Personal
// =====================================================================
const JUAN = { id: "u1", full_name: "Juan", role: "cashier", active: true, username: "juan", email: null }
const PEDRO = { id: "u2", full_name: "Pedro", role: "bartender", active: true, username: "pedro", email: null }
const ANA = { id: "u3", full_name: "Ana", role: "cashier", active: false, username: "ana", email: null }

describe("PersonalPage", () => {
  it("muestra activo, bloqueado por intentos e inactivo", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, {
      users: [{ data: [ANA, JUAN, PEDRO], error: null }],
      "rpc:club_staff_status": [
        {
          data: [
            { user_id: "u1", is_locked: false },
            { user_id: "u2", is_locked: true },
            { user_id: "u3", is_locked: false },
          ],
          error: null,
        },
      ],
    })
    render(<PersonalPage client={falso.client} clubId={CLUB} />)

    const fila = (nombre: string) => screen.getByText(nombre).closest("tr") as HTMLElement
    await screen.findByText("Pedro")
    expect(within(fila("Juan")).getByText("Activo")).toBeInTheDocument()
    expect(within(fila("Pedro")).getByText("Bloqueado por intentos")).toBeInTheDocument()
    expect(within(fila("Ana")).getByText("Inactivo")).toBeInTheDocument()
    expect(falso.rpcs).toEqual([{ nombre: "club_staff_status", args: { p_club_id: CLUB } }])
  })

  it("crea un cajero por la Edge Function, con el club y sin tocar la tabla users", async () => {
    const creado = { id: "u9", full_name: "Lucía", role: "cashier", active: true, username: "lucia", email: null }
    const falso = crearClienteFalso(SESION_DE_PRUEBA, { "fn:admin-create-user": [{ data: creado, error: null }] })
    render(<PersonalPage client={falso.client} clubId={CLUB} />)

    await userEvent.click(await screen.findByRole("button", { name: "Nuevo personal" }))
    await userEvent.type(screen.getByLabelText("Nombre"), "Lucía")
    await userEvent.type(screen.getByLabelText("Usuario"), "Lucia")
    await userEvent.type(screen.getByLabelText("PIN (6 a 8 dígitos)"), "482913")
    await userEvent.click(screen.getByRole("button", { name: "Crear" }))

    expect(await screen.findByText("Lucía")).toBeInTheDocument()
    expect(falso.invocaciones).toEqual([
      {
        nombre: "admin-create-user",
        body: { club_id: CLUB, full_name: "Lucía", role: "cashier", username: "lucia", pin: "482913" },
      },
    ])
    expect(falso.escrituras.filter((e) => e.tabla === "users")).toEqual([])
  })

  it("el campo PIN solo acepta digitos y no se muestra", async () => {
    const { client } = crearClienteFalso(SESION_DE_PRUEBA)
    render(<PersonalPage client={client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Nuevo personal" }))
    const pin = screen.getByLabelText("PIN (6 a 8 dígitos)")
    await userEvent.type(pin, "48a29b13")
    expect(pin).toHaveValue("482913")
    expect(pin).toHaveAttribute("type", "password")
  })

  it("no envia un PIN facil de adivinar", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA)
    render(<PersonalPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Nuevo personal" }))
    await userEvent.type(screen.getByLabelText("Nombre"), "Lucía")
    await userEvent.type(screen.getByLabelText("Usuario"), "lucia")
    await userEvent.type(screen.getByLabelText("PIN (6 a 8 dígitos)"), "123456")
    await userEvent.click(screen.getByRole("button", { name: "Crear" }))

    expect(screen.getByText(/demasiado fácil de adivinar/)).toBeInTheDocument()
    expect(falso.invocaciones).toEqual([])
  })

  it("encargado: pide email y contrasena en lugar de usuario y PIN", async () => {
    const creado = { id: "u8", full_name: "Encargada", role: "club_admin", active: true, username: null, email: "e@c.com" }
    const falso = crearClienteFalso(SESION_DE_PRUEBA, { "fn:admin-create-user": [{ data: creado, error: null }] })
    render(<PersonalPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Nuevo personal" }))
    await userEvent.selectOptions(screen.getByLabelText("Rol"), "club_admin")

    expect(screen.queryByLabelText("PIN (6 a 8 dígitos)")).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText("Nombre"), "Encargada")
    await userEvent.type(screen.getByLabelText("Email"), "e@c.com")
    await userEvent.type(screen.getByLabelText("Contraseña inicial"), "clave-larga-1")
    await userEvent.click(screen.getByRole("button", { name: "Crear" }))

    expect(await screen.findByText("Encargada")).toBeInTheDocument()
    expect(falso.invocaciones[0].body).toEqual({
      club_id: CLUB, full_name: "Encargada", role: "club_admin", email: "e@c.com", password: "clave-larga-1",
    })
  })

  it("muestra el error de la funcion (usuario repetido) y borra el PIN del formulario", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, {
      "fn:admin-create-user": [errorDeFuncion(409, { error: "Ya existe ese usuario en el club.", code: "duplicado" })],
    })
    render(<PersonalPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Nuevo personal" }))
    await userEvent.type(screen.getByLabelText("Nombre"), "Juan")
    await userEvent.type(screen.getByLabelText("Usuario"), "juan")
    await userEvent.type(screen.getByLabelText("PIN (6 a 8 dígitos)"), "482913")
    await userEvent.click(screen.getByRole("button", { name: "Crear" }))

    expect(await screen.findByText("Ya existe ese usuario en el club.")).toBeInTheDocument()
    expect(screen.getByLabelText("PIN (6 a 8 dígitos)")).toHaveValue("")
  })
})

// =====================================================================
// Productos (deposito) y Stock en barra
// =====================================================================
const CORONA = { id: "p1", name: "Corona", sku: null, category_id: null, cost: "1000.00", price: "5000.00", active: true }
const HEINEKEN = { id: "p2", name: "Heineken", sku: null, category_id: null, cost: "2000.00", price: "6000.00", active: true }
const BARRA = { id: "l1", name: "Barra principal", kind: "bar", active: true }
const BARRA_VIP = { id: "l3", name: "Barra VIP", kind: "bar", active: true }
const DEPOSITO = { id: "l2", name: "Depósito", kind: "storage", active: true }

describe("ProductosPage: cargar stock en el deposito", () => {
  it("una compra entra al deposito con solo las columnas permitidas y se relee el saldo", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, {
      products: [{ data: [CORONA], error: null }],
      inventory_locations: [{ data: [BARRA, DEPOSITO], error: null }],
      inventory_balances: [
        { data: [], error: null },
        { data: [{ location_id: "l2", product_id: "p1", quantity: 100 }], error: null },
      ],
    })
    render(<ProductosPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Cargar depósito de Corona" }))
    await userEvent.selectOptions(screen.getByLabelText("Tipo"), "purchase")
    await userEvent.type(screen.getByLabelText("Cantidad de unidades"), "100")
    await userEvent.click(screen.getByRole("button", { name: "Registrar" }))

    expect(await screen.findByLabelText("Stock de Corona en depósito: 100")).toBeInTheDocument()
    const [fila] = falso.escrituras.find((e) => e.tabla === "inventory_movements")!.fila as Record<string, unknown>[]
    expect(fila).toEqual({
      club_id: CLUB, product_id: "p1", note: null, location_id: "l2", movement_type: "purchase", quantity: 100,
    })
    // Nadie escribe el saldo: solo se lee.
    expect(falso.escrituras.filter((e) => e.tabla === "inventory_balances")).toEqual([])
  })
})

describe("StockBarraPage", () => {
  function clienteBarra(extraSaldos: { data: unknown; error: null }[] = []) {
    return crearClienteFalso(SESION_DE_PRUEBA, {
      products: [{ data: [CORONA, HEINEKEN], error: null }],
      inventory_locations: [{ data: [BARRA, BARRA_VIP, DEPOSITO], error: null }],
      inventory_balances: [
        {
          data: [
            { location_id: "l2", product_id: "p1", quantity: 100 },
            { location_id: "l1", product_id: "p1", quantity: -2 },
          ],
          error: null,
        },
        ...extraSaldos,
      ],
    })
  }

  it("muestra las barras; al elegir una aparecen TODOS los productos con deposito y barra", async () => {
    const { client } = clienteBarra()
    render(<StockBarraPage client={client} clubId={CLUB} />)

    await userEvent.click(await screen.findByRole("button", { name: "Barra principal" }))
    expect(screen.getByRole("button", { name: "Barra principal" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByLabelText("Corona en depósito: 100")).toBeInTheDocument()
    expect(screen.getByLabelText("Heineken en depósito: 0")).toBeInTheDocument()
    // saldo negativo en la barra = sobreventa
    expect(screen.getByLabelText("Corona en barra: -2")).toHaveClass("text-destructive")
    // sin stock en el deposito no se puede cargar
    const filaHeineken = screen.getByText("Heineken").closest("tr") as HTMLElement
    expect(within(filaHeineken).getByRole("button", { name: "Cargar" })).toBeDisabled()
  })

  it("carga 50 de 100 en la barra: transferencia deposito -> barra en una sola insercion", async () => {
    const falso = clienteBarra([
      {
        data: [
          { location_id: "l2", product_id: "p1", quantity: 50 },
          { location_id: "l1", product_id: "p1", quantity: 48 },
        ],
        error: null,
      },
    ])
    render(<StockBarraPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Barra principal" }))
    await userEvent.type(screen.getByLabelText("Cantidad de Corona"), "50")
    const filaCorona = screen.getByText("Corona").closest("tr") as HTMLElement
    await userEvent.click(within(filaCorona).getByRole("button", { name: "Cargar" }))

    expect(await screen.findByLabelText("Corona en barra: 48")).toBeInTheDocument()
    expect(screen.getByLabelText("Corona en depósito: 50")).toBeInTheDocument()
    const movimientos = falso.escrituras.filter((e) => e.tabla === "inventory_movements")
    expect(movimientos).toHaveLength(1)
    expect(movimientos[0].fila).toEqual([
      { club_id: CLUB, product_id: "p1", note: "Carga de barra", location_id: "l2", movement_type: "transfer_out", quantity: -50 },
      { club_id: CLUB, product_id: "p1", note: "Carga de barra", location_id: "l1", movement_type: "transfer_in", quantity: 50 },
    ])
  })

  it("no deja cargar mas de lo que hay en el deposito", async () => {
    const falso = clienteBarra()
    render(<StockBarraPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Barra VIP" }))
    await userEvent.type(screen.getByLabelText("Cantidad de Corona"), "101")
    const filaCorona = screen.getByText("Corona").closest("tr") as HTMLElement
    await userEvent.click(within(filaCorona).getByRole("button", { name: "Cargar" }))

    expect(screen.getByText("En el depósito hay 100: no se puede cargar más que eso.")).toBeInTheDocument()
    expect(falso.escrituras).toEqual([])
  })

  it("sin barras avisa que se crean en Cajas/Barras", async () => {
    const { client } = crearClienteFalso(SESION_DE_PRUEBA, { inventory_locations: [{ data: [DEPOSITO], error: null }] })
    render(<StockBarraPage client={client} clubId={CLUB} />)
    expect(await screen.findByText(/Creálas en Cajas\/Barras/)).toBeInTheDocument()
  })
})

// =====================================================================
// Impuestos
// =====================================================================
// Los mismos en todos los clubs: PIX, Transferencia, Efectivo. Tarjeta quedo
// inactiva, pero un impuesto viejo todavia la usa.
const METODOS = [
  { code: "pix", label: "PIX", active: true },
  { code: "transfer", label: "Transferencia", active: true },
  { code: "cash", label: "Efectivo", active: true },
  { code: "card", label: "Tarjeta", active: false },
]
const TARJETA = {
  id: "t1", name: "Comisión tarjeta", kind: "percentage", percentage: "3.0000", fixed_amount: null, active: true,
}
const FIJO = { id: "t2", name: "Ingresos brutos", kind: "fixed", percentage: null, fixed_amount: "50.00", active: false }

function clienteImpuestos(extra: Record<string, { data: unknown; error: unknown }[]> = {}) {
  return crearClienteFalso(SESION_DE_PRUEBA, {
    taxes: [{ data: [TARJETA, FIJO], error: null }],
    tax_payment_methods: [
      {
        data: [
          { tax_id: "t1", method: "card" },
          { tax_id: "t2", method: "card" },
          { tax_id: "t2", method: "transfer" },
        ],
        error: null,
      },
    ],
    payment_methods: [{ data: METODOS, error: null }],
    ...extra,
  })
}

describe("ImpuestosPage", () => {
  it("lista nombre, tipo, metodos e interruptor activo; sin boton de borrar", async () => {
    const { client } = clienteImpuestos()
    render(<ImpuestosPage client={client} clubId={CLUB} />)

    const tarjeta = (await screen.findByText("Comisión tarjeta")).closest("li") as HTMLElement
    expect(within(tarjeta).getByText("3 %")).toBeInTheDocument()
    expect(within(tarjeta).getByText("Tarjeta")).toBeInTheDocument()
    expect(within(tarjeta).getByRole("switch", { name: "Activo: Comisión tarjeta" })).toBeChecked()

    const fijo = screen.getByText("Ingresos brutos").closest("li") as HTMLElement
    expect(within(fijo).getByText("$50,00 por unidad")).toBeInTheDocument()
    expect(within(fijo).getByText("Transferencia")).toBeInTheDocument()
    expect(within(fijo).getByRole("switch", { name: "Activo: Ingresos brutos" })).not.toBeChecked()

    expect(screen.queryByRole("button", { name: /borrar|eliminar/i })).not.toBeInTheDocument()
  })

  it("al desactivar avisa con el texto acordado y solo desactiva al confirmar", async () => {
    const falso = clienteImpuestos()
    render(<ImpuestosPage client={falso.client} clubId={CLUB} />)

    await userEvent.click(await screen.findByRole("switch", { name: "Activo: Comisión tarjeta" }))
    expect(screen.getByText(AVISO_DESACTIVAR)).toBeInTheDocument()
    expect(falso.escrituras).toEqual([])

    await userEvent.click(screen.getByRole("button", { name: "Desactivar" }))
    expect(await screen.findByRole("switch", { name: "Activo: Comisión tarjeta" })).not.toBeChecked()
    expect(falso.escrituras).toEqual([
      { tabla: "taxes", operacion: "update", fila: { active: false }, filtros: [{ metodo: "eq", args: ["id", "t1"] }] },
    ])
  })

  it("cancelar el aviso no cambia nada", async () => {
    const falso = clienteImpuestos()
    render(<ImpuestosPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("switch", { name: "Activo: Comisión tarjeta" }))
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    expect(screen.queryByText(AVISO_DESACTIVAR)).not.toBeInTheDocument()
    expect(falso.escrituras).toEqual([])
  })

  it("activar no pide confirmacion", async () => {
    const falso = clienteImpuestos()
    render(<ImpuestosPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("switch", { name: "Activo: Ingresos brutos" }))
    expect(await screen.findByRole("switch", { name: "Activo: Ingresos brutos" })).toBeChecked()
    expect(falso.escrituras[0]).toMatchObject({ tabla: "taxes", fila: { active: true } })
  })

  it("crea un impuesto fijo con sus metodos de pago", async () => {
    const creado = { id: "t3", name: "Tasa municipal", kind: "fixed", percentage: null, fixed_amount: "20", active: true }
    const falso = clienteImpuestos({ taxes: [{ data: [], error: null }, { data: creado, error: null }] })
    render(<ImpuestosPage client={falso.client} clubId={CLUB} />)

    await userEvent.click(await screen.findByRole("button", { name: "Nuevo impuesto" }))
    await userEvent.type(screen.getByLabelText("Nombre"), "Tasa municipal")
    await userEvent.selectOptions(screen.getByLabelText("Tipo"), "fixed")
    await userEvent.type(screen.getByLabelText("Monto por unidad ($)"), "20")
    // un impuesto nuevo solo ofrece los metodos activos
    expect(screen.queryByLabelText(/Tarjeta/)).not.toBeInTheDocument()
    expect(screen.getByText(/Pago mixto/)).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText("Efectivo"))
    await userEvent.click(screen.getByLabelText("PIX"))
    await userEvent.click(screen.getByRole("button", { name: "Crear impuesto" }))

    expect(await screen.findByText("Tasa municipal")).toBeInTheDocument()
    expect(falso.escrituras.map((e) => [e.tabla, e.operacion, e.fila])).toEqual([
      [
        "taxes",
        "insert",
        { club_id: CLUB, name: "Tasa municipal", kind: "fixed", percentage: null, fixed_amount: "20", active: true },
      ],
      [
        "tax_payment_methods",
        "insert",
        [
          { club_id: CLUB, tax_id: "t3", method: "cash" },
          { club_id: CLUB, tax_id: "t3", method: "pix" },
        ],
      ],
    ])
  })

  it("no crea un impuesto sin metodos de pago", async () => {
    const falso = clienteImpuestos({ taxes: [{ data: [], error: null }] })
    render(<ImpuestosPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Nuevo impuesto" }))
    await userEvent.type(screen.getByLabelText("Nombre"), "IVA")
    await userEvent.type(screen.getByLabelText("Porcentaje (%)"), "21")
    await userEvent.click(screen.getByRole("button", { name: "Crear impuesto" }))

    expect(screen.getByText("Elegí al menos un método de pago.")).toBeInTheDocument()
    expect(falso.escrituras).toEqual([])
  })

  it("editar: cambia el valor y agrega o quita solo los metodos que cambiaron", async () => {
    const actualizado = { ...TARJETA, percentage: "3.5000" }
    const falso = clienteImpuestos({
      taxes: [
        { data: [TARJETA, FIJO], error: null },
        { data: actualizado, error: null },
      ],
    })
    render(<ImpuestosPage client={falso.client} clubId={CLUB} />)

    await userEvent.click(await screen.findByRole("button", { name: "Editar Comisión tarjeta" }))
    const valor = screen.getByLabelText("Porcentaje (%)")
    expect(valor).toHaveValue("3")
    await userEvent.clear(valor)
    await userEvent.type(valor, "3.5")
    // el metodo inactivo aparece marcado solo para poder quitarlo
    expect(screen.getByLabelText("Tarjeta (ya no se usa)")).toBeChecked()
    await userEvent.click(screen.getByLabelText("Tarjeta (ya no se usa)")) // quita card
    expect(screen.getByLabelText("Tarjeta (ya no se usa)")).toBeDisabled() // no se puede volver a agregar
    expect(falso.consultas).toContainEqual({ tabla: "payment_methods", metodo: "select", args: ["code, label, active"] })
    await userEvent.click(screen.getByLabelText("Transferencia")) // agrega transfer
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }))

    expect(await screen.findByText("3,5 %")).toBeInTheDocument()
    expect(falso.escrituras).toEqual([
      {
        tabla: "taxes",
        operacion: "update",
        fila: { name: "Comisión tarjeta", kind: "percentage", percentage: "3.5", fixed_amount: null },
        filtros: [
          { metodo: "eq", args: ["id", "t1"] },
          { metodo: "select", args: ["id, name, kind, percentage, fixed_amount, active"] },
          { metodo: "single", args: [] },
        ],
      },
      {
        tabla: "tax_payment_methods",
        operacion: "insert",
        fila: [{ club_id: CLUB, tax_id: "t1", method: "transfer" }],
        filtros: [],
      },
      {
        tabla: "tax_payment_methods",
        operacion: "delete",
        filtros: [
          { metodo: "eq", args: ["tax_id", "t1"] },
          { metodo: "in", args: ["method", ["card"]] },
        ],
      },
    ])
  })
})
