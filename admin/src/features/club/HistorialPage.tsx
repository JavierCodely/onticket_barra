import { useCallback, useEffect, useMemo, useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { RefreshCw } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  LIMITE_HISTORIAL,
  contarActividadPorDia,
  listarActividad,
  listarCajas,
  listarCategorias,
  listarMetodosPago,
  listarProductos,
  listarUbicaciones,
  nombresAdministradores,
  type Club,
} from "@/lib/datos"
import {
  NOMBRES_VACIOS,
  agruparPorDia,
  DIAS_SEMANA_CORTOS,
  armarMes,
  autorDe,
  describirActividad,
  fechaLarga,
  horaEn,
  hoyEn,
  sumarDias,
  textoCelda,
  type Actividad,
  type Celda,
  type NombresHistorial,
} from "@/lib/historial"

type Props = {
  client: SupabaseClient
  club: Pick<Club, "id" | "timezone">
}

const COLOR_NIVEL: Record<Celda["nivel"], string> = {
  0: "bg-muted",
  1: "bg-primary/25",
  2: "bg-primary/50",
  3: "bg-primary/75",
  4: "bg-primary",
}

// Todo lo que se hizo desde el panel en el club: que, quien y a que hora.
// Arriba, el calendario del mes en curso (un cuadro por dia, mas oscuro =
// mas cambios); tocar un cuadro filtra ese dia.
export function HistorialPage({ client, club }: Props) {
  const hoy = useMemo(() => hoyEn(club.timezone), [club.timezone])
  const [desde, setDesde] = useState(() => sumarDias(hoy, -6))
  const [hasta, setHasta] = useState(hoy)
  const [conteos, setConteos] = useState<Map<string, number>>(new Map())
  const [nombres, setNombres] = useState<NombresHistorial>(NOMBRES_VACIOS)
  const [filas, setFilas] = useState<Actividad[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  const mes = useMemo(() => armarMes(hoy, conteos), [hoy, conteos])
  const rangoInvalido = desde !== "" && hasta !== "" && desde > hasta

  // Grilla y nombres (ubicaciones, cajas, categorias, productos, metodos,
  // administradores), en paralelo. Si fallan los nombres, la lista se ve
  // igual con textos genericos.
  useEffect(() => {
    let vigente = true
    const nombresDe = <T,>(p: Promise<T>, vacio: T) => p.catch(() => vacio)
    Promise.all([
      contarActividadPorDia(client, club.id, mes.desde, hoy),
      nombresDe(listarUbicaciones(client, club.id), []),
      nombresDe(listarCajas(client, club.id), []),
      nombresDe(listarCategorias(client, club.id), []),
      nombresDe(listarProductos(client, club.id), []),
      nombresDe(listarProductos(client, club.id, "combo"), []),
      nombresDe(listarMetodosPago(client), []),
      nombresDe(nombresAdministradores(client, club.id), new Map<string, string>()),
    ])
      .then(([c, ubicaciones, cajas, categorias, productos, combos, metodos, administradores]) => {
        if (!vigente) return
        setConteos(c)
        setNombres({
          ubicaciones: new Map(ubicaciones.map((u) => [u.id, u.name])),
          cajas: new Map(cajas.map((x) => [x.id, x.name])),
          categorias: new Map(categorias.map((x) => [x.id, x.name])),
          productos: new Map([...productos, ...combos].map((x) => [x.id, x.name])),
          metodos: new Map(metodos.map((m) => [m.code, m.label])),
          administradores,
        })
      })
      .catch(() => vigente && setError("No se pudo cargar la actividad del mes."))
    return () => {
      vigente = false
    }
  }, [client, club.id, hoy, mes.desde, version])

  const leer = useCallback(async () => {
    if (!desde || !hasta || desde > hasta) {
      setFilas([])
      setCargando(false)
      return
    }
    setCargando(true)
    try {
      setFilas(await listarActividad(client, club.id, desde, hasta))
      setError(null)
    } catch {
      setError("No se pudo cargar el historial.")
    } finally {
      setCargando(false)
    }
  }, [client, club.id, desde, hasta])

  useEffect(() => {
    void leer()
  }, [leer, version])

  function elegirDia(fecha: string) {
    setDesde(fecha)
    setHasta(fecha)
  }

  const grupos = agruparPorDia(filas)
  const unDia = desde === hasta

  return (
    <div className="flex w-full max-w-5xl flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Historial</h1>
          <p className="text-sm text-muted-foreground">
            Cada cambio hecho desde el panel: qué se hizo, quién lo hizo y a qué hora.
          </p>
        </div>
        <Button
          variant="outline"
          className="min-h-11 shrink-0 sm:min-h-9"
          onClick={() => setVersion((v) => v + 1)}
          disabled={cargando}
        >
          <RefreshCw aria-hidden className={cargando ? "animate-spin" : undefined} />
          Actualizar
        </Button>
      </div>

      <section
        aria-labelledby="historial-mes"
        className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-xs sm:max-w-md sm:p-4"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="historial-mes" className="text-sm font-semibold first-letter:uppercase">
            {mes.nombre}
          </h2>
          <span className="text-xs text-muted-foreground">
            {mes.total} {mes.total === 1 ? "cambio" : "cambios"} en el mes
          </span>
        </div>
        <div role="group" aria-label="Cambios por día del mes" className="grid grid-cols-7 gap-1.5">
          {DIAS_SEMANA_CORTOS.map((d) => (
            <span key={d} aria-hidden className="text-center text-[11px] font-medium text-muted-foreground">
              {d}
            </span>
          ))}
          {mes.semanas.flat().map((celda, i) =>
            !celda ? (
              <span key={`v${i}`} aria-hidden />
            ) : celda.futuro ? (
              <span
                key={celda.fecha}
                aria-hidden
                className="flex aspect-square items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground/60"
              >
                {celda.dia}
              </span>
            ) : (
              <button
                key={celda.fecha}
                type="button"
                aria-label={textoCelda(celda)}
                aria-pressed={unDia && celda.fecha === desde}
                title={textoCelda(celda)}
                onClick={() => elegirDia(celda.fecha)}
                className={cn(
                  "flex aspect-square min-h-9 items-center justify-center rounded-md text-xs font-medium tabular-nums outline-offset-2 transition-colors hover:outline hover:outline-2 hover:outline-ring",
                  COLOR_NIVEL[celda.nivel],
                  celda.nivel >= 3 ? "text-primary-foreground" : "text-foreground",
                  celda.fecha === hoy && "ring-2 ring-ring ring-offset-1 ring-offset-card",
                  unDia && celda.fecha === desde && "outline outline-2 outline-foreground",
                )}
              >
                {celda.dia}
              </button>
            ),
          )}
        </div>
        <div className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground" aria-hidden>
          <span className="mr-1">Menos</span>
          {([0, 1, 2, 3, 4] as const).map((n) => (
            <span key={n} className={cn("size-3 rounded-[3px]", COLOR_NIVEL[n])} />
          ))}
          <span className="ml-1">Más</span>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end lg:max-w-2xl">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Desde</span>
          <Input
            type="date"
            className="h-11 sm:h-9"
            value={desde}
            max={hoy}
            onChange={(e) => setDesde(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Hasta</span>
          <Input
            type="date"
            className="h-11 sm:h-9"
            value={hasta}
            max={hoy}
            onChange={(e) => setHasta(e.target.value)}
          />
        </label>
        <Button
          variant="outline"
          className="min-h-11 sm:min-h-9"
          onClick={() => {
            setDesde(sumarDias(hoy, -6))
            setHasta(hoy)
          }}
        >
          Últimos 7 días
        </Button>
      </div>

      {rangoInvalido && (
        <Alert role="alert">
          <AlertDescription>La fecha "desde" es posterior a "hasta".</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {filas.length >= LIMITE_HISTORIAL && (
        <Alert>
          <AlertDescription>
            Se muestran los {LIMITE_HISTORIAL} cambios más recientes. Acotá las fechas para ver el resto.
          </AlertDescription>
        </Alert>
      )}

      {cargando && filas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Cargando historial...</p>
      ) : !rangoInvalido && grupos.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {unDia ? `Sin cambios el ${fechaLarga(desde)}.` : "Sin cambios en esas fechas."}
        </p>
      ) : (
        <div className="flex flex-col gap-4" aria-label="Cambios">
          {grupos.map((g) => (
            <section key={g.fecha} aria-label={fechaLarga(g.fecha)} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold capitalize">
                {fechaLarga(g.fecha)}{" "}
                <span className="font-normal normal-case text-muted-foreground">
                  · {g.filas.length} {g.filas.length === 1 ? "cambio" : "cambios"}
                </span>
              </h3>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-xs">
                {g.filas.map((f) => {
                  const d = describirActividad(f, nombres)
                  return (
                    <li key={f.id} className="flex gap-3 p-3 text-sm">
                      <time
                        dateTime={f.occurred_at}
                        className="w-11 shrink-0 pt-px tabular-nums text-muted-foreground"
                      >
                        {horaEn(f.occurred_at, club.timezone)}
                      </time>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="break-words font-medium">{d.titulo}</span>
                        <span className="text-xs text-muted-foreground">por {autorDe(f, nombres)}</span>
                        {d.detalles.length > 0 && (
                          <ul className="mt-1 flex flex-col gap-0.5 text-xs">
                            {d.detalles.map((x, i) => (
                              <li key={i} className="break-words">
                                {x}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
