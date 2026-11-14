import { afterEach, describe, expect, it, vi } from "vitest"
import { crearClienteFalso, SESION_DE_PRUEBA } from "@/test/supabaseFalso"
import {
  DURACION_CACHE_MS,
  actualizarMiPerfil,
  cambiarActivoProducto,
  guardarPaleta,
  obtenerPaleta,
  listarActividad,
  nombresAdministradores,
  crearBarra,
  invalidarCache,
  listarClubs,
  listarProductos,
  listarUbicaciones,
  listarVentas,
} from "./datos"

const CLUB = "club-1"
type Respuesta = { data: unknown; error: unknown }
const ok = (data: unknown): Respuesta => ({ data, error: null })
const CORONA = { id: "p1", name: "Corona", price: 5000, active: true }
const pedidos = (falso: ReturnType<typeof crearClienteFalso>, tabla: string) =>
  falso.consultas.filter((c) => c.tabla === tabla && c.metodo === "select").length

afterEach(() => {
  vi.useRealTimers()
})

describe("cache del panel", () => {
  it("al volver a pedir lo mismo no viaja a Supabase: usa lo guardado", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, { products: [ok([CORONA]), ok([{ ...CORONA, name: "Otra" }])] })
    expect(await listarProductos(falso.client, CLUB)).toEqual([CORONA])
    expect(await listarProductos(falso.client, CLUB)).toEqual([CORONA])
    expect(pedidos(falso, "products")).toBe(1)
  })

  it("dos pantallas que piden lo mismo a la vez comparten un solo pedido", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, { inventory_locations: [ok([{ id: "l1" }])] })
    const [a, b] = await Promise.all([listarUbicaciones(falso.client, CLUB), listarUbicaciones(falso.client, CLUB)])
    expect(a).toEqual(b)
    expect(pedidos(falso, "inventory_locations")).toBe(1)
  })

  it("cada club y cada tipo (producto/combo) se guardan aparte", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, { products: [ok([CORONA]), ok([]), ok([{ id: "c1" }])] })
    await listarProductos(falso.client, CLUB)
    await listarProductos(falso.client, "club-2")
    expect(await listarProductos(falso.client, CLUB, "combo")).toEqual([{ id: "c1" }])
    expect(pedidos(falso, "products")).toBe(3)
  })

  it("toda escritura del panel lo vacia: lo siguiente se vuelve a pedir", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, {
      products: [ok([CORONA]), ok({ ...CORONA, active: false }), ok([{ ...CORONA, active: false }])],
      inventory_locations: [ok([]), ok({ id: "l9", name: "VIP", kind: "bar", active: true }), ok([{ id: "l9" }])],
    })
    await listarProductos(falso.client, CLUB)
    await cambiarActivoProducto(falso.client, "p1", false)
    expect(await listarProductos(falso.client, CLUB)).toEqual([{ ...CORONA, active: false }])

    // Tambien a traves de funciones auxiliares (crearBarra -> crearUbicacion)
    await listarUbicaciones(falso.client, CLUB)
    await crearBarra(falso.client, CLUB, "VIP")
    expect(await listarUbicaciones(falso.client, CLUB)).toEqual([{ id: "l9" }])
  })

  it("vence a los 60 segundos", async () => {
    vi.useFakeTimers()
    const falso = crearClienteFalso(SESION_DE_PRUEBA, { clubs: [ok([{ id: "a" }]), ok([{ id: "a" }, { id: "b" }])] })
    await listarClubs(falso.client)
    vi.advanceTimersByTime(DURACION_CACHE_MS - 1)
    expect(await listarClubs(falso.client)).toHaveLength(1)
    vi.advanceTimersByTime(2)
    expect(await listarClubs(falso.client)).toHaveLength(2)
  })

  it("un error no se guarda: el proximo pedido vuelve a intentar", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, { products: [{ data: null, error: { message: "red" } }, ok([CORONA])] })
    await expect(listarProductos(falso.client, CLUB)).rejects.toThrow("red")
    expect(await listarProductos(falso.client, CLUB)).toEqual([CORONA])
  })

  it("devuelve una copia: lo que cambia una pantalla no lo ve otra", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, { products: [ok([CORONA])] })
    const lista = await listarProductos(falso.client, CLUB)
    lista.pop()
    expect(await listarProductos(falso.client, CLUB)).toHaveLength(1)
  })

  it("cambiar de sesion lo vacia (otra persona no ve lo guardado); renovar el token no", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, { clubs: [ok([{ id: "de-ana" }]), ok([{ id: "de-luis" }])] })
    await listarClubs(falso.client)
    const escuchar = vi.mocked(falso.client.auth.onAuthStateChange)
    const aviso = escuchar.mock.calls.at(-1)?.[0] as unknown as (evento: string) => void
    aviso("TOKEN_REFRESHED")
    expect(await listarClubs(falso.client)).toEqual([{ id: "de-ana" }])
    aviso("SIGNED_OUT")
    expect(await listarClubs(falso.client)).toEqual([{ id: "de-luis" }])
  })

  it("las ventas NO se guardan: cambian solas (posnet, Realtime)", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, { v_sales_list: [ok([]), ok([{ sale_id: "s1" }])] })
    await listarVentas(falso.client, CLUB, {} as never)
    expect(await listarVentas(falso.client, CLUB, {} as never)).toEqual([{ sale_id: "s1" }])
  })

  it("nombres de administradores: se guardan; el historial no; guardar el perfil vacia el cache", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, {
      "rpc:club_admin_names": [ok([{ admin_id: "a1", full_name: "Ana" }]), ok([{ admin_id: "a1", full_name: "Ana Perez" }])],
      "rpc:club_activity": [ok([]), ok([{ id: "e1" }])],
      platform_admins: [ok({ id: "a1" })],
    })
    await nombresAdministradores(falso.client, CLUB)
    expect((await nombresAdministradores(falso.client, CLUB)).get("a1")).toBe("Ana")
    expect(falso.rpcs.filter((r) => r.nombre === "club_admin_names")).toHaveLength(1)

    await listarActividad(falso.client, CLUB, "2026-11-14", "2026-11-14")
    expect(await listarActividad(falso.client, CLUB, "2026-11-14", "2026-11-14")).toEqual([{ id: "e1" }])

    await actualizarMiPerfil(falso.client, "a1", { first_name: "Ana", last_name: "Perez", phone: null })
    expect((await nombresAdministradores(falso.client, CLUB)).get("a1")).toBe("Ana Perez")
  })

  it("paleta del club: se guarda en cache; guardarla lo vacia; un valor desconocido usa la de Onticket", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, {
      club_settings: [ok({ palette: "azul" }), ok([{ palette: "coral" }]), ok({ palette: "marron" })],
    })
    expect(await obtenerPaleta(falso.client, CLUB)).toBe("azul")
    expect(await obtenerPaleta(falso.client, CLUB)).toBe("azul")
    expect(pedidos(falso, "club_settings")).toBe(1)
    await guardarPaleta(falso.client, CLUB, "coral")
    expect(await obtenerPaleta(falso.client, CLUB)).toBe("violeta")
  })

  it("invalidarCache a mano vacia todo", async () => {
    const falso = crearClienteFalso(SESION_DE_PRUEBA, { products: [ok([CORONA]), ok([])] })
    await listarProductos(falso.client, CLUB)
    invalidarCache(falso.client)
    expect(await listarProductos(falso.client, CLUB)).toEqual([])
  })
})
