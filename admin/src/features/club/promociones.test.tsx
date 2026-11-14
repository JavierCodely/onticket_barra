import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { crearClienteFalso, SESION_DE_PRUEBA } from "@/test/supabaseFalso"
import {
  cruzaMedianoche,
  describirDescuento,
  describirVigencia,
  descuentoLinea,
  ejemploDescuento,
  formVacio,
  validarPromocion,
} from "@/lib/promociones"
import { AVISO_DESACTIVAR_PROMO, PromocionesPage } from "./PromocionesPage"

const CLUB = "club-1"
const prod = (id: string, name: string, price: number, extra = {}) => ({
  id, name, sku: null, category_id: null, cost: 1000, price, image_url: null, active: true, kind: "product", ...extra,
})
const FERNET = prod("p1", "Fernet", 6500, { category_id: "k1" })
const HEINEKEN = prod("p2", "Heineken", 6000, { category_id: "k2" })
const CATEGORIAS = [
  { id: "k1", club_id: "club-1", name: "Tragos", sort_order: 1, active: true },
  { id: "k2", club_id: "club-1", name: "Cervezas", sort_order: 2, active: true },
]
const AGUA = prod("p3", "Agua", 1500, { active: false })
const VIP = { id: "l1", name: "Barra VIP", kind: "bar", active: true }
const PISTA = { id: "l2", name: "Barra Pista", kind: "bar", active: true }
const DEPOSITO = { id: "l9", name: "Depósito", kind: "storage", active: true }

const promo = (extra: Record<string, unknown>) => ({
  id: "pr1", product_id: "p2", name: "2x1 Heineken", kind: "nxm", percentage: null, fixed_amount: null,
  buy_quantity: 2, pay_quantity: 1, starts_on: null, ends_on: null, weekdays: 127, start_time: null, end_time: null,
  active: true, ...extra,
})
const DOSXUNO = promo({})
const HAPPY = promo({
  id: "pr2", product_id: "p1", name: "Happy hour Fernet", kind: "percentage", percentage: 20, buy_quantity: null,
  pay_quantity: null, weekdays: 48, start_time: "00:00:00", end_time: "01:30:00", starts_on: "2026-12-01", ends_on: "2026-12-31",
})

type Respuesta = { data: unknown; error: unknown }
const ok = (data: unknown): Respuesta => ({ data, error: null })

function cliente(extra: Record<string, Respuesta[]> = {}, promociones: unknown[] = [DOSXUNO, HAPPY]) {
  return crearClienteFalso(SESION_DE_PRUEBA, {
    promotions: [ok(promociones), ...(extra.promotions ?? [])],
    promotion_locations: [
      ok([{ id: "pl1", promotion_id: "pr1", location_id: "l1" }]),
      ...(extra.promotion_locations ?? []),
    ],
    v_promotions_status: [
      ok([
        { promotion_id: "pr1", in_schedule_now: true, applies_now: true, expired: false },
        { promotion_id: "pr2", in_schedule_now: false, applies_now: false, expired: false },
      ]),
      ...(extra.v_promotions_status ?? []),
    ],
    products: [ok([AGUA, FERNET, HEINEKEN])],
    inventory_locations: [ok([VIP, PISTA, DEPOSITO])],
    product_categories: [ok(CATEGORIAS)],
  })
}

describe("promociones: cuentas y textos", () => {
  const nxm = { kind: "nxm" as const, percentage: null, fixed_amount: null, buy_quantity: 2, pay_quantity: 1 }
  const pct = { kind: "percentage" as const, percentage: "20", fixed_amount: null, buy_quantity: null, pay_quantity: null }
  const fijo = { kind: "fixed_amount" as const, percentage: null, fixed_amount: "1000", buy_quantity: null, pay_quantity: null }

  it("el descuento usa la misma formula que la base (v_sale_promotion_issues)", () => {
    expect(descuentoLinea(nxm, "6000", 3)).toBe(600000n) // 3 con 2x1: una gratis
    expect(descuentoLinea(nxm, "6000", 5)).toBe(1200000n) // 5: dos gratis
    expect(descuentoLinea({ ...nxm, buy_quantity: 3, pay_quantity: 2 }, "6000", 2)).toBe(0n) // 3x2 con 2: nada
    expect(descuentoLinea(pct, "3333.33", 3)).toBe(200000n) // 1999,998 -> 2000,00
    expect(descuentoLinea(pct, "5000", 1)).toBe(100000n)
    expect(descuentoLinea(fijo, "800", 2)).toBe(160000n) // tope: el precio
    expect(descuentoLinea(fijo, "5000", 2)).toBe(200000n)
  })

  it("ejemplo y descripciones", () => {
    expect(ejemploDescuento(nxm, "6000")).toEqual({ cantidad: 2, normal: "12000.00", conPromo: "6000.00", descuento: "6000.00" })
    expect(describirDescuento(nxm)).toBe("2x1 (llevá 2, pagá 1)")
    expect(describirDescuento(pct)).toBe("20 % de descuento")
    expect(describirDescuento(fijo)).toBe("$1.000,00 menos por unidad")
    expect(
      describirVigencia({ weekdays: 48, start_time: "00:00:00", end_time: "01:30:00", starts_on: "2026-12-01", ends_on: "2026-12-31" }),
    ).toBe("Vie, Sáb · 00:00 a 01:30 · del 01/12/2026 al 31/12/2026")
    expect(describirVigencia({ weekdays: 127, start_time: null, end_time: null, starts_on: null, ends_on: null })).toBe(
      "Todos los días",
    )
    expect(cruzaMedianoche("23:00", "02:00")).toBe(true)
    expect(cruzaMedianoche("20:00", "22:00")).toBe(false)
  })

  it("valida como los CHECK de la base", () => {
    const base = { ...formVacio(), productId: "p1", name: "Promo" }
    const errores = (f: Partial<typeof base>) => {
      const r = validarPromocion({ ...base, ...f })
      return r.ok ? {} : r.errores
    }
    expect(errores({ productId: "", name: " " })).toMatchObject({ productId: expect.any(String), name: expect.any(String) })
    expect(errores({ percentage: "0" }).valor).toBeTruthy()
    expect(errores({ percentage: "100,5" }).valor).toBeTruthy()
    expect(errores({ percentage: "12,5" })).toEqual({})
    expect(errores({ kind: "fixed_amount", fixedAmount: "0" }).valor).toBeTruthy()
    expect(errores({ kind: "nxm", buyQuantity: "2", payQuantity: "2" }).cantidades).toBeTruthy()
    expect(errores({ kind: "nxm", buyQuantity: "1", payQuantity: "0" }).cantidades).toBeTruthy()
    expect(errores({ startsOn: "2026-12-10", endsOn: "2026-12-01" }).fechas).toBeTruthy()
    expect(errores({ weekdays: 0 }).dias).toBeTruthy()
    expect(errores({ conHorario: true, startTime: "23:00", endTime: "" }).horario).toBeTruthy()
    expect(errores({ conHorario: true, startTime: "23:00", endTime: "23:00" }).horario).toBeTruthy()

    const r = validarPromocion({ ...base, percentage: "12,5", conHorario: true, startTime: "23:00", endTime: "02:00" })
    expect(r.ok && r.valor).toMatchObject({
      kind: "percentage", percentage: "12.50", fixed_amount: null, buy_quantity: null, start_time: "23:00", end_time: "02:00",
      starts_on: null, ends_on: null,
    })
    // Sin horario no se manda franja aunque haya horas escritas
    const sin = validarPromocion({ ...base, percentage: "10", conHorario: false, startTime: "23:00", endTime: "02:00" })
    expect(sin.ok && sin.valor).toMatchObject({ start_time: null, end_time: null })
  })
})

describe("Promociones (pantalla)", () => {
  it("lista cada promocion con su producto, descuento, vigencia, barras y estado", async () => {
    const falso = cliente()
    render(<PromocionesPage client={falso.client} clubId={CLUB} />)

    const dosxuno = await screen.findByRole("listitem", { name: "2x1 Heineken" })
    expect(dosxuno).toHaveTextContent("Heineken · 2x1 (llevá 2, pagá 1)")
    expect(dosxuno).toHaveTextContent("Todos los días")
    expect(dosxuno).toHaveTextContent("Barra VIP")
    expect(dosxuno).toHaveTextContent("Aplicándose ahora")

    const happy = screen.getByRole("listitem", { name: "Happy hour Fernet" })
    expect(happy).toHaveTextContent("Fernet · 20 % de descuento")
    expect(happy).toHaveTextContent("Vie, Sáb · 00:00 a 01:30 · del 01/12/2026 al 31/12/2026")
    expect(happy).toHaveTextContent("Todas las barras")
    expect(happy).toHaveTextContent("Fuera de horario")
    // Sin boton de borrar
    expect(screen.queryByRole("button", { name: /Borrar|Eliminar/ })).not.toBeInTheDocument()
    const filtrosClub = falso.consultas.filter((c) => c.metodo === "eq" && c.args[0] === "club_id").map((c) => c.tabla)
    expect(filtrosClub).toEqual(expect.arrayContaining(["promotions", "promotion_locations", "v_promotions_status"]))
  })

  it("NUEVA: 2x1 solo en la barra VIP, con happy hour que cruza la medianoche", async () => {
    const creada = promo({ id: "pr9", product_id: "p1", name: "2x1 Fernet", weekdays: 48, start_time: "23:00:00", end_time: "02:00:00" })
    const falso = cliente({ promotions: [ok(creada)], promotion_locations: [ok(null)] }, [])
    render(<PromocionesPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Nueva promoción" }))
    const dialogo = await screen.findByRole("dialog")

    // Solo productos activos en el catalogo (Agua esta inhabilitada)
    const catalogo = within(dialogo).getByRole("region", { name: "Catálogo de productos" })
    expect(within(catalogo).queryByText("Agua")).not.toBeInTheDocument()
    await userEvent.click(within(catalogo).getByRole("button", { name: "Elegir Fernet" }))
    expect(within(dialogo).getByRole("region", { name: "Producto elegido" })).toHaveTextContent("Fernet")
    await userEvent.type(within(dialogo).getByLabelText("Nombre"), "2x1 Fernet")
    await userEvent.click(within(dialogo).getByRole("radio", { name: /Llevá N, pagá M/ }))
    expect(within(dialogo).getByRole("status", { name: "Ejemplo del descuento" })).toHaveTextContent(
      "Llevando 2: $13.000,00 → $6.500,00 (descuento $6.500,00)",
    )

    // Viernes y sabado (de la jornada)
    for (const dia of ["Lunes", "Martes", "Miércoles", "Jueves", "Domingo"]) {
      await userEvent.click(within(dialogo).getByRole("checkbox", { name: dia }))
    }
    await userEvent.click(within(dialogo).getByRole("checkbox", { name: /Solo en un horario/ }))
    await userEvent.type(within(dialogo).getByLabelText("De"), "23:00")
    await userEvent.type(within(dialogo).getByLabelText("A"), "02:00")
    expect(within(dialogo).getByText("Cruza la medianoche: termina al día siguiente.")).toBeInTheDocument()

    // Un deposito no aparece entre las barras
    expect(within(dialogo).queryByRole("checkbox", { name: "Depósito" })).not.toBeInTheDocument()
    await userEvent.click(within(dialogo).getByRole("checkbox", { name: "Barra VIP" }))
    await userEvent.click(within(dialogo).getByRole("button", { name: "Crear promoción" }))

    expect(await screen.findByRole("listitem", { name: "2x1 Fernet" })).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    const [alta, barras] = falso.escrituras
    expect(alta).toMatchObject({
      tabla: "promotions",
      operacion: "insert",
      fila: {
        club_id: CLUB, product_id: "p1", name: "2x1 Fernet", kind: "nxm", buy_quantity: 2, pay_quantity: 1,
        percentage: null, fixed_amount: null, weekdays: 48, start_time: "23:00", end_time: "02:00",
        starts_on: null, ends_on: null, active: true,
      },
    })
    expect(barras).toMatchObject({
      tabla: "promotion_locations",
      operacion: "insert",
      fila: [{ club_id: CLUB, promotion_id: "pr9", location_id: "l1" }],
    })
    expect(screen.getByRole("listitem", { name: "2x1 Fernet" })).toHaveTextContent("Barra VIP")
  })

  it("NUEVA ocupa toda la pantalla; el catalogo se filtra por categoria y se elige UN producto", async () => {
    const falso = cliente({}, [])
    render(<PromocionesPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Nueva promoción" }))
    const dialogo = await screen.findByRole("dialog")
    expect(dialogo.className).toMatch(/h-dvh/)
    expect(dialogo.className).toMatch(/max-w-none/)

    const catalogo = within(dialogo).getByRole("region", { name: "Catálogo de productos" })
    const nombres = () => within(catalogo).getAllByRole("listitem").map((li) => li.querySelector(".font-medium")?.textContent)
    expect(nombres()).toEqual(["Fernet", "Heineken"])
    await userEvent.click(within(catalogo).getByRole("button", { name: /^Cervezas/ }))
    expect(nombres()).toEqual(["Heineken"])
    await userEvent.click(within(catalogo).getByRole("button", { name: /^Todas/ }))
    await userEvent.type(within(catalogo).getByLabelText("Buscar producto"), "fer")
    expect(nombres()).toEqual(["Fernet"])
    await userEvent.clear(within(catalogo).getByLabelText("Buscar producto"))

    // Elegir otro reemplaza al anterior: una promocion es sobre un producto
    await userEvent.click(within(catalogo).getByRole("button", { name: "Elegir Fernet" }))
    await userEvent.click(within(catalogo).getByRole("button", { name: "Elegir Heineken" }))
    expect(within(catalogo).getByRole("button", { name: "Elegir Fernet" })).toBeInTheDocument()
    expect(within(dialogo).getByRole("region", { name: "Producto elegido" })).toHaveTextContent("Heineken")
    // Quitar lo deja sin producto
    await userEvent.click(within(catalogo).getByRole("button", { name: "Quitar Heineken" }))
    expect(within(dialogo).getByRole("region", { name: "Producto elegido" })).toHaveTextContent("Todavía no elegiste")
    // Elegir en el catalogo no envia el formulario
    expect(falso.escrituras).toEqual([])
  })

  it("NUEVA sin barras vale en todas: no escribe promotion_locations; con errores no guarda", async () => {
    const falso = cliente({ promotions: [ok(promo({ id: "pr9", name: "Fernet 10" }))] }, [])
    render(<PromocionesPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Nueva promoción" }))
    const dialogo = await screen.findByRole("dialog")

    await userEvent.click(within(dialogo).getByRole("button", { name: "Crear promoción" }))
    expect(within(dialogo).getByText("Elegí un producto.")).toBeInTheDocument()
    expect(within(dialogo).getByText("El porcentaje va de 0,01 a 100.")).toBeInTheDocument()
    expect(falso.escrituras).toEqual([])

    await userEvent.click(within(dialogo).getByRole("button", { name: "Elegir Fernet" }))
    await userEvent.type(within(dialogo).getByLabelText("Nombre"), "Fernet 10")
    await userEvent.type(within(dialogo).getByLabelText("Porcentaje (%)"), "10")
    expect(within(dialogo).getByText("Sin barras marcadas vale en todas.")).toBeInTheDocument()
    await userEvent.click(within(dialogo).getByRole("button", { name: "Crear promoción" }))

    expect(await screen.findByRole("listitem", { name: "Fernet 10" })).toBeInTheDocument()
    expect(falso.escrituras.map((e) => e.tabla)).toEqual(["promotions"])
  })

  it("si las barras no se guardan, la promocion queda INACTIVA (sin barras valdria en todas) y lo avisa", async () => {
    const creada = promo({ id: "pr9", product_id: "p1", name: "Solo VIP" })
    const falso = cliente(
      {
        promotions: [ok(creada), ok({ ...creada, active: false }), ok([{ ...creada, active: false }])],
        promotion_locations: [{ data: null, error: { message: "x" } }, ok([])],
      },
      [],
    )
    render(<PromocionesPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Nueva promoción" }))
    const dialogo = await screen.findByRole("dialog")
    await userEvent.click(within(dialogo).getByRole("button", { name: "Elegir Fernet" }))
    await userEvent.type(within(dialogo).getByLabelText("Nombre"), "Solo VIP")
    await userEvent.type(within(dialogo).getByLabelText("Porcentaje (%)"), "10")
    await userEvent.click(within(dialogo).getByRole("checkbox", { name: "Barra VIP" }))
    await userEvent.click(within(dialogo).getByRole("button", { name: "Crear promoción" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("La promoción se creó inactiva")
    expect(falso.escrituras.map((e) => [e.tabla, e.operacion])).toEqual([
      ["promotions", "insert"],
      ["promotion_locations", "insert"],
      ["promotions", "update"],
    ])
    expect(falso.escrituras[2].fila).toEqual({ active: false })
    expect(await screen.findByRole("listitem", { name: "Solo VIP" })).toHaveTextContent("Inactiva")
  })

  it("EDITAR: solo nombre, vigencia y barras (el descuento queda bloqueado); agrega antes de quitar", async () => {
    const editada = { ...DOSXUNO, name: "2x1 Heineken Pista" }
    const falso = cliente({ promotions: [ok(editada)], promotion_locations: [ok(null), ok(null)] })
    render(<PromocionesPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("button", { name: "Editar 2x1 Heineken" }))
    const dialogo = await screen.findByRole("dialog")

    // El producto no cambia: el catalogo se ve pero queda bloqueado
    expect(within(dialogo).getByRole("button", { name: "Quitar Heineken" })).toBeDisabled()
    expect(within(dialogo).getByRole("button", { name: "Elegir Fernet" })).toBeDisabled()
    expect(within(dialogo).getByRole("region", { name: "Producto elegido" })).toHaveTextContent("Heineken")
    expect(within(dialogo).getByRole("radio", { name: /Llevá N, pagá M/ })).toBeDisabled()
    expect(within(dialogo).getByLabelText("Lleva")).toBeDisabled()
    expect(within(dialogo).getByRole("checkbox", { name: "Barra VIP" })).toBeChecked()

    await userEvent.clear(within(dialogo).getByLabelText("Nombre"))
    await userEvent.type(within(dialogo).getByLabelText("Nombre"), "2x1 Heineken Pista")
    await userEvent.click(within(dialogo).getByRole("checkbox", { name: "Barra VIP" }))
    await userEvent.click(within(dialogo).getByRole("checkbox", { name: "Barra Pista" }))
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar cambios" }))

    expect(await screen.findByRole("listitem", { name: "2x1 Heineken Pista" })).toHaveTextContent("Barra Pista")
    const [datos, agregar, quitar] = falso.escrituras
    expect(datos).toMatchObject({ tabla: "promotions", operacion: "update" })
    expect(Object.keys(datos.fila as object).sort()).toEqual(
      ["end_time", "ends_on", "name", "start_time", "starts_on", "weekdays"],
    )
    expect(agregar).toMatchObject({ tabla: "promotion_locations", operacion: "insert", fila: [{ location_id: "l2" }] })
    expect(quitar).toMatchObject({
      tabla: "promotion_locations",
      operacion: "delete",
      filtros: [{ metodo: "eq", args: ["promotion_id", "pr1"] }, { metodo: "in", args: ["location_id", ["l1"]] }],
    })
  })

  it("desactivar avisa que las ventas anteriores conservan su descuento; activar no pregunta", async () => {
    const falso = cliente({ promotions: [ok(null), ok(null)] })
    render(<PromocionesPage client={falso.client} clubId={CLUB} />)
    await userEvent.click(await screen.findByRole("switch", { name: "Activa: 2x1 Heineken" }))
    const aviso = screen.getByRole("alertdialog")
    expect(aviso).toHaveTextContent(AVISO_DESACTIVAR_PROMO)
    expect(falso.escrituras).toEqual([])
    await userEvent.click(within(aviso).getByRole("button", { name: "Desactivar" }))
    expect(await screen.findByRole("listitem", { name: "2x1 Heineken" })).toHaveTextContent("Inactiva")
    expect(falso.escrituras).toMatchObject([{ tabla: "promotions", operacion: "update", fila: { active: false } }])

    await userEvent.click(screen.getByRole("switch", { name: "Activa: 2x1 Heineken" }))
    expect(falso.escrituras[1]).toMatchObject({ tabla: "promotions", operacion: "update", fila: { active: true } })
  })

  it("sin promociones lo dice; si falla la carga muestra el error", async () => {
    const vacio = cliente({}, [])
    const { unmount } = render(<PromocionesPage client={vacio.client} clubId={CLUB} />)
    expect(await screen.findByText("Este club todavía no tiene promociones.")).toBeInTheDocument()
    unmount()

    const roto = crearClienteFalso(SESION_DE_PRUEBA, { promotions: [{ data: null, error: { message: "permiso" } }] })
    render(<PromocionesPage client={roto.client} clubId={CLUB} />)
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron cargar las promociones.")
  })
})
