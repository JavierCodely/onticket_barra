// admin-create-user: alta de personal de un club desde el panel.
//
// Reglas (CLAUDE.md, secciones 3 y 5):
//   * Solo quien gestiona el club (can_manage_club con SU JWT) puede dar altas.
//   * El hash del PIN se calcula aca, en el servidor. El PIN y la
//     contrasena nunca se guardan, ni se loguean, ni se devuelven.
//   * Toda alta queda auditada (audit_log, action 'user.created').
//
// Las dependencias se inyectan para poder probar el flujo sin red
// (handler_test.ts). index.ts las conecta con Supabase y bcrypt.
import { corsHeaders, json, tokenBearer } from "../_shared/http.ts"
import { type Pedido, validarPedido } from "./validar.ts"

export type Actor = { actor_type: "platform_admin" | "user"; actor_id: string }

export type FilaUsuario = {
  club_id: string
  full_name: string
  role: string
  username?: string
  pin_hash?: string
  pin_changed_at?: string
  email?: string
  auth_user_id?: string
}

export type ErrorBase = { code: string; message: string }

export type Dependencias = {
  // Valida el JWT con Supabase Auth; devuelve el id del usuario o null.
  usuarioDelToken: (token: string) => Promise<string | null>
  // supabase.rpc('can_manage_club') con el JWT de quien llama.
  puedeGestionarClub: (token: string, clubId: string) => Promise<boolean>
  // Quien llama, para firmar la auditoria.
  actorDelLlamante: (authUserId: string, clubId: string) => Promise<Actor | null>
  hashPin: (pin: string) => Promise<string>
  // Crea el usuario de Supabase Auth de un club_admin. Error si el email existe.
  crearUsuarioAuth: (email: string, password: string) => Promise<{ id: string } | { error: ErrorBase }>
  borrarUsuarioAuth: (id: string) => Promise<void>
  insertarUsuario: (fila: FilaUsuario) => Promise<{ id: string } | { error: ErrorBase }>
  auditar: (entrada: {
    club_id: string
    actor_type: Actor["actor_type"]
    actor_id: string
    action: string
    entity_type: string
    entity_id: string
    details: Record<string, unknown>
  }) => Promise<{ error?: ErrorBase }>
  ahora: () => Date
  origenPanel?: string
}

// Traduce errores de Postgres a respuestas para el panel, sin filtrar
// detalles internos.
function respuestaPorErrorDeBase(error: ErrorBase, cors: Record<string, string>): Response {
  if (error.code === "23505") {
    const msg = error.message.includes("username")
      ? "Ya existe ese usuario en el club."
      : "Ese email ya esta en uso."
    return json({ error: msg, code: "duplicado" }, 409, cors)
  }
  if (error.code === "23514" || error.code === "23503") {
    return json({ error: "Los datos no cumplen las reglas de la base.", code: "invalido" }, 400, cors)
  }
  return json({ error: "No se pudo crear el usuario.", code: "error_interno" }, 500, cors)
}

export function crearHandler(deps: Dependencias) {
  return async function handler(req: Request): Promise<Response> {
    const cors = corsHeaders(deps.origenPanel)

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors })
    if (req.method !== "POST") {
      return json({ error: "Metodo no permitido.", code: "metodo" }, 405, cors)
    }

    const token = tokenBearer(req)
    if (!token) return json({ error: "Falta la sesion.", code: "sin_sesion" }, 401, cors)
    const authUserId = await deps.usuarioDelToken(token)
    if (!authUserId) return json({ error: "Sesion invalida.", code: "sin_sesion" }, 401, cors)

    let cuerpo: unknown
    try {
      cuerpo = await req.json()
    } catch {
      return json({ error: "El cuerpo no es JSON.", code: "invalido" }, 400, cors)
    }

    const validacion = validarPedido(cuerpo)
    if (!validacion.ok) {
      return json({ error: "Datos invalidos.", code: "invalido", errores: validacion.errores }, 400, cors)
    }
    const pedido: Pedido = validacion.pedido

    // Autorizacion con el JWT de quien llama (nunca con la clave secreta).
    if (!(await deps.puedeGestionarClub(token, pedido.club_id))) {
      return json({ error: "No gestionas este club.", code: "prohibido" }, 403, cors)
    }
    const actor = await deps.actorDelLlamante(authUserId, pedido.club_id)
    if (!actor) return json({ error: "No gestionas este club.", code: "prohibido" }, 403, cors)

    let fila: FilaUsuario
    let authCreado: string | null = null
    let detalle: Record<string, unknown>

    if (pedido.role === "club_admin") {
      const creado = await deps.crearUsuarioAuth(pedido.email, pedido.password)
      if ("error" in creado) {
        return json({ error: "Ese email ya esta en uso o no es valido.", code: "duplicado" }, 409, cors)
      }
      authCreado = creado.id
      fila = {
        club_id: pedido.club_id,
        full_name: pedido.full_name,
        role: pedido.role,
        email: pedido.email,
        auth_user_id: creado.id,
      }
      detalle = { role: pedido.role, email: pedido.email }
    } else {
      fila = {
        club_id: pedido.club_id,
        full_name: pedido.full_name,
        role: pedido.role,
        username: pedido.username,
        pin_hash: await deps.hashPin(pedido.pin),
        pin_changed_at: deps.ahora().toISOString(),
      }
      detalle = { role: pedido.role, username: pedido.username }
    }

    const insertado = await deps.insertarUsuario(fila)
    if ("error" in insertado) {
      // No dejar un usuario de Auth huerfano si la fila no se pudo crear.
      if (authCreado) await deps.borrarUsuarioAuth(authCreado)
      return respuestaPorErrorDeBase(insertado.error, cors)
    }

    const auditoria = await deps.auditar({
      club_id: pedido.club_id,
      actor_type: actor.actor_type,
      actor_id: actor.actor_id,
      action: "user.created",
      entity_type: "user",
      entity_id: insertado.id,
      details: { ...detalle, full_name: pedido.full_name },
    })
    if (auditoria.error) {
      // Solo el codigo: nunca datos del pedido.
      console.error("admin-create-user: fallo la auditoria", auditoria.error.code)
    }

    return json(
      {
        id: insertado.id,
        full_name: pedido.full_name,
        role: pedido.role,
        username: pedido.role === "club_admin" ? null : pedido.username,
        email: pedido.role === "club_admin" ? pedido.email : null,
        active: true,
      },
      201,
      cors,
    )
  }
}
