import { useCallback, useEffect, useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { obtenerNocheAbierta, suscribirCambios, type Noche } from "@/lib/datos"

export type EstadoNoche = {
  noche: Noche | null
  cargando: boolean
  error: boolean
  recargar: () => Promise<void>
  setNoche: (n: Noche | null) => void
}

// Noche abierta del club, al dia: si otro encargado la inicia o la para,
// llega por Realtime.
export function useNoche(client: SupabaseClient, clubId: string | null): EstadoNoche {
  const [noche, setNoche] = useState<Noche | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(false)

  const recargar = useCallback(async () => {
    if (!clubId) return
    try {
      setNoche(await obtenerNocheAbierta(client, clubId))
      setError(false)
    } catch {
      setError(true)
    } finally {
      setCargando(false)
    }
  }, [client, clubId])

  useEffect(() => {
    if (!clubId) return
    setCargando(true)
    void recargar()
    return suscribirCambios(client, clubId, ["club_nights"], () => void recargar())
  }, [client, clubId, recargar])

  return { noche, cargando, error, recargar, setNoche }
}
