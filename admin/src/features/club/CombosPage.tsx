import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { Pencil, Plus, Power, PowerOff, Trash2 } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { CatalogoProductos, GRILLA_CATALOGO, PANTALLA_COMPLETA } from "@/features/club/CatalogoProductos"
import { FiltroCategorias, SIN_CATEGORIA, TODAS } from "@/features/club/FiltroCategorias"
import { PreciosPorBarra } from "@/features/club/PreciosPorBarra"
import { FotoProductoEditor, Miniatura } from "@/features/club/ProductosPage"
import { Selector } from "@/features/club/Selector"
import {
  ErrorDeCombo,
  actualizarCombo,
  cambiarActivoProducto,
  crearCombo,
  listarCategorias,
  listarComboItems,
  listarPreciosBarra,
  listarProductos,
  listarUbicaciones,
  type Categoria,
  type ComboItem,
  type Producto,
  type Ubicacion,
} from "@/lib/datos"
import {
  aCentavos,
  deCentavos,
  planificarComboItems,
  porcentaje,
  resumirCombo,
  totalesLinea,
  validarCombo,
  type ErroresCombo,
  type LineaCombo,
} from "@/lib/combos"
import { aTexto, formatearMonto, valorEditable } from "@/lib/formato"
import type { PrecioBarra } from "@/lib/precios-barra"

type Props = {
  client: SupabaseClient
  clubId: string
}


// Un combo agrupa productos con un precio propio. No tiene stock: al
// venderse descuenta el de sus productos (regla 10). Su precio es la suma
// de los precios individuales que se le ponen a cada producto en el combo,
// y su costo la de los costos; los dos los calcula la base.
export function CombosPage({ client, clubId }: Props) {
  const [combos, setCombos] = useState<Producto[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [items, setItems] = useState<ComboItem[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([])
  const [preciosBarra, setPreciosBarra] = useState<PrecioBarra[]>([])
  const [preciosBarraError, setPreciosBarraError] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filtro, setFiltro] = useState(TODAS)
  const [creando, setCreando] = useState(false)
  const [editando, setEditando] = useState<Producto | null>(null)

  const cargar = useCallback(async () => {
    // En paralelo con el resto; si falla, la lista se ve igual.
    const precios = listarPreciosBarra(client, clubId).then(
      (valor) => ({ ok: true as const, valor }),
      () => ({ ok: false as const, valor: [] }),
    )
    setCargando(true)
    setError(null)
    try {
      const [c, p, i, cat, u] = await Promise.all([
        listarProductos(client, clubId, "combo"),
        listarProductos(client, clubId, "product"),
        listarComboItems(client, clubId),
        listarCategorias(client, clubId),
        listarUbicaciones(client, clubId),
      ])
      setCombos(c)
      setProductos(p)
      setItems(i)
      setCategorias(cat)
      setUbicaciones(u)
    } catch {
      setError("No se pudieron cargar los combos.")
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

  const productoPorId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos])
  const itemsDe = (comboId: string) => items.filter((i) => i.combo_id === comboId)

  function reemplazar(combo: Producto, nuevosItems?: ComboItem[]) {
    setCombos((prev) =>
      [...prev.filter((c) => c.id !== combo.id), combo].sort((a, b) => a.name.localeCompare(b.name)),
    )
    if (nuevosItems) setItems((prev) => [...prev.filter((i) => i.combo_id !== combo.id), ...nuevosItems])
  }

  async function alternarActivo(combo: Producto) {
    setError(null)
    try {
      reemplazar(await cambiarActivoProducto(client, combo.id, !combo.active))
    } catch {
      setError(`No se pudo ${combo.active ? "inhabilitar" : "habilitar"} ${combo.name}.`)
    }
  }

  const visibles = combos.filter((c) =>
    filtro === TODAS ? true : filtro === SIN_CATEGORIA ? c.category_id === null : c.category_id === filtro,
  )
  const barras = (comboId: string) =>
    ubicaciones.filter(
      (u) => u.kind === "bar" && (u.active || preciosBarra.some((p) => p.product_id === comboId && p.location_id === u.id)),
    )

  return (
    <div className="flex w-full max-w-6xl flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Combos</h1>
          <p className="text-sm text-muted-foreground">
            Agrupá productos con un precio propio. El combo no tiene stock: al venderse descuenta el de sus productos.
          </p>
        </div>
        <Button className="min-h-11 shrink-0 sm:min-h-9" onClick={() => setCreando(true)} disabled={cargando}>
          <Plus aria-hidden />
          Nuevo combo
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {cargando ? (
        <p className="text-sm text-muted-foreground">Cargando combos...</p>
      ) : combos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Este club todavía no tiene combos.</p>
      ) : (
        <>
          <FiltroCategorias productos={combos} categorias={categorias} valor={filtro} onCambio={setFiltro} />
          {visibles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay combos en esta categoría.</p>
          ) : (
            // El scroll horizontal queda dentro de la tabla (regla 28).
            <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-xs">
              <table className="w-full min-w-[52rem] text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-3 font-medium">Combo</th>
                    <th className="p-3 font-medium">Productos</th>
                    <th className="p-3 text-right font-medium">Costo</th>
                    <th className="p-3 text-right font-medium">Precio</th>
                    <th className="p-3 text-right font-medium">Margen</th>
                    <th className="p-3 font-medium">Estado</th>
                    <th className="p-3 text-right font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((c) => {
                    const margen = aCentavos(c.price) - aCentavos(c.cost)
                    const deBarra = preciosBarra
                      .filter((p) => p.product_id === c.id)
                      .map((p) => ({ ...p, barra: ubicaciones.find((u) => u.id === p.location_id)?.name ?? "Barra" }))
                    return (
                      <tr key={c.id} className={`border-t border-border align-top ${c.active ? "" : "text-muted-foreground"}`}>
                        <td className="p-3">
                          <div className="flex items-center gap-3">
                            <Miniatura url={c.image_url} nombre={c.name} />
                            <div className="min-w-0">
                              <div className="font-medium">{c.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {categorias.find((x) => x.id === c.category_id)?.name ?? "Sin categoría"}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="p-3">
                          {itemsDe(c.id).length === 0 ? (
                            <span className="text-destructive">Sin productos</span>
                          ) : (
                            <ul className="flex flex-col gap-0.5">
                              {itemsDe(c.id).map((i) => (
                                <li key={i.id}>
                                  {i.quantity} × {productoPorId.get(i.product_id)?.name ?? "Producto dado de baja"}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="p-3 text-right tabular-nums">{formatearMonto(c.cost)}</td>
                        <td className="p-3 text-right tabular-nums">
                          <div>{formatearMonto(c.price)}</div>
                          {deBarra.map((p) => (
                            <div key={p.id} className="text-xs text-muted-foreground">
                              {p.barra}: {formatearMonto(p.price)}
                            </div>
                          ))}
                        </td>
                        <td className={`p-3 text-right tabular-nums ${margen < 0n ? "text-destructive" : ""}`}>
                          <div>{formatearMonto(deCentavos(margen))}</div>
                          <div className="text-xs text-muted-foreground">
                            {porcentaje(margen, aCentavos(c.price)) ?? "—"}
                          </div>
                        </td>
                        <td className="p-3">
                          <Badge variant={c.active ? "default" : "secondary"}>{c.active ? "Activo" : "Inhabilitado"}</Badge>
                        </td>
                        <td className="p-2">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-11 md:size-8"
                              aria-label={`Editar ${c.name}`}
                              title="Editar"
                              onClick={() => setEditando(c)}
                            >
                              <Pencil aria-hidden />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={`size-11 md:size-8 ${c.active ? "text-destructive hover:text-destructive" : ""}`}
                              aria-label={`${c.active ? "Inhabilitar" : "Habilitar"} ${c.name}`}
                              title={c.active ? "Inhabilitar" : "Habilitar"}
                              onClick={() => void alternarActivo(c)}
                            >
                              {c.active ? <PowerOff aria-hidden /> : <Power aria-hidden />}
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
        </>
      )}

      <Dialog open={creando} onOpenChange={setCreando}>
        <DialogContent className={PANTALLA_COMPLETA}>
          <DialogHeader>
            <DialogTitle>Nuevo combo</DialogTitle>
            <DialogDescription>
              Elegí los productos del catálogo y a qué precio se vende cada uno dentro del combo. La foto y el precio
              por barra se cargan después, en Editar.
            </DialogDescription>
          </DialogHeader>
          {creando && (
            <ComboForm
              productos={productos}
              categorias={categorias.filter((c) => c.active)}
              categoriasCatalogo={categorias}
              textoBoton="Crear combo"
              onCancelar={() => setCreando(false)}
              onGuardar={async (valor) => {
                try {
                  const r = await crearCombo(client, clubId, valor.valor)
                  reemplazar(r.combo, r.items)
                  setCreando(false)
                } catch (err) {
                  if (err instanceof ErrorDeCombo && err.comboCreado) {
                    reemplazar(err.comboCreado, [])
                    setCreando(false)
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

      <Dialog open={editando !== null} onOpenChange={(v) => !v && setEditando(null)}>
        <DialogContent className={PANTALLA_COMPLETA}>
          <DialogHeader>
            <DialogTitle>Editar combo</DialogTitle>
            <DialogDescription>
              Cambiar el combo no modifica las ventas ya hechas: cada venta guarda su precio y sus productos.
            </DialogDescription>
          </DialogHeader>
          {editando && (
            <ComboForm
              key={editando.id}
              inicial={editando}
              itemsIniciales={itemsDe(editando.id)}
              productos={productos}
              categorias={categorias.filter((c) => c.active || c.id === editando.category_id)}
              categoriasCatalogo={categorias}
              extra={
                <>
                  <FotoProductoEditor
                    client={client}
                    clubId={clubId}
                    producto={editando}
                    onCambio={(actualizado) => {
                      reemplazar(actualizado)
                      setEditando(actualizado)
                    }}
                  />
                  {preciosBarraError ? (
                    <p className="text-sm text-destructive" role="alert">
                      No se pudieron cargar los precios por barra.
                    </p>
                  ) : (
                    <PreciosPorBarra
                      key={`precios-${editando.id}-${aTexto(editando.price)}`}
                      client={client}
                      clubId={clubId}
                      producto={editando}
                      barras={barras(editando.id)}
                      precios={preciosBarra}
                      onGuardado={(delCombo) =>
                        setPreciosBarra((prev) => [...prev.filter((p) => p.product_id !== editando.id), ...delCombo])
                      }
                    />
                  )}
                </>
              }
              textoBoton="Guardar combo"
              onCancelar={() => setEditando(null)}
              onGuardar={async ({ valor }) => {
                const plan = planificarComboItems(itemsDe(editando.id), valor.items)
                const r = await actualizarCombo(client, clubId, editando.id, valor, plan)
                reemplazar(r.combo, r.items)
                setEditando(null)
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------
// Formulario: nombre, categoria y productos con su precio en el combo.
// Por cada producto: costo y precio normal (por la cantidad) y el precio
// individual en el combo. Abajo, los totales, el margen y el descuento.
// ---------------------------------------------------------------------
type ComboFormProps = {
  inicial?: Producto
  itemsIniciales?: ComboItem[]
  productos: Producto[]
  categorias: Categoria[] // para elegir la categoria del combo
  categoriasCatalogo: Categoria[] // para filtrar el catalogo
  extra?: ReactNode // en Editar: foto y precio por barra
  textoBoton: string
  onCancelar: () => void
  onGuardar: (r: { valor: Extract<ReturnType<typeof validarCombo>, { ok: true }>["valor"] }) => Promise<void>
}

function ComboForm({
  inicial,
  itemsIniciales = [],
  productos,
  categorias,
  categoriasCatalogo,
  extra,
  textoBoton,
  onCancelar,
  onGuardar,
}: ComboFormProps) {
  const [nombre, setNombre] = useState(inicial?.name ?? "")
  const [sku, setSku] = useState(inicial?.sku ?? "")
  const [categoriaId, setCategoriaId] = useState(inicial?.category_id ?? "")
  const [lineas, setLineas] = useState<LineaCombo[]>(() =>
    itemsIniciales.map((i) => {
      const p = productos.find((x) => x.id === i.product_id)
      return {
        productId: i.product_id,
        nombre: p?.name ?? "Producto dado de baja",
        cantidad: String(i.quantity),
        costoUnitario: p?.cost ?? 0,
        precioNormalUnitario: p?.price ?? 0,
        precioEnCombo: valorEditable(i.unit_price),
      }
    }),
  )
  const [errores, setErrores] = useState<ErroresCombo>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const resumen = resumirCombo(lineas)

  function agregarProducto(p: Producto) {
    if (lineas.some((l) => l.productId === p.id)) return
    setLineas((prev) => [
      ...prev,
      {
        productId: p.id,
        nombre: p.name,
        cantidad: "1",
        costoUnitario: p.cost,
        precioNormalUnitario: p.price,
        precioEnCombo: valorEditable(p.price),
      },
    ])
    setErrores((e) => ({ ...e, lineas: undefined }))
  }

  function quitarProducto(productId: string) {
    setLineas((prev) => prev.filter((x) => x.productId !== productId))
  }

  function cambiar(productId: string, campo: "cantidad" | "precioEnCombo", valor: string) {
    setLineas((prev) => prev.map((l) => (l.productId === productId ? { ...l, [campo]: valor } : l)))
  }

  async function guardar(e: FormEvent) {
    e.preventDefault()
    const r = validarCombo({ nombre, sku, categoriaId, lineas })
    if (!r.ok) {
      setErrores(r.errores)
      return
    }
    setErrores({})
    setErrorGeneral(null)
    setGuardando(true)
    try {
      await onGuardar({ valor: r.valor })
    } catch {
      setErrorGeneral("No se pudo guardar el combo. Intentá de nuevo.")
    } finally {
      setGuardando(false)
    }
  }

  // El catalogo y los editores de foto y precio por barra quedan FUERA del
  // <form> del combo: un formulario anidado haria que "Guardar precios por
  // barra" tambien guarde (y cierre) el combo.
  return (
    <div className={GRILLA_CATALOGO}>
      <CatalogoProductos
        productos={productos.filter((p) => p.active)}
        categorias={categoriasCatalogo}
        elegidos={new Set(lineas.map((l) => l.productId))}
        onElegir={agregarProducto}
        onQuitar={quitarProducto}
        textoElegir={(n) => `Agregar ${n} al combo`}
        textoQuitar={(n) => `Sacar ${n} del combo`}
      />

      <div className="flex min-h-0 min-w-0 flex-col gap-4 lg:overflow-y-auto lg:pr-1">
      {extra}
      <form noValidate onSubmit={(e) => void guardar(e)} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm sm:col-span-1">
          <span className="font-medium">Nombre</span>
          <Input
            className="h-11 sm:h-9"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            aria-invalid={errores.nombre ? true : undefined}
          />
          {errores.nombre && (
            <span className="text-xs text-destructive" role="alert">
              {errores.nombre}
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Categoría</span>
          <Selector
            id="combo-categoria"
            value={categoriaId}
            onChange={setCategoriaId}
            vacio="Sin categoría"
            opciones={categorias.map((c) => ({ value: c.id, label: c.name }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">SKU (opcional)</span>
          <Input className="h-11 sm:h-9" value={sku} onChange={(e) => setSku(e.target.value)} />
        </label>
      </div>

      <section aria-labelledby="titulo-productos-combo" className="flex flex-col gap-3">
        <h3 id="titulo-productos-combo" className="text-sm font-medium">
          Productos del combo
        </h3>
        {lineas.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            Todavía no agregaste productos. Elegílos en el catálogo.
          </p>
        )}
        {errores.lineas && (
          <p className="text-sm text-destructive" role="alert">
            {errores.lineas}
          </p>
        )}

        {lineas.length > 0 && (
          <ul className="flex flex-col gap-2">
            {lineas.map((l) => {
              const t = totalesLinea(l)
              const errorCantidad = errores.cantidad?.[l.productId]
              const errorPrecio = errores.precio?.[l.productId]
              return (
                <li
                  key={l.productId}
                  aria-label={l.nombre}
                  className="flex flex-col gap-3 rounded-lg border border-border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium">{l.nombre}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 text-destructive hover:text-destructive md:size-8"
                      aria-label={`Quitar ${l.nombre} del combo`}
                      onClick={() => quitarProducto(l.productId)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="text-muted-foreground">Cantidad</span>
                      <Input
                        inputMode="numeric"
                        aria-label={`Cantidad de ${l.nombre}`}
                        className="h-11 sm:h-9"
                        value={l.cantidad}
                        onChange={(e) => cambiar(l.productId, "cantidad", e.target.value.replace(/\D/g, ""))}
                        aria-invalid={errorCantidad ? true : undefined}
                      />
                      {errorCantidad && <span className="text-destructive">{errorCantidad}</span>}
                    </label>
                    <label className="col-span-1 flex flex-col gap-1 text-xs sm:col-span-2 sm:order-last">
                      <span className="text-muted-foreground">Precio individual en el combo</span>
                      <Input
                        inputMode="decimal"
                        aria-label={`Precio de ${l.nombre} en el combo`}
                        className="h-11 sm:h-9"
                        value={l.precioEnCombo}
                        onChange={(e) => cambiar(l.productId, "precioEnCombo", e.target.value)}
                        aria-invalid={errorPrecio ? true : undefined}
                      />
                      {errorPrecio && <span className="text-destructive">{errorPrecio}</span>}
                    </label>
                    <Dato
                      etiqueta={`Costo${l.cantidad !== "1" ? ` (× ${l.cantidad || 0})` : ""}`}
                      valor={formatearMonto(deCentavos(t.costo))}
                    />
                    <Dato
                      etiqueta={`Precio normal${l.cantidad !== "1" ? ` (× ${l.cantidad || 0})` : ""}`}
                      valor={formatearMonto(deCentavos(t.normal))}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    En el combo: <span className="font-medium text-foreground">{formatearMonto(deCentavos(t.combo))}</span>
                    {" · "}costo unitario {formatearMonto(l.costoUnitario)} · precio normal unitario{" "}
                    {formatearMonto(l.precioNormalUnitario)}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section
        aria-label="Resumen del combo"
        className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-5"
      >
        <Dato etiqueta="Costo total" valor={formatearMonto(resumen.costo)} />
        <Dato etiqueta="Precio normal total" valor={formatearMonto(resumen.precioNormal)} />
        <Dato etiqueta="Precio del combo" valor={formatearMonto(resumen.precioCombo)} destacado />
        <Dato
          etiqueta="Margen"
          valor={formatearMonto(resumen.margen)}
          detalle={resumen.margenPorcentaje ?? undefined}
          negativo={resumen.margen.startsWith("-")}
        />
        <Dato
          etiqueta="Descuento"
          valor={formatearMonto(resumen.descuento)}
          detalle={resumen.descuentoPorcentaje ?? undefined}
        />
      </section>

      {errorGeneral && (
        <p className="text-sm text-destructive" role="alert">
          {errorGeneral}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="submit" className="min-h-11 sm:min-h-9" disabled={guardando}>
          {guardando ? "Guardando..." : textoBoton}
        </Button>
      </div>
      </form>
      </div>
    </div>
  )
}

function Dato({
  etiqueta,
  valor,
  detalle,
  destacado,
  negativo,
}: {
  etiqueta: string
  valor: string
  detalle?: string
  destacado?: boolean
  negativo?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" role="group" aria-label={etiqueta}>
      <span className="text-xs text-muted-foreground">{etiqueta}</span>
      <span
        className={`tabular-nums ${destacado ? "text-base font-semibold" : "text-sm font-medium"} ${negativo ? "text-destructive" : ""}`}
      >
        {valor}
      </span>
      {detalle && <span className={`text-xs ${negativo ? "text-destructive" : "text-muted-foreground"}`}>{detalle}</span>}
    </div>
  )
}
