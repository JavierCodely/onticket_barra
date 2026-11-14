import { assert, assertEquals } from "jsr:@std/assert@1.0.13"
import { crearHandler, type Dependencias, type Persona } from "./handler.ts"
import { validarEdicion } from "./validar.ts"

const CLUB = "c0000000-0000-0000-0000-00000000000a"
const OTRO_CLUB = "c0000000-0000-0000-0000-00000000000b"
const JUAN = "30000000-0000-0000-0000-000000000001"
const ENCARGADO = "30000000-0000-0000-0000-000000000004"

const PERSONAS: Record<string, Persona> = {
  [JUAN]: { id: JUAN, full_name: "Juan", role: "cashier", active: true, username: "juan", email: null, auth_user_id: null },
  [ENCARGADO]: {
    id: ENCARGADO,
    full_name: "Encargado",
    role: "club_admin",
    active: true,
    username: null,
    email: "enc@test.com",
    auth_user_id: "auth-encargado",
  },
}

function armar(cambios: Partial<Dependencias> = {}) {
  const reg = { updates: [] as unknown[], auditorias: [] as Record<string, unknown>[] }
  const deps: Dependencias = {
    usuarioDelToken: (token) =>
      Promise.resolve(token === "token-ana" ? "auth-ana" : token === "token-enc" ? "auth-encargado" : null),
    puedeGestionarClub: (_t, clubId) => Promise.resolve(clubId === CLUB),
    actorDelLlamante: () => Promise.resolve({ actor_type: "platform_admin", actor_id: "admin-ana" }),
    obtenerPersona: (clubId, userId) => Promise.resolve(clubId === CLUB ? (PERSONAS[userId] ?? null) : null),
    actualizarPersona: (_c, userId, c) => {
      reg.updates.push({ userId, ...c })
      return Promise.resolve({ ...PERSONAS[userId], ...c })
    },
    auditar: (e) => {
      reg.auditorias.push(e)
      return Promise.resolve({})
    },
    ...cambios,
  }
  return { handler: crearHandler(deps), reg }
}

function pedido(cuerpo: unknown, token: string | null = "token-ana") {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers.Authorization = `Bearer ${token}`
  return new Request("http://localhost/admin-update-user", { method: "POST", headers, body: JSON.stringify(cuerpo) })
}

Deno.test("edita nombre y rol de un cajero, solo lo que cambia, y audita", async () => {
  const { handler, reg } = armar()
  const res = await handler(pedido({ club_id: CLUB, user_id: JUAN, full_name: " Juan Perez ", role: "bartender", active: true }))
  assertEquals(res.status, 200)
  assertEquals(await res.json(), {
    id: JUAN, full_name: "Juan Perez", role: "bartender", active: true, username: "juan", email: null,
  })
  // active no cambio: no se manda
  assertEquals(reg.updates, [{ userId: JUAN, full_name: "Juan Perez", role: "bartender" }])
  assertEquals(reg.auditorias.length, 1)
  assertEquals(reg.auditorias[0].action, "user.updated")
  assertEquals(reg.auditorias[0].details, {
    full_name: { from: "Juan", to: "Juan Perez" },
    role: { from: "cashier", to: "bartender" },
  })
})

Deno.test("desactivar y reactivar", async () => {
  const { handler, reg } = armar()
  const res = await handler(pedido({ club_id: CLUB, user_id: JUAN, active: false }))
  assertEquals(res.status, 200)
  assertEquals((await res.json()).active, false)
  assertEquals(reg.updates, [{ userId: JUAN, active: false }])
})

Deno.test("sin cambios reales no escribe ni audita", async () => {
  const { handler, reg } = armar()
  const res = await handler(pedido({ club_id: CLUB, user_id: JUAN, full_name: "Juan" }))
  assertEquals(res.status, 200)
  assertEquals(reg.updates, [])
  assertEquals(reg.auditorias, [])
})

Deno.test("el rol de un encargado no se cambia", async () => {
  const { handler, reg } = armar()
  const res = await handler(pedido({ club_id: CLUB, user_id: ENCARGADO, role: "cashier" }))
  assertEquals(res.status, 400)
  assertEquals(reg.updates, [])
})

Deno.test("nadie se desactiva a si mismo", async () => {
  const { handler, reg } = armar()
  const res = await handler(pedido({ club_id: CLUB, user_id: ENCARGADO, active: false }, "token-enc"))
  assertEquals(res.status, 400)
  assertEquals(reg.updates, [])
  // pero si puede cambiarse el nombre
  const ok = await handler(pedido({ club_id: CLUB, user_id: ENCARGADO, full_name: "Encargada" }, "token-enc"))
  assertEquals(ok.status, 200)
})

Deno.test("sin sesion 401, club ajeno 403, persona de otro club 404", async () => {
  const { handler, reg } = armar()
  assertEquals((await handler(pedido({ club_id: CLUB, user_id: JUAN, active: false }, null))).status, 401)
  assertEquals((await handler(pedido({ club_id: CLUB, user_id: JUAN, active: false }, "token-falso"))).status, 401)
  assertEquals((await handler(pedido({ club_id: OTRO_CLUB, user_id: JUAN, active: false }))).status, 403)
  const ajena = armar({ puedeGestionarClub: () => Promise.resolve(true) })
  assertEquals(
    (await ajena.handler(pedido({ club_id: OTRO_CLUB, user_id: JUAN, active: false }))).status,
    404,
    "la persona no es de ese club",
  )
  assertEquals(reg.updates, [])
})

Deno.test("no acepta campos extra (pin, pin_hash, username, club)", async () => {
  const { handler, reg } = armar()
  for (const extra of [{ pin: "482913" }, { pin_hash: "x" }, { username: "otro" }, { auth_user_id: "x" }]) {
    const res = await handler(pedido({ club_id: CLUB, user_id: JUAN, ...extra }))
    assertEquals(res.status, 400)
  }
  assertEquals(reg.updates, [])
})

Deno.test("error de la base: 400 si es regla, 500 si no; sin filtrar detalles", async () => {
  const regla = armar({ actualizarPersona: () => Promise.resolve({ error: { code: "23514", message: "detalle interno" } }) })
  const r1 = await regla.handler(pedido({ club_id: CLUB, user_id: JUAN, full_name: "X" }))
  assertEquals(r1.status, 400)
  assert(!(await r1.text()).includes("detalle interno"))
  const caida = armar({ actualizarPersona: () => Promise.resolve({ error: { code: "XX000", message: "caida" } }) })
  assertEquals((await caida.handler(pedido({ club_id: CLUB, user_id: JUAN, full_name: "X" }))).status, 500)
})

Deno.test("validacion", () => {
  assertEquals(validarEdicion({ club_id: CLUB, user_id: JUAN }).ok, false) // nada que cambiar
  assertEquals(validarEdicion({ club_id: CLUB, user_id: JUAN, role: "club_admin" }).ok, false)
  assertEquals(validarEdicion({ club_id: CLUB, user_id: JUAN, active: "no" }).ok, false)
  assertEquals(validarEdicion({ club_id: CLUB, user_id: JUAN, full_name: "  " }).ok, false)
  assertEquals(validarEdicion({ club_id: "x", user_id: JUAN, full_name: "Ok" }).ok, false)
  assertEquals(validarEdicion([]).ok, false)
})
