import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { RefreshCw } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { FiltroCategorias, SIN_CATEGORIA, TODAS } from "@/features/club/FiltroCategorias"
import { Selector } from "@/features/club/Selector"
import {
  fotosDeNoche,
  listarCategorias,
  listarNoches,
  listarPersonal,
  listarProductos,
  listarSaldos,
  listarUbicaciones,
  nombresAdministradores,
  recargasDeNoche,
  type Categoria,
  type Club,
  type FotoStock,
  type Noche,
  type Producto,
  type Recarga,
  type Saldo,
  type Ubicacion,
} from "@/lib/datos"
import { formatearFechaHora, formatearHora } from "@/lib/formato"
import { armarFilasInicioCierre, autorDeRecarga, jornadaDe, type FilaInicioCierre } from "@/lib/inicio-cierre"

type Props = {
  client: SupabaseClient
  club: Pick<Club, "id" | "timezone" | "business_day_start_hour">
  nocheAbierta: Noche | null
}

type DatosNoche = { fotos: FotoStock[]; recargas: Recarga[]; saldos: Saldo[] }

const SIN_DATOS: DatosNoche = { fotos: [], recargas: [], saldos: [] }

// Por noche y por barra: lo que habia al iniciar, lo que se recargo durante
// la noche y lo que quedo al parar (o lo que hay ahora, si sigue en curso).
export function InicioCierrePage({ client, club, nocheAbierta }: Props) {
  const [noches, setNoches] = useState<Noche[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [barras, setBarras] = useState<Ubicacion[]>([])
  const [personal, setPersonal] = useState<Map<string, string>>(new Map())
  const [administradores, setAdministradores] = useState<Map<string, string>>(new Map())
  const [fecha, setFecha] = useState("")
  const [nocheId, setNocheId] = useState("")
  const [barraId, setBarraId] = useState("")
  const [categoria, setCategoria] = useState(TODAS)
  const [datos, setDatos] = useState<DatosNoche>(SIN_DATOS)
  const [cargando, setCargando] = useState(true)
  const [cargandoNoche, setCargandoNoche] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<FilaInicioCierre | null>(null)

  const jornada = useCallback(
    (n: Noche) => jornadaDe(n.started_at, club.timezone, club.business_day_start_hour),
    [club.timezone, club.business_day_start_hour],
  )

  // Catalogos. Por defecto: la noche en curso o la ultima, y su jornada.
  useEffect(() => {
    let vigente = true
    Promise.all([
      listarNoches(client, club.id),
      listarProductos(client, club.id),
      listarCategorias(client, club.id),
      listarUbicaciones(client, club.id),
      listarPersonal(client, club.id),
      // Si falla, se muestra "Administrador".
      nombresAdministradores(client, club.id).catch(() => new Map<string, string>()),
    ])
      .then(([n, p, c, u, gente, admins]) => {
        if (!vigente) return
        setNoches(n)
        setProductos(p)
        setCategorias(c)
        const b = u.filter((x) => x.kind === "bar")
        setBarras(b)
        setBarraId((actual) => actual || b.find((x) => x.active)?.id || b[0]?.id || "")
        setPersonal(new Map(gente.map((x) => [x.id, x.full_name])))
        setAdministradores(admins)
        if (n[0]) {
          setNocheId((actual) => actual || n[0].id)
          setFecha((actual) => actual || jornada(n[0]))
        }
      })
      .catch(() => vigente && setError("No se pudo cargar la información de las noches."))
      .finally(() => vigente && setCargando(false))
    return () => {
      vigente = false
    }
  }, [client, club.id, jornada])

  // Una noche que se inicia en otro lado aparece y pasa a ser la vista.
  useEffect(() => {
    if (!nocheAbierta) return
    setNoches((prev) => (prev.some((n) => n.id === nocheAbierta.id) ? prev : [nocheAbierta, ...prev]))
    setNocheId(nocheAbierta.id)
    setFecha(jornada(nocheAbierta))
  }, [nocheAbierta, jornada])

  // Al parar la noche abierta, se vuelve a leer la lista (trae su hora de
  // cierre) y el cierre pasa a ser la foto final.
  const habiaNocheAbierta = useRef(nocheAbierta !== null)
  useEffect(() => {
    const antes = habiaNocheAbierta.current
    habiaNocheAbierta.current = nocheAbierta !== null
    if (!antes || nocheAbierta) return
    listarNoches(client, club.id)
      .then(setNoches)
      .catch(() => undefined)
  }, [nocheAbierta, client, club.id])

  const nochesDeLaFecha = useMemo(
    () => (fecha ? noches.filter((n) => jornada(n) === fecha) : noches),
    [noches, fecha, jornada],
  )
  const noche = noches.find((n) => n.id === nocheId) ?? null
  const enCurso = noche !== null && noche.ended_at === null

  function cambiarFecha(valor: string) {
    setFecha(valor)
    const primera = (valor ? noches.filter((n) => jornada(n) === valor) : noches)[0]
    setNocheId(primera?.id ?? "")
  }

  const leerNoche = useCallback(async () => {
    if (!noche) {
      setDatos(SIN_DATOS)
      return
    }
    setCargandoNoche(true)
    try {
      const [fotos, recargas, saldos] = await Promise.all([
        fotosDeNoche(client, noche.id),
        recargasDeNoche(client, club.id, noche),
        noche.ended_at === null ? listarSaldos(client, club.id) : Promise.resolve([]),
      ])
      setDatos({ fotos, recargas, saldos })
      setError(null)
    } catch {
      setError("No se pudo cargar el inicio y cierre de la noche.")
    } finally {
      setCargandoNoche(false)
    }
    // noche cambia de objeto al recargar la lista; alcanza con id y fin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, club.id, noche?.id, noche?.ended_at])

  useEffect(() => {
    void leerNoche()
  }, [leerNoche])

  const barra = barras.find((b) => b.id === barraId) ?? null
  const productoPorId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos])

  const filas = useMemo(() => {
    if (!barra) return []
    return armarFilasInicioCierre(barra.id, datos.fotos, datos.recargas, datos.saldos, enCurso)
      .map((f) => ({ ...f, producto: productoPorId.get(f.productId) }))
      .map((f) => ({
        ...f,
        nombre: f.producto?.name ?? "Producto dado de baja",
        category_id: f.producto?.category_id ?? null,
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [barra, datos, enCurso, productoPorId])

  const visibles = filas.filter((f) =>
    categoria === TODAS ? true : categoria === SIN_CATEGORIA ? f.category_id === null : f.category_id === categoria,
  )
  // Barras activas, y las inactivas solo si tienen datos en esta noche.
  const barrasVisibles = barras.filter(
    (b) =>
      b.active ||
      b.id === barraId ||
      datos.fotos.some((f) => f.location_id === b.id) ||
      datos.recargas.some((r) => r.location_id === b.id),
  )

  if (cargando) return <p className="text-sm text-muted-foreground">Cargando noches...</p>

  return (
    <div className="flex w-full max-w-5xl flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Inicio y cierre</h1>
          <p className="text-sm text-muted-foreground">
            Lo que había en cada barra al iniciar la noche, lo que se recargó y lo que quedó al pararla.
          </p>
        </div>
        <Button
          variant="outline"
          className="min-h-11 shrink-0 sm:min-h-9"
          onClick={() => void leerNoche()}
          disabled={!noche || cargandoNoche}
        >
          <RefreshCw aria-hidden className={cargandoNoche ? "animate-spin" : undefined} />
          Actualizar
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Fecha (jornada)</span>
          <Input
            id="inicio-cierre-fecha"
            type="date"
            className="h-11 sm:h-9"
            value={fecha}
            onChange={(e) => cambiarFecha(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Noche</span>
          <Selector
            id="inicio-cierre-noche"
            value={nocheId}
            onChange={setNocheId}
            vacio={nochesDeLaFecha.length === 0 ? "Sin noches en esta fecha" : undefined}
            opciones={nochesDeLaFecha.map((n) => ({ value: n.id, label: etiquetaNoche(n) }))}
          />
        </label>
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {noches.length === 0 ? (
        <Alert>
          <AlertDescription>Todavía no se inició ninguna noche. Iniciala con el botón de la cabecera.</AlertDescription>
        </Alert>
      ) : !noche ? (
        <Alert>
          <AlertDescription>No hay noches en esa fecha. Elegí otra.</AlertDescription>
        </Alert>
      ) : barras.length === 0 ? (
        <Alert>
          <AlertDescription>Todavía no hay barras. Creálas en Cajas/Barras.</AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium" id="inicio-cierre-barras">
              Barra
            </span>
            <div
              className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
              role="group"
              aria-labelledby="inicio-cierre-barras"
            >
              {barrasVisibles.map((b) => (
                <Button
                  key={b.id}
                  variant={b.id === barraId ? "default" : "outline"}
                  aria-pressed={b.id === barraId}
                  className="min-h-11 justify-start truncate"
                  onClick={() => setBarraId(b.id)}
                >
                  {b.name}
                </Button>
              ))}
            </div>
          </div>

          {barra && (
            <section className="flex flex-col gap-3" aria-labelledby="inicio-cierre-titulo">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="inicio-cierre-titulo" className="text-lg font-semibold">
                  {barra.name}
                </h2>
                {enCurso ? <Badge>Noche en curso</Badge> : <Badge variant="secondary">Noche cerrada</Badge>}
              </div>
              {enCurso && (
                <p className="text-sm text-muted-foreground">
                  La noche sigue en curso: el cierre muestra el stock de ahora en la barra.
                </p>
              )}

              {filas.length > 0 && (
                <FiltroCategorias productos={filas} categorias={categorias} valor={categoria} onCambio={setCategoria} />
              )}

              {cargandoNoche && filas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Cargando...</p>
              ) : filas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Esta barra no tuvo stock ni recargas en esta noche.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-xs">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="p-3 font-medium">Producto</th>
                        <th className="p-3 text-right font-medium">Inicio</th>
                        <th className="p-3 text-right font-medium">Recarga</th>
                        <th className="p-3 text-right font-medium">{enCurso ? "Cierre (ahora)" : "Cierre"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibles.map((f) => (
                        <tr
                          key={f.productId}
                          className="cursor-pointer border-t border-border hover:bg-muted/40"
                          onClick={() => setDetalle(f)}
                        >
                          <td className="p-3">
                            <button
                              type="button"
                              className="min-h-11 text-left font-medium underline-offset-4 hover:underline sm:min-h-0"
                              aria-label={`Ver detalle de ${f.nombre}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                setDetalle(f)
                              }}
                            >
                              {f.nombre}
                            </button>
                            {f.category_id && (
                              <div className="text-xs text-muted-foreground">
                                {categorias.find((c) => c.id === f.category_id)?.name}
                              </div>
                            )}
                          </td>
                          <td className="p-3 text-right tabular-nums">{f.inicio}</td>
                          <td className="p-3 text-right tabular-nums">
                            {f.recarga > 0 ? `+${f.recarga}` : "—"}
                          </td>
                          <td
                            className={`p-3 text-right tabular-nums ${f.cierre < 0 ? "font-semibold text-destructive" : ""}`}
                          >
                            {f.cierre}
                          </td>
                        </tr>
                      ))}
                      {visibles.length === 0 && (
                        <tr>
                          <td colSpan={4} className="p-3 text-muted-foreground">
                            No hay productos de esta categoría.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}

      <Dialog open={detalle !== null} onOpenChange={(v) => !v && setDetalle(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{detalle ? (productoPorId.get(detalle.productId)?.name ?? "Producto dado de baja") : ""}</DialogTitle>
            <DialogDescription>
              {barra?.name} · {noche ? etiquetaNoche(noche) : ""}
            </DialogDescription>
          </DialogHeader>
          {detalle && (
            <div className="flex flex-col gap-4">
              <dl className="grid grid-cols-3 gap-2 text-center">
                <Dato titulo="Inicio" valor={detalle.inicio} />
                <Dato titulo="Recarga" valor={detalle.recarga} />
                <Dato titulo={enCurso ? "Ahora" : "Cierre"} valor={detalle.cierre} />
              </dl>
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">Recargas</h3>
                {detalle.recargas.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hubo recargas de este producto en la noche.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                    {detalle.recargas.map((r) => (
                      <li key={r.id} className="flex items-start justify-between gap-3 p-3 text-sm">
                        <div className="flex min-w-0 flex-col">
                          <span className="font-medium">{autorDeRecarga(r, personal, administradores)}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatearFechaHora(r.occurred_at)}
                            {r.note ? ` · ${r.note}` : ""}
                          </span>
                        </div>
                        <span className="shrink-0 font-semibold tabular-nums">+{r.quantity}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Dato({ titulo, valor }: { titulo: string; valor: number }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <dt className="text-xs text-muted-foreground">{titulo}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${valor < 0 ? "text-destructive" : ""}`}>{valor}</dd>
    </div>
  )
}

function etiquetaNoche(n: Noche): string {
  return `${formatearFechaHora(n.started_at)} – ${n.ended_at ? formatearHora(n.ended_at) : "en curso"}`
}
