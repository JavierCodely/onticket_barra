// admin-update-user: editar personal de un club desde el panel.
//
// Reglas (CLAUDE.md, secciones 3 y 5):
//   * Solo quien gestiona el club (can_manage_club con SU JWT) puede editar.
//   * users solo se modifica por Edge Function: el panel no tiene UPDATE.
//   * Se cambia nombre, rol (solo entre cajero y barra) y activo. El rol de
//     un encargado no cambia. Nadie se desactiva a si mismo.
//   * Si cambia el rol, la base quita la asignacion de caja o barra que ya
//     no corresponde (archivo 15).
//   * Toda edicion queda auditada ('user.updated'), sin secretos.
import { corsHeaders, json, tokenBearer } from "../_shared/http.ts"
import { type CambiosPersonal, validarEdicion } from "./validar.ts"

export type Actor = { actor_type: "platform_admin" | "user"; actor_id: string }
export type ErrorBase = { code: string; message: string }

export type Persona = {
  id: string
  full_name: string
  role: "cashier" | "bartender" | "club_admin"
  active: boolean
  username: string | null
  email: string | null
  auth_user_id: string | null
}

export type Dependencias = {
  usuarioDelToken: (token: string) => Promise<string | null>
  puedeGestionarClub: (token: string, clubId: string) => Promise<boolean>
  actorDelLlamante: (authUserId: string, clubId: string) => Promise<Actor | null>
  // La persona, solo si es de ESE club y no esta dada de baja.
  obtenerPersona: (clubId: string, userId: string) => Promise<Persona | null>
  actualizarPersona: (
    clubId: string,
    userId: string,
    cambios: CambiosPersonal,
  ) => Promise<Persona | { error: ErrorBase }>
  auditar: (entrada: {
    club_id: string
    actor_type: Actor["actor_type"]
    actor_id: string
    action: string
    entity_type: string
    entity_id: string
    details: Record<string, unknown>
  }) => Promise<{ error?: ErrorBase }>
  origenPanel?: string
}

// Lo que se devuelve al panel: sin auth_user_id ni nada interno.
function publica(p: Persona) {
  return { id: p.id, full_name: p.full_name, role: p.role, active: p.active, username: p.username, email: p.email }
}

export function crearHandler(deps: Dependencias) {
  return async function handler(req: Request): Promise<Response> {
    const cors = corsHeaders(deps.origenPanel)

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors })
    if (req.method !== "POST") return json({ error: "Metodo no permitido.", code: "metodo" }, 405, cors)

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

    const validacion = validarEdicion(cuerpo)
    if (!validacion.ok) {
      return json({ error: "Datos invalidos.", code: "invalido", errores: validacion.errores }, 400, cors)
    }
    const { club_id, user_id, cambios } = validacion.pedido

    if (!(await deps.puedeGestionarClub(token, club_id))) {
      return json({ error: "No gestionas este club.", code: "prohibido" }, 403, cors)
    }
    const actor = await deps.actorDelLlamante(authUserId, club_id)
    if (!actor) return json({ error: "No gestionas este club.", code: "prohibido" }, 403, cors)

    const actual = await deps.obtenerPersona(club_id, user_id)
    if (!actual) return json({ error: "Esa persona no es de este club.", code: "no_encontrado" }, 404, cors)

    if (cambios.role && actual.role === "club_admin") {
      return json(
        { error: "El rol de un encargado no se cambia. Crea otro usuario.", code: "invalido", errores: { role: "No se cambia." } },
        400,
        cors,
      )
    }
    if (cambios.active === false && actual.auth_user_id === authUserId) {
      return json(
        { error: "No podes desactivarte a vos mismo.", code: "invalido", errores: { active: "No se puede." } },
        400,
        cors,
      )
    }

    // Solo lo que cambia de verdad.
    const reales: CambiosPersonal = {}
    const detalle: Record<string, { from: unknown; to: unknown }> = {}
    for (const [campo, valor] of Object.entries(cambios) as [keyof CambiosPersonal, unknown][]) {
      if (actual[campo] !== valor) {
        ;(reales as Record<string, unknown>)[campo] = valor
        detalle[campo] = { from: actual[campo], to: valor }
      }
    }
    if (Object.keys(reales).length === 0) return json(publica(actual), 200, cors)

    const actualizado = await deps.actualizarPersona(club_id, user_id, reales)
    if ("error" in actualizado) {
      const codigo = actualizado.error.code
      if (codigo.startsWith("23")) {
        return json({ error: "Los datos no cumplen las reglas de la base.", code: "invalido" }, 400, cors)
      }
      return json({ error: "No se pudo guardar.", code: "error_interno" }, 500, cors)
    }

    const auditoria = await deps.auditar({
      club_id,
      actor_type: actor.actor_type,
      actor_id: actor.actor_id,
      action: "user.updated",
      entity_type: "user",
      entity_id: user_id,
      details: detalle,
    })
    if (auditoria.error) console.error("admin-update-user: fallo la auditoria", auditoria.error.code)

    return json(publica(actualizado), 200, cors)
  }
}
