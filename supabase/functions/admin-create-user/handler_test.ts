import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1.0.13"
import bcrypt from "npm:bcryptjs@2.4.3"
import { crearHandler, type Dependencias, type FilaUsuario } from "./handler.ts"

const CLUB = "c0000000-0000-0000-0000-00000000000a"
const OTRO_CLUB = "c0000000-0000-0000-0000-00000000000b"
const PIN = "482913"

type Registro = {
  filas: FilaUsuario[]
  auditorias: Record<string, unknown>[]
  authCreados: string[]
  authBorrados: string[]
  logs: unknown[][]
}

function armar(cambios: Partial<Dependencias> = {}) {
  const reg: Registro = { filas: [], auditorias: [], authCreados: [], authBorrados: [], logs: [] }
  const deps: Dependencias = {
    usuarioDelToken: (token) => Promise.resolve(token === "token-ana" ? "auth-ana" : null),
    puedeGestionarClub: (_token, clubId) => Promise.resolve(clubId === CLUB),
    actorDelLlamante: () => Promise.resolve({ actor_type: "platform_admin", actor_id: "admin-ana" }),
    hashPin: (pin) => bcrypt.hash(pin, 4),
    crearUsuarioAuth: (email) => {
      reg.authCreados.push(email)
      return Promise.resolve({ id: "auth-nuevo" })
    },
    borrarUsuarioAuth: (id) => {
      reg.authBorrados.push(id)
      return Promise.resolve()
    },
    insertarUsuario: (fila) => {
      reg.filas.push(fila)
      return Promise.resolve({ id: "user-nuevo" })
    },
    auditar: (entrada) => {
      reg.auditorias.push(entrada)
      return Promise.resolve({})
    },
    ahora: () => new Date("2026-11-13T20:00:00Z"),
    ...cambios,
  }
  return { handler: crearHandler(deps), reg }
}

function pedido(cuerpo: unknown, token: string | null = "token-ana", metodo = "POST") {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers.Authorization = `Bearer ${token}`
  return new Request("http://localhost/admin-create-user", {
    method: metodo,
    headers,
    body: metodo === "POST" ? (typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo)) : undefined,
  })
}

const CAJERO = { club_id: CLUB, full_name: "Juan", role: "cashier", username: "juan", pin: PIN }

Deno.test("crea un cajero: guarda el hash, nunca el PIN, y audita", async () => {
  const { handler, reg } = armar()
  const res = await handler(pedido(CAJERO))
  assertEquals(res.status, 201)

  const cuerpo = await res.json()
  assertEquals(cuerpo, { id: "user-nuevo", full_name: "Juan", role: "cashier", username: "juan", email: null, active: true })
  assert(!JSON.stringify(cuerpo).includes(PIN), "la respuesta no devuelve el PIN")

  assertEquals(reg.filas.length, 1)
  const fila = reg.filas[0]
  assertEquals(fila.club_id, CLUB)
  assertNotEquals(fila.pin_hash, PIN)
  assert(fila.pin_hash && (await bcrypt.compare(PIN, fila.pin_hash)), "el hash corresponde al PIN")
  assertEquals(fila.pin_changed_at, "2026-11-13T20:00:00.000Z")

  assertEquals(reg.auditorias.length, 1)
  assertEquals(reg.auditorias[0].action, "user.created")
  assertEquals(reg.auditorias[0].actor_type, "platform_admin")
  assertEquals(reg.auditorias[0].entity_id, "user-nuevo")
  assert(!JSON.stringify(reg.auditorias).includes(PIN), "la auditoria no guarda el PIN")
  assert(!JSON.stringify(reg.auditorias).includes(fila.pin_hash!), "la auditoria no guarda el hash")
})

Deno.test("sin sesion o con token invalido: 401 y no crea nada", async () => {
  for (const token of [null, "token-falso"]) {
    const { handler, reg } = armar()
    const res = await handler(pedido(CAJERO, token))
    assertEquals(res.status, 401)
    assertEquals(reg.filas.length, 0)
  }
})

Deno.test("club que no gestiona: 403 y no crea nada", async () => {
  const { handler, reg } = armar()
  const res = await handler(pedido({ ...CAJERO, club_id: OTRO_CLUB }))
  assertEquals(res.status, 403)
  assertEquals(reg.filas.length, 0)
  assertEquals(reg.auditorias.length, 0)
})

Deno.test("la autorizacion usa el club del pedido con el JWT de quien llama", async () => {
  const llamadas: [string, string][] = []
  const { handler } = armar({
    puedeGestionarClub: (token, clubId) => {
      llamadas.push([token, clubId])
      return Promise.resolve(true)
    },
  })
  await handler(pedido(CAJERO))
  assertEquals(llamadas, [["token-ana", CLUB]])
})

Deno.test("datos invalidos: 400 con errores por campo, sin llegar a la base", async () => {
  const { handler, reg } = armar()
  const res = await handler(pedido({ ...CAJERO, pin: "123" }))
  assertEquals(res.status, 400)
  const cuerpo = await res.json()
  assert(cuerpo.errores.pin)
  assertEquals(reg.filas.length, 0)
})

Deno.test("cuerpo que no es JSON: 400", async () => {
  const { handler } = armar()
  assertEquals((await handler(pedido("{no es json"))).status, 400)
})

Deno.test("usuario repetido en el club: 409", async () => {
  const { handler, reg } = armar({
    insertarUsuario: () =>
      Promise.resolve({
        error: { code: "23505", message: 'duplicate key value violates unique constraint "uq_users_club_username"' },
      }),
  })
  const res = await handler(pedido(CAJERO))
  assertEquals(res.status, 409)
  assertEquals((await res.json()).error, "Ya existe ese usuario en el club.")
  assertEquals(reg.auditorias.length, 0)
})

Deno.test("error inesperado de la base: 500 sin detalles internos", async () => {
  const { handler } = armar({
    insertarUsuario: () => Promise.resolve({ error: { code: "XX000", message: "detalle interno secreto" } }),
  })
  const res = await handler(pedido(CAJERO))
  assertEquals(res.status, 500)
  assert(!(await res.text()).includes("detalle interno secreto"))
})

Deno.test("crea un encargado: usuario de Auth y fila con su auth_user_id", async () => {
  const { handler, reg } = armar()
  const res = await handler(
    pedido({ club_id: CLUB, full_name: "Encargada", role: "club_admin", email: "enc@club.com", password: "clave-larga-1" }),
  )
  assertEquals(res.status, 201)
  assertEquals(reg.authCreados, ["enc@club.com"])
  assertEquals(reg.filas[0].auth_user_id, "auth-nuevo")
  assertEquals(reg.filas[0].pin_hash, undefined)
  assert(!JSON.stringify(reg.auditorias).includes("clave-larga-1"), "la auditoria no guarda la contrasena")
  assert(!(await res.text()).includes("clave-larga-1"))
})

Deno.test("si falla la fila del encargado, borra el usuario de Auth (sin huerfanos)", async () => {
  const { handler, reg } = armar({
    insertarUsuario: () =>
      Promise.resolve({ error: { code: "23505", message: "El email enc@club.com ya pertenece a un administrador" } }),
  })
  const res = await handler(
    pedido({ club_id: CLUB, full_name: "Encargada", role: "club_admin", email: "enc@club.com", password: "clave-larga-1" }),
  )
  assertEquals(res.status, 409)
  assertEquals(reg.authBorrados, ["auth-nuevo"])
})

Deno.test("email ya registrado en Auth: 409 y no inserta la fila", async () => {
  const { handler, reg } = armar({
    crearUsuarioAuth: () => Promise.resolve({ error: { code: "auth", message: "already registered" } }),
  })
  const res = await handler(
    pedido({ club_id: CLUB, full_name: "Encargada", role: "club_admin", email: "enc@club.com", password: "clave-larga-1" }),
  )
  assertEquals(res.status, 409)
  assertEquals(reg.filas.length, 0)
})

Deno.test("si falla la auditoria, el log no incluye datos del pedido", async () => {
  const original = console.error
  const logs: unknown[][] = []
  console.error = (...args: unknown[]) => logs.push(args)
  try {
    const { handler } = armar({
      auditar: () => Promise.resolve({ error: { code: "42501", message: "permiso" } }),
    })
    const res = await handler(pedido(CAJERO))
    assertEquals(res.status, 201)
    assertEquals(logs.length, 1)
    assert(!JSON.stringify(logs).includes(PIN) && !JSON.stringify(logs).includes("juan"))
  } finally {
    console.error = original
  }
})

Deno.test("OPTIONS responde CORS y GET no esta permitido", async () => {
  const { handler } = armar()
  const opciones = await handler(pedido(null, null, "OPTIONS"))
  assertEquals(opciones.status, 204)
  assert(opciones.headers.get("Access-Control-Allow-Headers")?.includes("authorization"))
  assertEquals((await handler(pedido(null, "token-ana", "GET"))).status, 405)
})
