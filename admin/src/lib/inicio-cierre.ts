// Inicio y cierre de la noche por barra: PRODUCTO - INICIO - RECARGA - CIERRE.
// No se recalcula stock: inicio y cierre son las fotos que toma la base, y
// mientras la noche sigue en curso el cierre es el saldo actual (trigger).
import type { FotoStock, Recarga, Saldo } from "./datos"

export type FilaInicioCierre = {
  productId: string
  inicio: number
  recarga: number
  cierre: number
  recargas: Recarga[]
}

export function armarFilasInicioCierre(
  barraId: string,
  fotos: FotoStock[],
  recargas: Recarga[],
  saldosActuales: Saldo[],
  enCurso: boolean,
): FilaInicioCierre[] {
  const filas = new Map<string, FilaInicioCierre>()
  const fila = (productId: string) => {
    let f = filas.get(productId)
    if (!f) {
      f = { productId, inicio: 0, recarga: 0, cierre: 0, recargas: [] }
      filas.set(productId, f)
    }
    return f
  }
  for (const foto of fotos) {
    if (foto.location_id !== barraId) continue
    if (foto.kind === "opening") fila(foto.product_id).inicio = foto.quantity
    else if (!enCurso) fila(foto.product_id).cierre = foto.quantity
  }
  if (enCurso) {
    for (const s of saldosActuales) if (s.location_id === barraId) fila(s.product_id).cierre = s.quantity
  }
  // Dos recargas del mismo producto se suman; el detalle las conserva.
  for (const r of recargas) {
    if (r.location_id !== barraId) continue
    const f = fila(r.product_id)
    f.recarga += r.quantity
    f.recargas.push(r)
  }
  for (const f of filas.values()) f.recargas.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
  return [...filas.values()]
}

// Jornada de la noche (regla 27): la que empieza a las 03:00 del sabado
// pertenece al viernes. Devuelve "AAAA-MM-DD" en la zona horaria del club.
export function jornadaDe(iso: string, zonaHoraria: string, horaInicio: number): string {
  const instante = new Date(new Date(iso).getTime() - horaInicio * 3_600_000)
  const formato = (zona: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(
      instante,
    )
  try {
    return formato(zonaHoraria)
  } catch {
    return formato("UTC")
  }
}

// Quien hizo la recarga. El encargado no lee platform_admins: el nombre del
// administrador sale de club_admin_names (archivo 19); si no esta, el rol.
export function autorDeRecarga(
  r: Pick<Recarga, "actor_type" | "actor_id">,
  personal: Map<string, string>,
  administradores: Map<string, string> = new Map(),
): string {
  if (!r.actor_id) return "Sistema"
  if (r.actor_type === "platform_admin") return administradores.get(r.actor_id) ?? "Administrador"
  return personal.get(r.actor_id) ?? "Usuario dado de baja"
}
