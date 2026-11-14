import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { Pencil, Plus } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { CatalogoProductos, GRILLA_CATALOGO, PANTALLA_COMPLETA } from "@/features/club/CatalogoProductos"
import { Miniatura } from "@/features/club/ProductosPage"
import { Campo } from "@/features/clubs/ClubsPage"
import {
  ErrorDePromocion,
  actualizarPromocion,
  cambiarActivoPromocion,
  crearPromocion,
  listarCategorias,
  listarEstadoPromociones,
  listarProductos,
  listarPromociones,
  listarUbicaciones,
  type Categoria,
  type EstadoPromocion,
  type Producto,
  type Promocion,
  type Ubicacion,
} from "@/lib/datos"
import { formatearMonto } from "@/lib/formato"
import {
  DIAS,
  TIPOS_PROMOCION,
  TODOS_LOS_DIAS,
  cruzaMedianoche,
  describirDescuento,
  describirVigencia,
  ejemploDescuento,
  formDesde,
  formVacio,
  validarPromocion,
  type ErroresPromocion,
  type FormPromocion,
  type TipoPromocion,
  type ValorPromocion,
} from "@/lib/promociones"

export const AVISO_DESACTIVAR_PROMO =
  "Las ventas anteriores conservan su descuento. Desde ahora el posnet no la aplicará a ventas nuevas."

type Props = {
  client: SupabaseClient
  clubId: string
}

// Estado que se muestra en la lista.
function etiquetaEstado(p: Promocion, e: EstadoPromocion | undefined): { texto: string; variante: "default" | "secondary" | "outline" } {
  if (!p.active) return { texto: "Inactiva", variante: "secondary" }
  if (e?.expired) return { texto: "Vencida", variante: "secondary" }
  if (e?.applies_now) return { texto: "Aplicándose ahora", variante: "default" }
  return { texto: "Fuera de horario", variante: "outline" }
}

// Una promocion baja el precio que se cobra de UN producto, con vigencia
// (fechas, dias y franja horaria) y, si se eligen, solo en algunas barras.
// La aplica el posnet (sin conexion) y guarda el descuento en la venta.
export function PromocionesPage({ client, clubId }: Props) {
  const [promociones, setPromociones] = useState<Promocion[]>([])
  const [estados, setEstados] = useState<EstadoPromocion[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [edicion, setEdicion] = useState<null | "nueva" | Promocion>(null)
  const [aDesactivar, setADesactivar] = useState<Promocion | null>(null)
  const [cambiando, setCambiando] = useState(false)

  const cargarEstados = useCallback(async () => {
    try {
      setEstados(await listarEstadoPromociones(client, clubId))
    } catch {
      setEstados([])
    }
  }, [client, clubId])

  const cargar = useCallback(async () => {
    const estadosListos = cargarEstados() // en paralelo; no falla (atrapa su error)
    setCargando(true)
    setError(null)
    try {
      const [p, prod, u, cat] = await Promise.all([
        listarPromociones(client, clubId),
        listarProductos(client, clubId, "product"),
        listarUbicaciones(client, clubId),
        listarCategorias(client, clubId),
      ])
      setPromociones(p)
      setProductos(prod)
      setUbicaciones(u)
      setCategorias(cat)
    } catch {
      setError("No se pudieron cargar las promociones.")
    } finally {
      setCargando(false)
    }
    await estadosListos
  }, [client, clubId, cargarEstados])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const productoPorId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos])
  const nombreBarra = (id: string) => ubicaciones.find((u) => u.id === id)?.name ?? "Barra"
  const estadoDe = (id: string) => estados.find((e) => e.promotion_id === id)

  function reemplazar(p: Promocion) {
    setPromociones((prev) => [...prev.filter((x) => x.id !== p.id), p].sort((a, b) => a.name.localeCompare(b.name)))
  }

  async function cambiarActivo(p: Promocion, active: boolean) {
    setCambiando(true)
    setError(null)
    try {
      await cambiarActivoPromocion(client, p.id, active)
      reemplazar({ ...p, active })
      setADesactivar(null)
      await cargarEstados()
    } catch {
      setError("No se pudo cambiar el estado de la promoción.")
    } finally {
      setCambiando(false)
    }
  }

  return (
    <div className="flex w-full max-w-5xl flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Promociones</h1>
          <p className="text-sm text-muted-foreground">
            Bajan el precio que se cobra de un producto. Los impuestos se calculan sobre lo cobrado. Se activan y
            desactivan; nunca se borran.
          </p>
        </div>
        <Button className="min-h-11 shrink-0 sm:min-h-9" onClick={() => setEdicion("nueva")} disabled={cargando}>
          <Plus aria-hidden />
          Nueva promoción
        </Button>
      </div>

      {aDesactivar && (
        <Alert role="alertdialog" aria-labelledby="titulo-desactivar-promo">
          <AlertTitle id="titulo-desactivar-promo">¿Desactivar “{aDesactivar.name}”?</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>{AVISO_DESACTIVAR_PROMO}</span>
            <span className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setADesactivar(null)} disabled={cambiando}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                className="min-h-11 sm:min-h-9"
                onClick={() => void cambiarActivo(aDesactivar, false)}
                disabled={cambiando}
              >
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
        <p className="text-sm text-muted-foreground">Cargando promociones...</p>
      ) : promociones.length === 0 && !error ? (
        <p className="text-sm text-muted-foreground">Este club todavía no tiene promociones.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {promociones.map((p) => {
            const producto = productoPorId.get(p.product_id)
            const estado = etiquetaEstado(p, estadoDe(p.id))
            return (
              <li
                key={p.id}
                aria-label={p.name}
                className={`flex flex-col gap-3 rounded-lg border border-border bg-card p-4 md:flex-row md:items-center md:justify-between ${p.active ? "" : "text-muted-foreground"}`}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <Miniatura url={producto?.image_url ?? null} nombre={producto?.name ?? p.name} />
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      <Badge variant={estado.variante}>{estado.texto}</Badge>
                    </span>
                    <span className="text-sm">
                      {producto?.name ?? "Producto dado de baja"} · {describirDescuento(p)}
                    </span>
                    <span className="text-xs text-muted-foreground">{describirVigencia(p)}</span>
                    <span className="text-xs text-muted-foreground">
                      {p.barras.length === 0 ? "Todas las barras" : p.barras.map(nombreBarra).join(", ")}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <Switch
                      checked={p.active}
                      disabled={cambiando}
                      aria-label={`Activa: ${p.name}`}
                      onCheckedChange={(activa) => {
                        if (activa) void cambiarActivo(p, true)
                        else setADesactivar(p)
                      }}
                    />
                    {p.active ? "Activa" : "Inactiva"}
                  </label>
                  <Button
                    variant="outline"
                    className="min-h-11 sm:min-h-9"
                    onClick={() => setEdicion(p)}
                    aria-label={`Editar ${p.name}`}
                  >
                    <Pencil aria-hidden />
                    Editar
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog open={edicion !== null} onOpenChange={(abierto) => !abierto && setEdicion(null)}>
        <DialogContent className={PANTALLA_COMPLETA}>
          <DialogHeader>
            <DialogTitle>{edicion === "nueva" || edicion === null ? "Nueva promoción" : `Editar ${edicion.name}`}</DialogTitle>
            <DialogDescription>
              {edicion === "nueva" || edicion === null
                ? "Elegí el producto en el catálogo, el descuento y cuándo vale."
                : "Podés cambiar el nombre, la vigencia y las barras. El producto y el descuento no cambian: para otro descuento creá otra promoción."}
            </DialogDescription>
          </DialogHeader>
          {edicion !== null && (
            <PromocionForm
              key={edicion === "nueva" ? "nueva" : edicion.id}
              anterior={edicion === "nueva" ? null : edicion}
              productos={productos}
              categorias={categorias}
              barras={ubicaciones.filter(
                (u) => u.kind === "bar" && (u.active || (edicion !== "nueva" && edicion.barras.includes(u.id))),
              )}
              onCancelar={() => setEdicion(null)}
              onGuardar={async (valor) => {
                try {
                  const guardada =
                    edicion === "nueva"
                      ? await crearPromocion(client, clubId, valor)
                      : await actualizarPromocion(client, edicion, clubId, valor)
                  reemplazar(guardada)
                  setEdicion(null)
                  await cargarEstados()
                } catch (err) {
                  if (err instanceof ErrorDePromocion && err.promocionGuardada) {
                    reemplazar(err.promocionGuardada)
                    setEdicion(null)
                    // Releer lo que quedo en la base, y despues avisar (cargar borra el error)
                    await cargar()
                    setError(err.message)
                    return
                  }
                  throw err
                }
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------
type FormProps = {
  anterior: Promocion | null
  productos: Producto[]
  categorias: Categoria[]
  barras: Ubicacion[]
  onCancelar: () => void
  onGuardar: (valor: ValorPromocion) => Promise<void>
}

function PromocionForm({ anterior, productos, categorias, barras, onCancelar, onGuardar }: FormProps) {
  const [f, setF] = useState<FormPromocion>(anterior ? formDesde(anterior) : formVacio())
  const [errores, setErrores] = useState<ErroresPromocion>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const editando = anterior !== null
  const cambiar = (parcial: Partial<FormPromocion>) => setF((prev) => ({ ...prev, ...parcial }))

  // Solo productos activos (y el de la promocion, aunque ya no lo este).
  const catalogo = productos.filter((p) => p.active || p.id === anterior?.product_id)
  const producto = productos.find((p) => p.id === f.productId)

  const validacion = validarPromocion(f)
  const ejemplo = producto && validacion.ok ? ejemploDescuento(validacion.valor, producto.price) : null

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setErrorGeneral(null)
    if (!validacion.ok) {
      setErrores(validacion.errores)
      return
    }
    setErrores({})
    setGuardando(true)
    try {
      await onGuardar(validacion.valor)
    } catch {
      setErrorGeneral("No se pudo guardar la promoción. Revisá los datos y volvé a intentar.")
    } finally {
      setGuardando(false)
    }
  }

  function alternarDia(bit: number, marcado: boolean) {
    cambiar({ weekdays: marcado ? f.weekdays | bit : f.weekdays & ~bit })
  }
  function alternarBarra(id: string, marcada: boolean) {
    cambiar({ barras: marcada ? [...f.barras, id] : f.barras.filter((b) => b !== id) })
  }

  // El catalogo queda FUERA del <form>: sus botones no lo envian.
  return (
    <div className={GRILLA_CATALOGO}>
      <CatalogoProductos
        productos={catalogo}
        categorias={categorias}
        elegidos={new Set(f.productId ? [f.productId] : [])}
        onElegir={(p) => cambiar({ productId: p.id })}
        onQuitar={() => cambiar({ productId: "" })}
        textoElegir={(n) => `Elegir ${n}`}
        textoQuitar={(n) => `Quitar ${n}`}
        bloqueado={editando}
        aviso={
          editando
            ? "El producto no cambia: para otro producto creá otra promoción."
            : "Elegí el producto de la promoción (uno solo)."
        }
      />

    <form
      noValidate
      onSubmit={(e) => void guardar(e)}
      className="flex min-h-0 min-w-0 flex-col gap-5 lg:overflow-y-auto lg:pr-1"
    >
      <section
        aria-label="Producto elegido"
        className={`flex items-center gap-3 rounded-lg border p-3 ${producto ? "border-primary bg-accent" : "border-dashed border-border"}`}
      >
        {producto ? (
          <>
            <Miniatura url={producto.image_url} nombre={producto.name} />
            <div className="min-w-0">
              <div className="truncate font-medium">{producto.name}</div>
              <div className="text-xs tabular-nums text-muted-foreground">Precio {formatearMonto(producto.price)}</div>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {editando ? "Producto dado de baja" : "Todavía no elegiste el producto. Elegílo en el catálogo."}
          </p>
        )}
      </section>
      {errores.productId && (
        <p className="-mt-3 text-sm text-destructive" role="alert">
          {errores.productId}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4">
        <Campo id="promo-nombre" etiqueta="Nombre" error={errores.name}>
          <Input
            id="promo-nombre"
            className="h-11 sm:h-9"
            placeholder="Ej: Happy hour Fernet"
            value={f.name}
            onChange={(e) => cambiar({ name: e.target.value })}
          />
        </Campo>
      </div>

      {/* Descuento: fijo despues de crear */}
      <fieldset className="flex flex-col gap-3" disabled={editando}>
        <legend className="mb-2 text-sm font-medium">Descuento</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {TIPOS_PROMOCION.map((t) => (
            <label
              key={t.value}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm ${f.kind === t.value ? "border-primary bg-accent" : "border-border"}`}
            >
              <input
                type="radio"
                name="promo-tipo"
                className="size-4 accent-primary"
                checked={f.kind === t.value}
                onChange={() => cambiar({ kind: t.value as TipoPromocion })}
              />
              {t.label}
            </label>
          ))}
        </div>
        {f.kind === "percentage" && (
          <Campo id="promo-porcentaje" etiqueta="Porcentaje (%)" error={errores.valor}>
            <Input
              id="promo-porcentaje"
              inputMode="decimal"
              className="h-11 sm:h-9 sm:w-40"
              value={f.percentage}
              onChange={(e) => cambiar({ percentage: e.target.value })}
            />
          </Campo>
        )}
        {f.kind === "fixed_amount" && (
          <Campo
            id="promo-monto"
            etiqueta="Monto que se descuenta por unidad ($)"
            error={errores.valor}
            ayuda="Si es mayor que el precio, la unidad sale gratis (nunca negativo)."
          >
            <Input
              id="promo-monto"
              inputMode="decimal"
              className="h-11 sm:h-9 sm:w-40"
              value={f.fixedAmount}
              onChange={(e) => cambiar({ fixedAmount: e.target.value })}
            />
          </Campo>
        )}
        {f.kind === "nxm" && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-end gap-3">
              <Campo id="promo-lleva" etiqueta="Lleva">
                <Input
                  id="promo-lleva"
                  inputMode="numeric"
                  className="h-11 w-24 sm:h-9"
                  value={f.buyQuantity}
                  onChange={(e) => cambiar({ buyQuantity: e.target.value })}
                />
              </Campo>
              <Campo id="promo-paga" etiqueta="Paga">
                <Input
                  id="promo-paga"
                  inputMode="numeric"
                  className="h-11 w-24 sm:h-9"
                  value={f.payQuantity}
                  onChange={(e) => cambiar({ payQuantity: e.target.value })}
                />
              </Campo>
            </div>
            {errores.cantidades && (
              <p className="text-sm text-destructive" role="alert">
                {errores.cantidades}
              </p>
            )}
          </div>
        )}
      </fieldset>

      {ejemplo && (
        <p className="rounded-md bg-muted/50 p-3 text-sm" role="status" aria-label="Ejemplo del descuento">
          {ejemplo.cantidad === 1 ? "1 unidad" : `Llevando ${ejemplo.cantidad}`}: {formatearMonto(ejemplo.normal)} →{" "}
          <strong>{formatearMonto(ejemplo.conPromo)}</strong> (descuento {formatearMonto(ejemplo.descuento)}). Con precio
          por barra, el descuento se calcula sobre el precio de esa barra.
        </p>
      )}

      {/* Vigencia */}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">Cuándo vale</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo id="promo-desde" etiqueta="Desde (opcional)">
            <Input id="promo-desde" type="date" className="h-11 sm:h-9" value={f.startsOn} onChange={(e) => cambiar({ startsOn: e.target.value })} />
          </Campo>
          <Campo id="promo-hasta" etiqueta="Hasta (opcional)" error={errores.fechas}>
            <Input id="promo-hasta" type="date" className="h-11 sm:h-9" value={f.endsOn} onChange={(e) => cambiar({ endsOn: e.target.value })} />
          </Campo>
        </div>

        <div className="flex flex-col gap-2" role="group" aria-label="Días">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm">Días</span>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 sm:min-h-8"
              onClick={() => cambiar({ weekdays: TODOS_LOS_DIAS })}
            >
              Todos los días
            </Button>
          </div>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {DIAS.map((d) => (
              <label
                key={d.bit}
                className={`flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border text-sm ${(f.weekdays & d.bit) !== 0 ? "border-primary bg-accent" : "border-border"}`}
              >
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  aria-label={d.largo}
                  checked={(f.weekdays & d.bit) !== 0}
                  onChange={(e) => alternarDia(d.bit, e.target.checked)}
                />
                {d.corto}
              </label>
            ))}
          </div>
          {errores.dias && (
            <p className="text-sm text-destructive" role="alert">
              {errores.dias}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Los días son de la jornada: el viernes incluye la madrugada del sábado hasta que empieza la jornada
            siguiente.
          </p>
        </div>

        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={f.conHorario}
            onChange={(e) => cambiar({ conHorario: e.target.checked })}
          />
          Solo en un horario (happy hour)
        </label>
        {f.conHorario && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-end gap-3">
              <Campo id="promo-hora-inicio" etiqueta="De">
                <Input
                  id="promo-hora-inicio"
                  type="time"
                  className="h-11 w-36 sm:h-9"
                  value={f.startTime}
                  onChange={(e) => cambiar({ startTime: e.target.value })}
                />
              </Campo>
              <Campo id="promo-hora-fin" etiqueta="A">
                <Input
                  id="promo-hora-fin"
                  type="time"
                  className="h-11 w-36 sm:h-9"
                  value={f.endTime}
                  onChange={(e) => cambiar({ endTime: e.target.value })}
                />
              </Campo>
            </div>
            {errores.horario && (
              <p className="text-sm text-destructive" role="alert">
                {errores.horario}
              </p>
            )}
            {cruzaMedianoche(f.startTime, f.endTime) && (
              <p className="text-xs text-muted-foreground">Cruza la medianoche: termina al día siguiente.</p>
            )}
          </div>
        )}
      </fieldset>

      {/* Barras */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Barras</legend>
        {barras.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay barras: vale en todas.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {barras.map((b) => (
                <label
                  key={b.id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 text-sm"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={f.barras.includes(b.id)}
                    onChange={(e) => alternarBarra(b.id, e.target.checked)}
                  />
                  {b.name}
                  {!b.active && <span className="text-muted-foreground"> (inactiva)</span>}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {f.barras.length === 0 ? "Sin barras marcadas vale en todas." : "Vale solo en las barras marcadas."}
            </p>
          </>
        )}
      </fieldset>

      {errorGeneral && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{errorGeneral}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="submit" className="min-h-11 sm:min-h-9" disabled={guardando}>
          {guardando ? "Guardando..." : editando ? "Guardar cambios" : "Crear promoción"}
        </Button>
      </div>
    </form>
    </div>
  )
}
