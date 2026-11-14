import { useEffect, useState, type FormEvent } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { Moon, Square } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { EstadoNoche } from "@/features/noche/useNoche"
import { ErrorDeNoche, iniciarNoche, listarCajas, pararNoche, type Caja } from "@/lib/datos"
import { formatearHora } from "@/lib/formato"
import { validarCambio } from "@/lib/validaciones"

type Props = {
  client: SupabaseClient
  clubId: string
  estado: EstadoNoche
}

export const AVISO_PARAR =
  "Se cierran todas las cajas y se toma la foto final del stock de cada barra. Los posnets dejan de vender hasta que se inicie otra noche."

// Boton maestro de la noche. Sin noche iniciada el posnet no vende.
export function ControlNoche({ client, clubId, estado }: Props) {
  const [iniciando, setIniciando] = useState(false)
  const [confirmarParar, setConfirmarParar] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { noche } = estado

  if (estado.cargando) return null

  return (
    <div className="flex min-w-0 items-center gap-2">
      {noche ? (
        <>
          <Badge className="hidden sm:inline-flex" aria-live="polite">
            Noche en curso desde {formatearHora(noche.started_at)}
          </Badge>
          <Button
            variant="destructive"
            className="min-h-11 md:min-h-8"
            onClick={() => {
              setError(null)
              setConfirmarParar(true)
            }}
          >
            <Square aria-hidden />
            <span>Parar noche</span>
          </Button>
        </>
      ) : (
        <Button
          className="min-h-11 md:min-h-8"
          onClick={() => {
            setError(null)
            setIniciando(true)
          }}
        >
          <Moon aria-hidden />
          <span>Iniciar noche</span>
        </Button>
      )}

      {error && (
        <span role="alert" className="sr-only">
          {error}
        </span>
      )}

      <IniciarNocheDialog
        abierto={iniciando}
        client={client}
        clubId={clubId}
        onCerrar={() => setIniciando(false)}
        onIniciada={(n) => {
          estado.setNoche(n)
          setIniciando(false)
        }}
      />

      <AlertDialog open={confirmarParar} onOpenChange={setConfirmarParar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Parar la noche?</AlertDialogTitle>
            <AlertDialogDescription>{AVISO_PARAR}</AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (!noche) return
                try {
                  await pararNoche(client, noche.id)
                  estado.setNoche(null)
                  setConfirmarParar(false)
                } catch {
                  setError("No se pudo parar la noche. Intentá de nuevo.")
                }
              }}
            >
              Parar noche
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------------------------------------------------------------------
// Iniciar: el cambio en efectivo de cada caja (se carga a mano)
// ---------------------------------------------------------------------
function IniciarNocheDialog({
  abierto,
  client,
  clubId,
  onCerrar,
  onIniciada,
}: {
  abierto: boolean
  client: SupabaseClient
  clubId: string
  onCerrar: () => void
  onIniciada: (n: Awaited<ReturnType<typeof iniciarNoche>>) => void
}) {
  const [cajas, setCajas] = useState<Caja[] | null>(null)
  const [montos, setMontos] = useState<Record<string, string>>({})
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  // Al abrir, lee las cajas activas.
  useEffect(() => {
    if (!abierto) return
    let vigente = true
    listarCajas(client, clubId)
      .then((c) => {
        if (vigente) setCajas(c.filter((x) => x.active))
      })
      .catch(() => {
        if (vigente) setErrorGeneral("No se pudieron leer las cajas.")
      })
    return () => {
      vigente = false
    }
  }, [abierto, client, clubId])

  function cerrar() {
    setCajas(null)
    setMontos({})
    setErrores({})
    setErrorGeneral(null)
    onCerrar()
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const nuevosErrores: Record<string, string> = {}
    const cambios: { cajaId: string; monto: string }[] = []
    for (const caja of cajas ?? []) {
      const r = validarCambio(montos[caja.id] ?? "")
      if (r.ok) cambios.push({ cajaId: caja.id, monto: r.valor })
      else nuevosErrores[caja.id] = r.errores
    }
    setErrores(nuevosErrores)
    if (Object.keys(nuevosErrores).length > 0) return
    setGuardando(true)
    setErrorGeneral(null)
    try {
      const noche = await iniciarNoche(client, clubId, cambios)
      setCajas(null)
      setMontos({})
      onIniciada(noche)
    } catch (err) {
      if (err instanceof ErrorDeNoche && err.noche) {
        // La noche quedo iniciada aunque el cambio no se guardo.
        setCajas(null)
        onIniciada(err.noche)
        return
      }
      setErrorGeneral(err instanceof Error ? err.message : "No se pudo iniciar la noche.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && cerrar()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Iniciar noche</DialogTitle>
          <DialogDescription>
            Cargá el cambio en efectivo con que arranca cada caja. Se toma la foto del stock de cada barra y los
            posnets empiezan a vender.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {cajas !== null && cajas.length === 0 && !errorGeneral && (
            <p className="text-sm text-muted-foreground">No hay cajas activas: se inicia sin cambio.</p>
          )}
          <ul className="flex flex-col gap-3">
            {(cajas ?? []).map((caja) => (
              <li key={caja.id} className="flex flex-col gap-1">
                <label htmlFor={`cambio-${caja.id}`} className="text-sm font-medium">
                  Cambio de {caja.name} ($)
                </label>
                <Input
                  id={`cambio-${caja.id}`}
                  inputMode="decimal"
                  placeholder="0"
                  value={montos[caja.id] ?? ""}
                  onChange={(e) => setMontos((prev) => ({ ...prev, [caja.id]: e.target.value }))}
                  aria-invalid={errores[caja.id] ? true : undefined}
                />
                {errores[caja.id] && <p className="text-sm text-destructive">{errores[caja.id]}</p>}
              </li>
            ))}
          </ul>
          {errorGeneral && (
            <p className="text-sm text-destructive" role="alert">
              {errorGeneral}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={cerrar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando}>
              {guardando ? "Iniciando..." : "Iniciar noche"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
