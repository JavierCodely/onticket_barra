import { useState, type FormEvent } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { aplicarPreciosBarra, type Producto, type Ubicacion } from "@/lib/datos"
import { aTexto, formatearMonto } from "@/lib/formato"
import { planificarPreciosBarra, planVacio, type PrecioBarra } from "@/lib/precios-barra"

type Props = {
  client: SupabaseClient
  clubId: string
  producto: Producto
  barras: Ubicacion[]
  precios: PrecioBarra[]
  onGuardado: (preciosDelProducto: PrecioBarra[]) => void
}

// Una casilla por barra. Vacia = cobra el precio general. Toda caja de esa
// barra cobra este precio; las ventas ya hechas no cambian (regla 7).
export function PreciosPorBarra({ client, clubId, producto, barras, precios, onGuardado }: Props) {
  const inicial = () =>
    Object.fromEntries(
      barras.map((b) => {
        const actual = precios.find((p) => p.product_id === producto.id && p.location_id === b.id)
        return [b.id, actual ? aTexto(actual.price) : ""]
      }),
    )
  const [valores, setValores] = useState<Record<string, string>>(inicial)
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null)
  const [guardando, setGuardando] = useState(false)

  async function guardar(e: FormEvent) {
    e.preventDefault()
    const plan = planificarPreciosBarra(producto.id, precios, valores)
    if (!plan.ok) {
      setErrores(plan.errores)
      setMensaje(null)
      return
    }
    setErrores({})
    if (planVacio(plan.valor)) {
      setMensaje({ tipo: "ok", texto: "No hay cambios." })
      return
    }
    setGuardando(true)
    try {
      onGuardado(await aplicarPreciosBarra(client, clubId, producto.id, plan.valor))
      setMensaje({ tipo: "ok", texto: "Precios por barra guardados." })
    } catch {
      setMensaje({ tipo: "error", texto: "No se pudieron guardar los precios por barra. Intentá de nuevo." })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <section aria-labelledby="titulo-precios-barra" className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-col gap-0.5">
        <h3 id="titulo-precios-barra" className="text-sm font-medium">
          Precio por barra
        </h3>
        <p className="text-xs text-muted-foreground">
          Dejalo vacío para cobrar el precio general ({formatearMonto(producto.price)}). Las cajas de esa barra cobran
          el precio que pongas.
        </p>
      </div>
      {barras.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay barras. Creálas en Cajas/Barras.</p>
      ) : (
        <form noValidate onSubmit={(e) => void guardar(e)} className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            {barras.map((b) => {
              const id = `precio-barra-${b.id}`
              return (
                <div key={b.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-3">
                    <label htmlFor={id} className="min-w-0 flex-1 truncate text-sm">
                      {b.name}
                      {!b.active && <span className="text-muted-foreground"> (inactiva)</span>}
                    </label>
                    <Input
                      id={id}
                      inputMode="decimal"
                      className="h-11 w-36 text-right sm:h-9"
                      placeholder={aTexto(producto.price)}
                      value={valores[b.id] ?? ""}
                      onChange={(e) => {
                        const v = e.target.value
                        setValores((prev) => ({ ...prev, [b.id]: v }))
                        setMensaje(null)
                      }}
                      aria-invalid={errores[b.id] ? true : undefined}
                      aria-describedby={errores[b.id] ? `${id}-error` : undefined}
                    />
                  </div>
                  {errores[b.id] && (
                    <p id={`${id}-error`} className="text-right text-xs text-destructive" role="alert">
                      {errores[b.id]}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            {mensaje && (
              <p
                className={`text-sm ${mensaje.tipo === "error" ? "text-destructive" : "text-muted-foreground"}`}
                role={mensaje.tipo === "error" ? "alert" : "status"}
              >
                {mensaje.texto}
              </p>
            )}
            <Button type="submit" variant="outline" className="min-h-11 sm:min-h-9" disabled={guardando}>
              {guardando ? "Guardando..." : "Guardar precios por barra"}
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
