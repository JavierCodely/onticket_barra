// Donde esta el panel, escrito en la direccion (hash) para que recargar la
// pagina vuelva al mismo club y la misma seccion, y para que funcionen
// Atras y Adelante del navegador. Se usa el hash (#/...) porque no
// necesita configurar el servidor que sirve el panel.
//   #/clubs                    seccion global
//   #/club/<club_id>/ventas    seccion de un club
// La direccion no es seguridad (regla 3): el club se vuelve a leer de la
// base, y si quien entra no lo ve (RLS), se vuelve a la lista de clubs.
import { MENU_CLUB, MENU_GLOBAL, type SeccionClub, type SeccionGlobal } from "@/features/navegacion/menus"

export type Ruta =
  | { tipo: "global"; seccion: SeccionGlobal }
  | { tipo: "club"; clubId: string; seccion: SeccionClub }

export const RUTA_INICIAL: Ruta = { tipo: "global", seccion: "clubs" }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const esGlobal = (s: string): s is SeccionGlobal => MENU_GLOBAL.some((o) => o.id === s)
const esDeClub = (s: string): s is SeccionClub => MENU_CLUB.some((o) => o.id === s)

export function leerRuta(hash: string): Ruta {
  const partes = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent)
  if (partes[0] === "club" && partes[1] && (UUID.test(partes[1]) || /^[\w-]{1,64}$/.test(partes[1]))) {
    const seccion = partes[2] && esDeClub(partes[2]) ? partes[2] : "dashboard"
    return { tipo: "club", clubId: partes[1], seccion }
  }
  if (partes[0] && esGlobal(partes[0])) return { tipo: "global", seccion: partes[0] }
  return RUTA_INICIAL
}

export function escribirRuta(ruta: Ruta): string {
  return ruta.tipo === "club"
    ? `#/club/${encodeURIComponent(ruta.clubId)}/${ruta.seccion}`
    : `#/${ruta.seccion}`
}
