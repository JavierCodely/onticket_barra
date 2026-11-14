import { useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { Check } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { guardarPaleta } from "@/lib/datos"
import { PALETAS, type CodigoPaleta } from "@/lib/paletas"
import { cn } from "@/lib/utils"

type Props = {
  client: SupabaseClient
  clubId: string
  paleta: CodigoPaleta
  // Avisa al panel para que cambie los colores en el momento.
  onCambio: (paleta: CodigoPaleta) => void
}

// Configuracion del club. Por ahora: la paleta de colores del panel, que
// queda guardada en el club (club_settings). Al entrar a otro club, el
// panel toma la de ese club.
export function ConfiguracionPage({ client, clubId, paleta, onCambio }: Props) {
  const [guardando, setGuardando] = useState<CodigoPaleta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guardada, setGuardada] = useState(false)

  async function elegir(codigo: CodigoPaleta) {
    if (codigo === paleta || guardando) return
    const anterior = paleta
    setError(null)
    setGuardada(false)
    setGuardando(codigo)
    onCambio(codigo) // se ve al instante; si falla, vuelve
    try {
      await guardarPaleta(client, clubId, codigo)
      setGuardada(true)
    } catch {
      onCambio(anterior)
      setError("No se pudo guardar la paleta. Intentá de nuevo.")
    } finally {
      setGuardando(null)
    }
  }

  return (
    <div className="flex w-full max-w-5xl flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Configuración</h1>
        <p className="text-sm text-muted-foreground">Preferencias de este club.</p>
      </div>

      <section
        aria-labelledby="config-paleta"
        className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-xs"
      >
        <div className="flex flex-col gap-0.5">
          <h2 id="config-paleta" className="text-base font-semibold">
            Paleta de colores
          </h2>
          <p className="text-sm text-muted-foreground">
            Los colores del panel mientras estás en este club. Cada club guarda la suya.
          </p>
        </div>

        <div role="radiogroup" aria-labelledby="config-paleta" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PALETAS.map((p) => {
            const elegida = p.codigo === paleta
            return (
              <button
                key={p.codigo}
                type="button"
                role="radio"
                aria-checked={elegida}
                disabled={guardando !== null}
                onClick={() => void elegir(p.codigo)}
                className={cn(
                  "flex min-h-14 items-center gap-3 rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted/60 disabled:cursor-wait",
                  elegida ? "border-primary ring-2 ring-primary/30" : "border-border",
                )}
              >
                <span aria-hidden className="flex shrink-0 -space-x-1.5">
                  <span className="size-6 rounded-full border border-background" style={{ background: p.claro }} />
                  <span className="size-6 rounded-full border border-background" style={{ background: p.oscuro }} />
                </span>
                <span className="flex-1 font-medium">{p.nombre}</span>
                {elegida && <Check aria-hidden className="size-4 text-primary" />}
              </button>
            )
          })}
        </div>

        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {guardada && (
          <p role="status" className="text-sm text-success">
            Paleta guardada para este club.
          </p>
        )}
      </section>
    </div>
  )
}
