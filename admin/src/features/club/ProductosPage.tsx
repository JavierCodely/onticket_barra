import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ImageIcon, ImagePlus, Pencil, Plus, Power, PowerOff, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { FiltroCategorias, SIN_CATEGORIA, TODAS } from "@/features/club/FiltroCategorias"
import { PreciosPorBarra } from "@/features/club/PreciosPorBarra"
import { Selector } from "@/features/club/Selector"
import { Campo } from "@/features/clubs/ClubsPage"
import {
  actualizarCostoProducto,
  actualizarProducto,
  cambiarActivaCategoria,
  cambiarActivoProducto,
  crearCategoria,
  crearDeposito,
  crearProducto,
  listarCategorias,
  listarPreciosBarra,
  listarProductos,
  listarSaldos,
  listarUbicaciones,
  quitarFotoProducto,
  registrarMovimientos,
  subirFotoProducto,
  type Categoria,
  type Producto,
  type Saldo,
  type Ubicacion,
} from "@/lib/datos"
import { controlarCosto, notaDeCompra, unidadesDeCompra, validarPorCaja, type ModoCompra } from "@/lib/compra"
import { formatearMonto, valorEditable } from "@/lib/formato"
import type { PrecioBarra } from "@/lib/precios-barra"
import {
  TIPOS_FOTO,
  validarFoto,
  validarMovimiento,
  validarProducto,
  type ErroresMovimiento,
  type ErroresProducto,
  type TipoMovimiento,
  type ValorProducto,
} from "@/lib/validaciones"

type Props = {
  client: SupabaseClient
  clubId: string
}

type Formulario = "producto" | null

// Editar producto: toda la pantalla, con scroll propio.
const EDITAR_PANTALLA_COMPLETA =
  "top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-4 overflow-y-auto rounded-none p-4 sm:max-w-none sm:p-6"

// El "stock del producto" es lo que hay en los depositos (ubicaciones
// storage). A las barras se carga desde "Stock en barra".
export function ProductosPage({ client, clubId }: Props) {
  const [productos, setProductos] = useState<Producto[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([])
  const [saldos, setSaldos] = useState<Saldo[]>([])
  const [preciosBarra, setPreciosBarra] = useState<PrecioBarra[]>([])
  const [preciosBarraError, setPreciosBarraError] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formulario, setFormulario] = useState<Formulario>(null)
  const [filtroCategoria, setFiltroCategoria] = useState<string>(TODAS)
  const [editando, setEditando] = useState<Producto | null>(null)
  const [cargaDeposito, setCargaDeposito] = useState<Producto | null>(null)
  const [nuevaCategoria, setNuevaCategoria] = useState(false)

  const cargar = useCallback(async () => {
    // En paralelo con el resto; si falla, la lista se ve igual.
    const precios = listarPreciosBarra(client, clubId).then(
      (valor) => ({ ok: true as const, valor }),
      () => ({ ok: false as const, valor: [] }),
    )
    setCargando(true)
    setError(null)
    try {
      const [p, c, u, s] = await Promise.all([
        listarProductos(client, clubId),
        listarCategorias(client, clubId),
        listarUbicaciones(client, clubId),
        listarSaldos(client, clubId),
      ])
      setProductos(p)
      setCategorias(c)
      setUbicaciones(u)
      setSaldos(s)
    } catch {
      setError("No se pudieron cargar los productos.")
    } finally {
      setCargando(false)
    }
    const r = await precios
    setPreciosBarra(r.ok ? r.valor : [])
    setPreciosBarraError(!r.ok)
  }, [client, clubId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const depositos = ubicaciones.filter((u) => u.kind === "storage" && u.active)
  // Barras para el precio especial: las activas, y las inactivas que ya
  // tienen un precio de este producto (para poder quitarlo).
  const barrasConPrecio = (productoId: string) =>
    ubicaciones.filter(
      (u) =>
        u.kind === "bar" &&
        (u.active || preciosBarra.some((p) => p.product_id === productoId && p.location_id === u.id)),
    )
  const preciosDe = (productoId: string) =>
    preciosBarra
      .filter((p) => p.product_id === productoId)
      .map((p) => ({ ...p, barra: ubicaciones.find((u) => u.id === p.location_id)?.name ?? "Barra" }))
      .sort((a, b) => a.barra.localeCompare(b.barra))
  // El saldo lo calcula la base (trigger): se vuelve a leer, nunca se suma aca.
  const enDeposito = (productoId: string) =>
    saldos
      .filter((s) => s.product_id === productoId && depositos.some((d) => d.id === s.location_id))
      .reduce((total, s) => total + s.quantity, 0)

  function reemplazar(actualizado: Producto) {
    setProductos((prev) =>
      prev.map((x) => (x.id === actualizado.id ? actualizado : x)).sort((a, b) => a.name.localeCompare(b.name)),
    )
  }

  async function alternarActivo(producto: Producto) {
    setError(null)
    try {
      reemplazar(await cambiarActivoProducto(client, producto.id, !producto.active))
    } catch {
      setError(`No se pudo ${producto.active ? "inhabilitar" : "habilitar"} ${producto.name}.`)
    }
  }

  const visibles = productos.filter((p) =>
    filtroCategoria === TODAS
      ? true
      : filtroCategoria === SIN_CATEGORIA
        ? p.category_id === null
        : p.category_id === filtroCategoria,
  )

  async function recargarSaldos() {
    try {
      setSaldos(await listarSaldos(client, clubId))
    } catch {
      setError("Se registró el movimiento, pero no se pudo actualizar el stock. Recargá la página.")
    }
  }

  return (
    <div className="flex w-full max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Productos</h1>
          <p className="text-sm text-muted-foreground">Catálogo del club, categorías y stock del depósito.</p>
        </div>
        {formulario === null && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setNuevaCategoria(true)}>
              <Plus aria-hidden />
              Nueva categoría
            </Button>
            <Button onClick={() => setFormulario("producto")}>
              <Plus aria-hidden />
              Nuevo producto
            </Button>
          </div>
        )}
      </div>

      {!cargando && depositos.length === 0 && (
        <SinDeposito client={client} clubId={clubId} onCreado={(d) => setUbicaciones((prev) => [...prev, d])} />
      )}

      <Dialog open={formulario === "producto"} onOpenChange={(v) => !v && setFormulario(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nuevo producto</DialogTitle>
            <DialogDescription>La foto es opcional; también se puede agregar después desde Editar.</DialogDescription>
          </DialogHeader>
          {formulario === "producto" && (
            <CrearProductoForm
              client={client}
              clubId={clubId}
              categorias={categorias.filter((c) => c.active)}
              onCancelar={() => setFormulario(null)}
              onFotoFallida={(nombre) =>
                setError(`Se creó ${nombre}, pero no se pudo subir la foto. Probá de nuevo desde Editar.`)
              }
              onCreado={(p) => {
                setFormulario(null)
                setProductos((prev) => [...prev, p].sort((a, b) => a.name.localeCompare(b.name)))
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={nuevaCategoria} onOpenChange={setNuevaCategoria}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva categoría</DialogTitle>
            <DialogDescription>Las categorías son de este club. "Vaso" está siempre.</DialogDescription>
          </DialogHeader>
          {nuevaCategoria && (
            <NuevaCategoriaForm
              client={client}
              clubId={clubId}
              onCancelar={() => setNuevaCategoria(false)}
              onCreada={(c) => {
                setCategorias((prev) => [...prev, c])
                setNuevaCategoria(false)
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Editar ocupa toda la pantalla: a la izquierda foto y precios por
          barra, a la derecha los datos. En telefono, uno debajo del otro. */}
      <Dialog open={editando !== null} onOpenChange={(v) => !v && setEditando(null)}>
        <DialogContent className={EDITAR_PANTALLA_COMPLETA}>
          <DialogHeader>
            <DialogTitle>Editar producto{editando ? `: ${editando.name}` : ""}</DialogTitle>
            <DialogDescription>
              Cambiar el precio o el costo no modifica las ventas ya hechas: cada venta guarda su precio.
            </DialogDescription>
          </DialogHeader>
          <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-4">
              {editando && (
                <FotoProductoEditor
                  client={client}
                  clubId={clubId}
                  producto={editando}
                  onCambio={(actualizado) => {
                    reemplazar(actualizado)
                    setEditando(actualizado)
                  }}
                />
              )}
              {editando &&
                (preciosBarraError ? (
                  <p className="text-sm text-destructive" role="alert">
                    No se pudieron cargar los precios por barra.
                  </p>
                ) : (
                  <PreciosPorBarra
                    key={`precios-${editando.id}`}
                    client={client}
                    clubId={clubId}
                    producto={editando}
                    barras={barrasConPrecio(editando.id)}
                    precios={preciosBarra}
                    onGuardado={(delProducto) =>
                      setPreciosBarra((prev) => [...prev.filter((p) => p.product_id !== editando.id), ...delProducto])
                    }
                  />
                ))}
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              {editando && (
                <ProductoCampos
                  key={editando.id}
                  inicial={editando}
                  categorias={categorias.filter((c) => c.active || c.id === editando.category_id)}
                  textoBoton="Guardar cambios"
                  onCancelar={() => setEditando(null)}
                  onGuardar={async (valor) => {
                    reemplazar(await actualizarProducto(client, editando.id, valor))
                    setEditando(null)
                  }}
                />
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={cargaDeposito !== null} onOpenChange={(v) => !v && setCargaDeposito(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Cargar depósito{cargaDeposito ? `: ${cargaDeposito.name}` : ""}</DialogTitle>
            <DialogDescription>
              En depósito hay {cargaDeposito ? enDeposito(cargaDeposito.id) : 0}. Cada carga queda registrada con quién
              la hizo.
            </DialogDescription>
          </DialogHeader>
          {cargaDeposito && (
            <MovimientoForm
              key={cargaDeposito.id}
              client={client}
              clubId={clubId}
              productos={[cargaDeposito]}
              depositos={depositos}
              onCancelar={() => setCargaDeposito(null)}
              onCostoActualizado={reemplazar}
              onRegistrado={async (aviso) => {
                setCargaDeposito(null)
                if (aviso) setError(aviso)
                await recargarSaldos()
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {cargando ? (
        <p className="text-sm text-muted-foreground">Cargando productos...</p>
      ) : (
        <>
          {productos.length > 0 && (
            <FiltroCategorias
              productos={productos}
              categorias={categorias}
              valor={filtroCategoria}
              onCambio={setFiltroCategoria}
            />
          )}
          <TablaProductos
            productos={visibles}
            hayProductos={productos.length > 0}
            categorias={categorias}
            enDeposito={enDeposito}
            preciosDe={preciosDe}
            puedeCargar={depositos.length > 0}
            onEditar={setEditando}
            onCargar={setCargaDeposito}
            onAlternarActivo={(p) => void alternarActivo(p)}
          />
          <SeccionCategorias client={client} categorias={categorias} onCambio={setCategorias} />
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Sin deposito todavia: se crea con un boton
// ---------------------------------------------------------------------
function SinDeposito({
  client,
  clubId,
  onCreado,
}: {
  client: SupabaseClient
  clubId: string
  onCreado: (u: Ubicacion) => void
}) {
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Alert>
      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>
          El stock de los productos se guarda en el depósito: ahí entra la mercadería y desde ahí se carga cada barra.
        </span>
        <Button
          className="min-h-11 sm:min-h-9"
          disabled={guardando}
          onClick={async () => {
            setGuardando(true)
            setError(null)
            try {
              onCreado(await crearDeposito(client, clubId, "Depósito"))
            } catch {
              setError("No se pudo crear el depósito.")
            } finally {
              setGuardando(false)
            }
          }}
        >
          Crear depósito
        </Button>
      </AlertDescription>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </Alert>
  )
}

function TablaProductos({
  productos,
  hayProductos,
  categorias,
  enDeposito,
  preciosDe,
  puedeCargar,
  onEditar,
  onCargar,
  onAlternarActivo,
}: {
  productos: Producto[]
  hayProductos: boolean
  categorias: Categoria[]
  enDeposito: (productoId: string) => number
  preciosDe: (productoId: string) => (PrecioBarra & { barra: string })[]
  puedeCargar: boolean
  onEditar: (p: Producto) => void
  onCargar: (p: Producto) => void
  onAlternarActivo: (p: Producto) => void
}) {
  const nombreCategoria = (id: string | null) => categorias.find((c) => c.id === id)?.name ?? "—"
  const accion = "size-11 md:size-8"
  return (
    <section className="flex flex-col gap-2" aria-labelledby="titulo-productos">
      <h2 id="titulo-productos" className="sr-only">
        Lista de productos
      </h2>
      {!hayProductos ? (
        <p className="text-sm text-muted-foreground">Este club todavía no tiene productos.</p>
      ) : productos.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay productos en esta categoría.</p>
      ) : (
        // El scroll horizontal queda dentro de la tabla, nunca en la pagina (regla 28).
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-xs">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Producto</th>
                <th className="p-3 font-medium">Categoría</th>
                <th className="p-3 text-right font-medium">Costo</th>
                <th className="p-3 text-right font-medium">Precio</th>
                <th className="p-3 text-right font-medium">Stock (depósito)</th>
                <th className="p-3 font-medium">Estado</th>
                <th className="p-3 text-right font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {productos.map((p) => {
                const q = enDeposito(p.id)
                // Tocar cualquier parte de la fila abre "Cargar deposito"
                // (si hay deposito y el producto esta activo). El nombre es
                // ademas un boton, para llegar con el teclado.
                const cargable = puedeCargar && p.active
                return (
                  <tr
                    key={p.id}
                    onClick={cargable ? () => onCargar(p) : undefined}
                    title={cargable ? "Cargar depósito" : undefined}
                    className={`border-t border-border transition-colors hover:bg-muted/30 ${cargable ? "cursor-pointer" : ""} ${p.active ? "" : "text-muted-foreground"}`}
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <Miniatura url={p.image_url} nombre={p.name} />
                        <div className="min-w-0">
                          {cargable ? (
                            <button
                              type="button"
                              className="rounded-sm text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              aria-label={`Cargar depósito de ${p.name}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                onCargar(p)
                              }}
                            >
                              {p.name}
                            </button>
                          ) : (
                            <div className="font-medium">{p.name}</div>
                          )}
                          {p.sku && <div className="text-xs text-muted-foreground">{p.sku}</div>}
                          {p.units_per_box && (
                            <div className="text-xs text-muted-foreground">Caja x {p.units_per_box}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="p-3">{nombreCategoria(p.category_id)}</td>
                    <td className="p-3 text-right tabular-nums">{formatearMonto(p.cost)}</td>
                    <td className="p-3 text-right tabular-nums">
                      <div>{formatearMonto(p.price)}</div>
                      {preciosDe(p.id).map((pb) => (
                        <div key={pb.id} className="text-xs text-muted-foreground">
                          {pb.barra}: {formatearMonto(pb.price)}
                        </div>
                      ))}
                    </td>
                    <td
                      className={`p-3 text-right tabular-nums ${q < 0 ? "font-semibold text-destructive" : ""}`}
                      aria-label={`Stock de ${p.name} en depósito: ${q}`}
                    >
                      {q}
                    </td>
                    <td className="p-3">
                      <Badge variant={p.active ? "default" : "secondary"}>{p.active ? "Activo" : "Inhabilitado"}</Badge>
                    </td>
                    <td className="p-2">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className={accion}
                          aria-label={`Editar ${p.name}`}
                          title="Editar"
                          onClick={(e) => {
                            e.stopPropagation()
                            onEditar(p)
                          }}
                        >
                          <Pencil aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`${accion} ${p.active ? "text-destructive hover:text-destructive" : ""}`}
                          aria-label={`${p.active ? "Inhabilitar" : "Habilitar"} ${p.name}`}
                          title={p.active ? "Inhabilitar" : "Habilitar"}
                          onClick={(e) => {
                            e.stopPropagation()
                            onAlternarActivo(p)
                          }}
                        >
                          {p.active ? <PowerOff aria-hidden /> : <Power aria-hidden />}
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------
// Categorias del club ("Vaso" viene siempre)
// ---------------------------------------------------------------------
function SeccionCategorias({
  client,
  categorias,
  onCambio,
}: {
  client: SupabaseClient
  categorias: Categoria[]
  onCambio: (c: Categoria[]) => void
}) {
  const [error, setError] = useState<string | null>(null)

  async function alternar(c: Categoria, active: boolean) {
    setError(null)
    try {
      await cambiarActivaCategoria(client, c.id, active)
      onCambio(categorias.map((x) => (x.id === c.id ? { ...x, active } : x)))
    } catch {
      setError("No se pudo cambiar la categoría.")
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Categorías</CardTitle>
        <CardDescription>
          Activá o desactivá las categorías del club. Para crear una, usá "Nueva categoría" arriba.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul
          className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-xs"
          aria-label="Categorías"
        >
          {categorias.map((c) => (
            <li key={c.id} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2">
              <span className={c.active ? "font-medium" : "text-muted-foreground"}>{c.name}</span>
              <Switch
                checked={c.active}
                aria-label={`Activa: ${c.name}`}
                onCheckedChange={(v) => void alternar(c, v)}
              />
            </li>
          ))}
        </ul>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}

// Alta de categoria, dentro del modal "Nueva categoria".
function NuevaCategoriaForm({
  client,
  clubId,
  onCancelar,
  onCreada,
}: {
  client: SupabaseClient
  clubId: string
  onCancelar: () => void
  onCreada: (c: Categoria) => void
}) {
  const [nombre, setNombre] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const limpio = nombre.trim()
    if (!limpio) {
      setError("Ingresá el nombre de la categoría.")
      return
    }
    setError(null)
    setGuardando(true)
    try {
      onCreada(await crearCategoria(client, clubId, limpio))
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : ""
      setError(
        mensaje.includes("uq_product_categories_club_name")
          ? "Ya hay una categoría con ese nombre."
          : "No se pudo crear la categoría.",
      )
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Campo id="cat-nombre" etiqueta="Nombre de la categoría" error={error ?? undefined}>
        <Input
          id="cat-nombre"
          autoFocus
          placeholder="Ej: Cerveza, Botella, Sin alcohol"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />
      </Campo>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="submit" disabled={guardando}>
          {guardando ? "Creando..." : "Crear categoría"}
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------
// Movimiento manual en el deposito: cada carga es una linea del libro
// ---------------------------------------------------------------------
type TipoDeposito = Exclude<TipoMovimiento, "transfer">

const TIPOS: { value: TipoDeposito; label: string; ayuda: string }[] = [
  {
    value: "initial",
    label: "Stock inicial",
    ayuda: "Primera carga de un producto en el depósito.",
  },
  {
    value: "purchase",
    label: "Compra / reposición",
    ayuda: "Mercadería que entra al depósito.",
  },
  {
    value: "adjustment",
    label: "Ajuste",
    ayuda: "Corrección por conteo, rotura o pérdida. Negativo descuenta.",
  },
]

type MovimientoProps = {
  tipoInicial?: TipoDeposito
  client: SupabaseClient
  clubId: string
  productos: Producto[]
  depositos: Ubicacion[]
  onCancelar: () => void
  // aviso: se registro la carga pero algo secundario fallo (el costo).
  onRegistrado: (aviso?: string) => Promise<void>
  onCostoActualizado?: (producto: Producto) => void
}

// Por defecto siempre "Compra / reposicion". Si el producto viene por caja,
// se carga por cajas (o por unidades) y se guardan las UNIDADES. En la
// compra se ve el costo esperado y, con el total de la factura, si el
// costo subio o bajo, con la opcion de actualizarlo.
function MovimientoForm({
  tipoInicial = "purchase",
  client,
  clubId,
  productos,
  depositos,
  onCancelar,
  onRegistrado,
  onCostoActualizado,
}: MovimientoProps) {
  const [tipo, setTipo] = useState<TipoDeposito>(tipoInicial)
  const [productoId, setProductoId] = useState(productos[0]?.id ?? "")
  const [ubicacionId, setUbicacionId] = useState(depositos[0]?.id ?? "")
  const [cantidad, setCantidad] = useState("")
  const [nota, setNota] = useState("")
  const producto = productos.find((p) => p.id === productoId) ?? null
  const porCaja = producto?.units_per_box ?? null
  const [modo, setModo] = useState<ModoCompra>(porCaja ? "cajas" : "unidades")
  const [totalFactura, setTotalFactura] = useState("")
  const [actualizarCosto, setActualizarCosto] = useState(false)
  const [errores, setErrores] = useState<ErroresMovimiento>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  // Cajas solo al sumar mercaderia (compra o stock inicial), nunca en ajustes.
  const conCajas = porCaja !== null && tipo !== "adjustment"
  const modoActual: ModoCompra = conCajas ? modo : "unidades"
  const unidades = unidadesDeCompra(modoActual, cantidad, porCaja)
  const costo = producto && tipo === "purchase" ? controlarCosto(producto.cost, unidades, porCaja, totalFactura) : null
  const costoCambia = costo?.sentido === "subio" || costo?.sentido === "bajo"

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrorGeneral(null)
    if (modoActual === "cajas" && unidades === null) {
      setErrores({ cantidad: "Ingresá una cantidad entera de cajas mayor a 0." })
      return
    }
    if (costo?.facturaInvalida) {
      setErrores({})
      setErrorGeneral("El total de la factura no es un monto válido (ej: 54000 o 54000.50).")
      return
    }
    const resultado = validarMovimiento({
      tipo,
      productoId,
      ubicacionId,
      destinoId: "",
      cantidad: modoActual === "cajas" ? String(unidades) : cantidad,
      nota: notaDeCompra(modoActual, cantidad, porCaja, nota),
    })
    if (!resultado.ok) {
      setErrores(resultado.errores)
      return
    }
    setErrores({})
    setGuardando(true)
    try {
      await registrarMovimientos(client, clubId, resultado.valor)
    } catch {
      setErrorGeneral("No se pudo registrar el movimiento. Intentá de nuevo.")
      setGuardando(false)
      return
    }
    let aviso: string | undefined
    if (producto && costoCambia && actualizarCosto && costo?.costoUnidadFactura) {
      try {
        onCostoActualizado?.(await actualizarCostoProducto(client, producto.id, costo.costoUnidadFactura))
      } catch {
        aviso = `Se registró la compra, pero no se pudo actualizar el costo de ${producto.name}. Cambialo en Editar.`
      }
    }
    setGuardando(false)
    await onRegistrado(aviso)
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{TIPOS.find((t) => t.value === tipo)?.ayuda}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id="mov-tipo" etiqueta="Tipo">
          <Selector
            id="mov-tipo"
            value={tipo}
            onChange={(v) => setTipo(v as TipoDeposito)}
            opciones={TIPOS.map(({ value, label }) => ({ value, label }))}
          />
        </Campo>
        {productos.length > 1 && (
          <Campo id="mov-producto" etiqueta="Producto" error={errores.productoId}>
            <Selector
              id="mov-producto"
              value={productoId}
              onChange={setProductoId}
              opciones={productos.map((p) => ({ value: p.id, label: p.name }))}
            />
          </Campo>
        )}
        {depositos.length > 1 && (
          <Campo id="mov-ubicacion" etiqueta="Depósito" error={errores.ubicacionId}>
            <Selector
              id="mov-ubicacion"
              value={ubicacionId}
              onChange={setUbicacionId}
              opciones={depositos.map((u) => ({ value: u.id, label: u.name }))}
            />
          </Campo>
        )}
        {conCajas && (
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium" id="mov-modo">
              Cargar por
            </span>
            <div className="grid grid-cols-2 gap-2" role="group" aria-labelledby="mov-modo">
              {(["cajas", "unidades"] as const).map((m) => (
                <Button
                  key={m}
                  type="button"
                  variant={modoActual === m ? "default" : "outline"}
                  aria-pressed={modoActual === m}
                  className="min-h-11 sm:min-h-9"
                  onClick={() => setModo(m)}
                >
                  {m === "cajas" ? `Cajas (x ${porCaja})` : "Unidades"}
                </Button>
              ))}
            </div>
          </div>
        )}
        <Campo
          id="mov-cantidad"
          etiqueta={
            tipo === "adjustment"
              ? "Cantidad (negativa para descontar)"
              : modoActual === "cajas"
                ? "Cantidad de cajas"
                : "Cantidad de unidades"
          }
          error={errores.cantidad}
        >
          <Input
            id="mov-cantidad"
            inputMode={tipo === "adjustment" ? "text" : "numeric"}
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
          />
          {modoActual === "cajas" && unidades !== null && (
            <span className="text-xs text-muted-foreground" data-testid="unidades-de-cajas">
              = {unidades} unidades
            </span>
          )}
        </Campo>
        <Campo id="mov-nota" etiqueta="Nota (opcional)">
          <Input id="mov-nota" value={nota} onChange={(e) => setNota(e.target.value)} />
        </Campo>
      </div>
      {costo && (
        <section
          aria-label="Costo de compra"
          className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm"
        >
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Costo por unidad</dt>
            <dd className="text-right tabular-nums">{formatearMonto(costo.costoUnidad)}</dd>
            {costo.costoCaja && (
              <>
                <dt className="text-muted-foreground">Costo por caja (x {porCaja})</dt>
                <dd className="text-right tabular-nums">{formatearMonto(costo.costoCaja)}</dd>
              </>
            )}
            <dt className="font-medium">Total según costo{unidades !== null ? ` (${unidades} u.)` : ""}</dt>
            <dd className="text-right font-semibold tabular-nums" data-testid="total-segun-costo">
              {formatearMonto(costo.totalSegunCosto)}
            </dd>
          </dl>
          <Campo id="mov-factura" etiqueta="Total de la factura (opcional)">
            <Input
              id="mov-factura"
              inputMode="decimal"
              placeholder="Para comparar con el costo"
              value={totalFactura}
              onChange={(e) => {
                setTotalFactura(e.target.value)
                setActualizarCosto(false)
              }}
            />
          </Campo>
          {costo.costoUnidadFactura && (
            <div className="flex flex-col gap-2" data-testid="comparacion-factura">
              <p>
                Según la factura, cada unidad costó{" "}
                <span className="font-semibold tabular-nums">{formatearMonto(costo.costoUnidadFactura)}</span>.{" "}
                {costo.sentido === "igual" ? (
                  <span className="text-success">Coincide con el costo cargado.</span>
                ) : (
                  <span className={costo.sentido === "subio" ? "font-medium text-destructive" : "font-medium text-success"}>
                    {costo.sentido === "subio" ? "Subió" : "Bajó"}{" "}
                    {formatearMonto((costo.diferenciaUnidad ?? "0").replace("-", ""))} por unidad
                    {costo.variacion ? ` (${costo.variacion.replace("-", "")})` : ""}.
                  </span>
                )}
              </p>
              {costoCambia && (
                <label className="flex min-h-11 items-center gap-2">
                  <Checkbox checked={actualizarCosto} onCheckedChange={(v) => setActualizarCosto(v === true)} />
                  <span>Actualizar el costo del producto a {formatearMonto(costo.costoUnidadFactura)}</span>
                </label>
              )}
            </div>
          )}
        </section>
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
          {guardando ? "Guardando..." : "Registrar"}
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------
// Alta de producto (con categoria del club)
// ---------------------------------------------------------------------
type FormProps = {
  client: SupabaseClient
  clubId: string
  categorias: Categoria[]
  onCancelar: () => void
  onCreado: (producto: Producto) => void
  onFotoFallida: (nombre: string) => void
}

function CrearProductoForm({ client, clubId, categorias, onCancelar, onCreado, onFotoFallida }: FormProps) {
  return (
    <ProductoCampos
      categorias={categorias}
      textoBoton="Crear producto"
      conFoto
      onCancelar={onCancelar}
      onGuardar={async (valor, foto) => {
        const creado = await crearProducto(client, clubId, valor)
        if (!foto) return onCreado(creado)
        try {
          onCreado(await subirFotoProducto(client, clubId, creado, foto))
        } catch {
          onCreado(creado)
          onFotoFallida(creado.name)
        }
      }}
    />
  )
}

// Campos de producto, para crear y para editar. onGuardar lanza si falla.
function ProductoCampos({
  inicial,
  categorias,
  textoBoton,
  conFoto = false,
  onCancelar,
  onGuardar,
}: {
  inicial?: Producto
  categorias: Categoria[]
  textoBoton: string
  conFoto?: boolean
  onCancelar: () => void
  onGuardar: (valor: ValorProducto, foto: File | null) => Promise<void>
}) {
  const [foto, setFoto] = useState<File | null>(null)
  const [name, setName] = useState(inicial?.name ?? "")
  const [sku, setSku] = useState(inicial?.sku ?? "")
  const [categoryId, setCategoryId] = useState(inicial?.category_id ?? "")
  const [cost, setCost] = useState(inicial ? valorEditable(inicial.cost) : "")
  const [price, setPrice] = useState(inicial ? valorEditable(inicial.price) : "")
  const [vienePorCaja, setVienePorCaja] = useState(Boolean(inicial?.units_per_box))
  const [porCaja, setPorCaja] = useState(inicial?.units_per_box ? String(inicial.units_per_box) : "")
  const [errorPorCaja, setErrorPorCaja] = useState<string | null>(null)
  const [errores, setErrores] = useState<ErroresProducto>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrorGeneral(null)
    const resultado = validarProducto({ name, sku, categoryId, cost, price })
    const caja = validarPorCaja(vienePorCaja, porCaja)
    setErrorPorCaja(caja.ok ? null : caja.error)
    if (!resultado.ok) {
      setErrores(resultado.errores)
      return
    }
    if (!caja.ok) return
    setErrores({})
    setGuardando(true)
    try {
      await onGuardar({ ...resultado.valor, units_per_box: caja.valor }, foto)
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : ""
      setErrorGeneral(
        mensaje.includes("uq_products_club_name")
          ? "Ya hay un producto con ese nombre en este club."
          : mensaje.includes("uq_products_club_sku")
            ? "Ya hay un producto con ese SKU en este club."
            : "No se pudo guardar el producto. Intentá de nuevo.",
      )
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {conFoto && <FotoNueva foto={foto} onCambio={setFoto} />}
      <Campo id="prod-nombre" etiqueta="Nombre" error={errores.name}>
        <Input id="prod-nombre" value={name} onChange={(e) => setName(e.target.value)} />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id="prod-categoria" etiqueta="Categoría" error={errores.categoryId}>
          <Selector
            id="prod-categoria"
            value={categoryId}
            onChange={setCategoryId}
            vacio="Sin categoría"
            opciones={categorias.map((c) => ({
              value: c.id,
              label: c.active ? c.name : `${c.name} (inactiva)`,
            }))}
          />
        </Campo>
        <Campo id="prod-sku" etiqueta="SKU (opcional)" error={errores.sku}>
          <Input id="prod-sku" value={sku} onChange={(e) => setSku(e.target.value)} />
        </Campo>
        <Campo id="prod-costo" etiqueta="Costo" error={errores.cost}>
          <Input
            id="prod-costo"
            inputMode="decimal"
            placeholder="0"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
        </Campo>
        <Campo id="prod-precio" etiqueta="Precio" error={errores.price}>
          <Input id="prod-precio" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Campo>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <Checkbox checked={vienePorCaja} onCheckedChange={(v) => setVienePorCaja(v === true)} />
          <span>
            <span className="font-medium">Viene por caja</span>
            <span className="block text-xs text-muted-foreground">Al comprar se carga por cajas.</span>
          </span>
        </label>
        {vienePorCaja && (
          <Campo id="prod-por-caja" etiqueta="Unidades por caja" error={errorPorCaja ?? undefined}>
            <Input
              id="prod-por-caja"
              inputMode="numeric"
              placeholder="Ej: 6"
              value={porCaja}
              onChange={(e) => setPorCaja(e.target.value)}
            />
          </Campo>
        )}
      </div>
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
          {guardando ? "Guardando..." : textoBoton}
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------
// Fotos de productos (bucket publico de solo lectura; archivo 14)
// ---------------------------------------------------------------------
export function Miniatura({ url, nombre, tamano = "sm" }: { url: string | null; nombre: string; tamano?: "sm" | "lg" }) {
  const [fallo, setFallo] = useState(false)
  const clases = tamano === "lg" ? "size-24 rounded-xl" : "size-10 rounded-lg"
  if (!url || fallo) {
    return (
      <span
        aria-hidden
        className={`${clases} flex shrink-0 items-center justify-center border border-dashed border-border bg-muted/50 text-muted-foreground`}
      >
        <ImageIcon className={tamano === "lg" ? "size-7" : "size-4"} />
      </span>
    )
  }
  return (
    <img
      src={url}
      alt={`Foto de ${nombre}`}
      loading="lazy"
      onError={() => setFallo(true)}
      className={`${clases} shrink-0 border border-border bg-muted object-cover`}
    />
  )
}

// Boton que abre el selector de archivos. El input queda accesible por su
// etiqueta (lectores de pantalla y pruebas), y visualmente es un boton.
function BotonElegirFoto({
  etiqueta,
  deshabilitado,
  onElegir,
}: {
  etiqueta: string
  deshabilitado?: boolean
  onElegir: (archivo: File) => void
}) {
  const id = useId()
  return (
    <>
      <input
        id={id}
        type="file"
        accept={TIPOS_FOTO.join(",")}
        className="peer sr-only"
        disabled={deshabilitado}
        onChange={(e) => {
          const archivo = e.target.files?.[0]
          e.target.value = ""
          if (archivo) onElegir(archivo)
        }}
      />
      <label
        htmlFor={id}
        className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium shadow-xs transition-colors hover:bg-muted peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 sm:min-h-8 ${deshabilitado ? "pointer-events-none opacity-50" : ""}`}
      >
        <ImagePlus aria-hidden className="size-4" />
        {etiqueta}
      </label>
    </>
  )
}

// En "Editar": la foto se sube o se quita en el momento.
export function FotoProductoEditor({
  client,
  clubId,
  producto,
  onCambio,
}: {
  client: SupabaseClient
  clubId: string
  producto: Producto
  onCambio: (p: Producto) => void
}) {
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function subir(archivo: File) {
    const invalida = validarFoto(archivo)
    if (invalida) {
      setError(invalida)
      return
    }
    setError(null)
    setGuardando(true)
    try {
      onCambio(await subirFotoProducto(client, clubId, producto, archivo))
    } catch {
      setError("No se pudo subir la foto. Intentá de nuevo.")
    } finally {
      setGuardando(false)
    }
  }

  async function quitar() {
    setError(null)
    setGuardando(true)
    try {
      onCambio(await quitarFotoProducto(client, producto))
    } catch {
      setError("No se pudo quitar la foto.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <section aria-label="Foto del producto" className="flex items-center gap-4 rounded-xl border border-border p-3">
      <Miniatura key={producto.image_url ?? "sin"} url={producto.image_url} nombre={producto.name} tamano="lg" />
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <BotonElegirFoto
            etiqueta={producto.image_url ? "Cambiar foto" : "Subir foto"}
            deshabilitado={guardando}
            onElegir={(a) => void subir(a)}
          />
          {producto.image_url && (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 text-destructive hover:text-destructive sm:min-h-8"
              disabled={guardando}
              onClick={() => void quitar()}
            >
              <Trash2 aria-hidden />
              Quitar foto
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {guardando ? "Guardando foto..." : "JPG, PNG o WebP, hasta 2 MB. Se ve en el posnet."}
        </p>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}

// En "Nuevo producto": se elige la foto y se sube al crear el producto.
function FotoNueva({ foto, onCambio }: { foto: File | null; onCambio: (f: File | null) => void }) {
  const [error, setError] = useState<string | null>(null)
  // Vista previa local del archivo elegido; se libera al cambiarlo.
  const vista = useMemo(
    () => (foto && typeof URL.createObjectURL === "function" ? URL.createObjectURL(foto) : null),
    [foto],
  )
  useEffect(() => {
    return () => {
      if (vista) URL.revokeObjectURL(vista)
    }
  }, [vista])

  return (
    <section aria-label="Foto del producto" className="flex items-center gap-4 rounded-xl border border-border p-3">
      <Miniatura key={vista ?? "sin"} url={vista} nombre={foto?.name ?? "producto nuevo"} tamano="lg" />
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <BotonElegirFoto
            etiqueta={foto ? "Cambiar foto" : "Elegir foto (opcional)"}
            onElegir={(archivo) => {
              const invalida = validarFoto(archivo)
              setError(invalida)
              if (!invalida) onCambio(archivo)
            }}
          />
          {foto && (
            <Button type="button" variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => onCambio(null)}>
              <Trash2 aria-hidden />
              Quitar
            </Button>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">{foto ? foto.name : "JPG, PNG o WebP, hasta 2 MB."}</p>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}
