import { useCallback, useEffect, useState, type FormEvent } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Selector } from "@/features/club/Selector"
import { Campo } from "@/features/clubs/ClubsPage"
import {
  actualizarImpuesto,
  cambiarActivoImpuesto,
  crearImpuesto,
  listarImpuestos,
  listarMetodosPago,
  type Impuesto,
  type MetodoPago,
} from "@/lib/datos"
import { describirImpuesto, valorEditable } from "@/lib/formato"
import { validarImpuesto, type ErroresImpuesto, type TipoImpuesto } from "@/lib/validaciones"

// Texto exacto de CLAUDE.md, seccion 8.
export const AVISO_DESACTIVAR =
  "Las ventas anteriores conservan este impuesto. Desde ahora no se aplicará a ventas nuevas."

type Props = {
  client: SupabaseClient
  clubId: string
}

// Formulario abierto: null = cerrado, "nuevo" = alta, o el impuesto a editar.
type Edicion = null | "nuevo" | Impuesto

export function ImpuestosPage({ client, clubId }: Props) {
  const [impuestos, setImpuestos] = useState<Impuesto[]>([])
  const [metodos, setMetodos] = useState<MetodoPago[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [edicion, setEdicion] = useState<Edicion>(null)
  const [aDesactivar, setADesactivar] = useState<Impuesto | null>(null)
  const [cambiando, setCambiando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const [i, m] = await Promise.all([listarImpuestos(client, clubId), listarMetodosPago(client)])
      setImpuestos(i)
      setMetodos(m)
    } catch {
      setError("No se pudieron cargar los impuestos.")
    } finally {
      setCargando(false)
    }
  }, [client, clubId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const etiquetaMetodo = (code: string) => metodos.find((m) => m.code === code)?.label ?? code

  async function cambiarActivo(impuesto: Impuesto, active: boolean) {
    setCambiando(true)
    setError(null)
    try {
      await cambiarActivoImpuesto(client, impuesto.id, active)
      setImpuestos((prev) => prev.map((t) => (t.id === impuesto.id ? { ...t, active } : t)))
      setADesactivar(null)
    } catch {
      setError("No se pudo cambiar el estado del impuesto.")
    } finally {
      setCambiando(false)
    }
  }

  function guardado(impuesto: Impuesto) {
    setEdicion(null)
    setImpuestos((prev) =>
      [...prev.filter((t) => t.id !== impuesto.id), impuesto].sort((a, b) => a.name.localeCompare(b.name)),
    )
  }

  return (
    <div className="flex w-full max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Impuestos</h1>
          <p className="text-sm text-muted-foreground">Incluidos en el precio. Se activan y desactivan; nunca se borran.</p>
        </div>
        {edicion === null && <Button onClick={() => setEdicion("nuevo")}>Nuevo impuesto</Button>}
      </div>
      <p className="text-sm text-muted-foreground">
        Están incluidos en el precio: se descuentan de lo que el club se queda, según el método de pago.
      </p>

      {edicion !== null && (
        <ImpuestoForm
          // key: al pasar de un impuesto a otro, el formulario se reinicia.
          key={edicion === "nuevo" ? "nuevo" : edicion.id}
          client={client}
          clubId={clubId}
          metodos={metodos}
          anterior={edicion === "nuevo" ? null : edicion}
          onCancelar={() => setEdicion(null)}
          onGuardado={guardado}
        />
      )}

      {aDesactivar && (
        <Alert role="alertdialog" aria-labelledby="titulo-desactivar">
          <AlertTitle id="titulo-desactivar">¿Desactivar “{aDesactivar.name}”?</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>{AVISO_DESACTIVAR}</span>
            <span className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => setADesactivar(null)} disabled={cambiando}>
                Cancelar
              </Button>
              <Button variant="destructive" onClick={() => cambiarActivo(aDesactivar, false)} disabled={cambiando}>
                Desactivar
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {cargando ? (
        <p className="text-sm text-muted-foreground">Cargando impuestos...</p>
      ) : impuestos.length === 0 && !error ? (
        <p className="text-sm text-muted-foreground">Este club todavía no tiene impuestos.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {impuestos.map((t) => (
            <li
              key={t.id}
              className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t.name}</span>
                  <span className="text-sm tabular-nums text-muted-foreground">{describirImpuesto(t)}</span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {t.metodos.length === 0 ? (
                    <Badge variant="destructive">Sin métodos: no se aplica</Badge>
                  ) : (
                    t.metodos.map((m) => (
                      <Badge key={m} variant="secondary">
                        {etiquetaMetodo(m)}
                      </Badge>
                    ))
                  )}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <Switch
                    checked={t.active}
                    disabled={cambiando}
                    aria-label={`Activo: ${t.name}`}
                    onCheckedChange={(activo) => {
                      if (activo) void cambiarActivo(t, true)
                      else setADesactivar(t)
                    }}
                  />
                  {t.active ? "Activo" : "Inactivo"}
                </label>
                <Button variant="outline" onClick={() => setEdicion(t)} aria-label={`Editar ${t.name}`}>
                  Editar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type FormProps = {
  client: SupabaseClient
  clubId: string
  metodos: MetodoPago[]
  anterior: Impuesto | null
  onCancelar: () => void
  onGuardado: (impuesto: Impuesto) => void
}

function ImpuestoForm({ client, clubId, metodos, anterior, onCancelar, onGuardado }: FormProps) {
  const [name, setName] = useState(anterior?.name ?? "")
  const [kind, setKind] = useState<TipoImpuesto>(anterior?.kind ?? "percentage")
  const [valor, setValor] = useState(
    valorEditable(anterior ? (anterior.kind === "percentage" ? anterior.percentage : anterior.fixed_amount) : null),
  )
  const [elegidos, setElegidos] = useState<string[]>(anterior?.metodos ?? [])
  // Activos, mas los inactivos que este impuesto ya usa (solo para poder quitarlos).
  const opciones = metodos.filter((m) => m.active || anterior?.metodos.includes(m.code))
  const [errores, setErrores] = useState<ErroresImpuesto>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  function alternar(code: string, marcado: boolean) {
    setElegidos((prev) => (marcado ? [...prev, code] : prev.filter((c) => c !== code)))
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrorGeneral(null)
    const resultado = validarImpuesto({ name, kind, valor, metodos: elegidos })
    if (!resultado.ok) {
      setErrores(resultado.errores)
      return
    }
    setErrores({})
    setGuardando(true)
    try {
      onGuardado(
        anterior
          ? await actualizarImpuesto(client, clubId, anterior, resultado.valor)
          : await crearImpuesto(client, clubId, resultado.valor),
      )
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : ""
      setErrorGeneral(
        mensaje.includes("uq_taxes_club_name")
          ? "Ya hay un impuesto con ese nombre en este club."
          : "No se pudo guardar el impuesto. Revisá la lista y volvé a intentar.",
      )
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{anterior ? `Editar ${anterior.name}` : "Nuevo impuesto"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo id="imp-nombre" etiqueta="Nombre" error={errores.name}>
              <Input
                id="imp-nombre"
                placeholder="Ej: Comisión PIX"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Campo>
            <Campo id="imp-tipo" etiqueta="Tipo">
              <Selector
                id="imp-tipo"
                value={kind}
                onChange={(v) => setKind(v as TipoImpuesto)}
                opciones={[
                  { value: "percentage", label: "Porcentaje del precio" },
                  { value: "fixed", label: "Monto fijo por unidad" },
                ]}
              />
            </Campo>
            <Campo
              id="imp-valor"
              etiqueta={kind === "percentage" ? "Porcentaje (%)" : "Monto por unidad ($)"}
              error={errores.valor}
            >
              <Input id="imp-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
            </Campo>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Se aplica cuando se paga con</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {opciones.map((m) => (
                <label
                  key={m.code}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 text-sm"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={elegidos.includes(m.code)}
                    // un metodo que ya no se usa solo se puede quitar
                    disabled={!m.active && !elegidos.includes(m.code)}
                    onChange={(e) => alternar(m.code, e.target.checked)}
                  />
                  {m.active ? m.label : `${m.label} (ya no se usa)`}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Pago mixto: si una venta se paga con varios métodos, el impuesto se aplica solo a la parte pagada con
              los métodos marcados.
            </p>
            {errores.metodos && (
              <p className="text-sm text-destructive" role="alert">
                {errores.metodos}
              </p>
            )}
          </fieldset>

          {anterior && (
            <p className="text-xs text-muted-foreground">
              Los cambios valen para ventas nuevas: las ventas anteriores conservan el impuesto con el que se
              vendieron.
            </p>
          )}
          {errorGeneral && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{errorGeneral}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onCancelar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando}>
              {guardando ? "Guardando..." : anterior ? "Guardar cambios" : "Crear impuesto"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
