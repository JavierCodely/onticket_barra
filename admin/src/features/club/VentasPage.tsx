import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Selector } from "@/features/club/Selector"
import {
  FILTROS_VACIOS,
  LIMITE_VENTAS,
  agregarCambio,
  detalleDeVenta,
  listarCajas,
  listarMetodosPago,
  listarNoches,
  listarPersonal,
  listarVentas,
  resumenDeNoche,
  suscribirCambios,
  type Caja,
  type DetalleVenta,
  type FiltrosVentas,
  type MetodoPago,
  type Noche,
  type Persona,
  type ResumenCaja,
  type Venta,
} from "@/lib/datos"
import { formatearFechaHora, formatearHora, formatearMonto, sumarMontos } from "@/lib/formato"
import { validarCambio } from "@/lib/validaciones"

type Props = {
  client: SupabaseClient
  clubId: string
  nocheAbierta: Noche | null
}

export const ESTADO_VENTA = { pending: "Pendiente", delivered: "Retirado" } as const

export function VentasPage({ client, clubId, nocheAbierta }: Props) {
  const [noches, setNoches] = useState<Noche[]>([])
  const [cajas, setCajas] = useState<Caja[]>([])
  const [cajeros, setCajeros] = useState<Persona[]>([])
  const [metodos, setMetodos] = useState<MetodoPago[]>([])
  const [filtros, setFiltros] = useState<FiltrosVentas | null>(null)
  const [ventas, setVentas] = useState<Venta[]>([])
  const [resumen, setResumen] = useState<ResumenCaja[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [enVivo, setEnVivo] = useState(false)
  const [ventaElegida, setVentaElegida] = useState<Venta | null>(null)
  const [cambioPara, setCambioPara] = useState<ResumenCaja | null>(null)

  // Catalogos para los filtros. Por defecto se muestra la noche en curso
  // (o la ultima).
  useEffect(() => {
    let vigente = true
    Promise.all([
      listarNoches(client, clubId),
      listarCajas(client, clubId),
      listarPersonal(client, clubId),
      listarMetodosPago(client),
    ])
      .then(([n, c, p, m]) => {
        if (!vigente) return
        setNoches(n)
        setCajas(c)
        setCajeros(p.filter((x) => x.role === "cashier"))
        setMetodos(m)
        setFiltros((actual) => actual ?? { ...FILTROS_VACIOS, nocheId: n[0]?.id ?? "" })
      })
      .catch(() => {
        if (!vigente) return
        setError("No se pudieron cargar los filtros.")
        setFiltros((actual) => actual ?? FILTROS_VACIOS)
      })
    return () => {
      vigente = false
    }
  }, [client, clubId])

  // Si se inicia una noche nueva, se agrega a la lista y pasa a ser la vista.
  useEffect(() => {
    if (!nocheAbierta) return
    setNoches((prev) => (prev.some((n) => n.id === nocheAbierta.id) ? prev : [nocheAbierta, ...prev]))
    setFiltros((actual) => (actual && actual.nocheId !== nocheAbierta.id ? { ...actual, nocheId: nocheAbierta.id } : actual))
  }, [nocheAbierta])

  const recargar = useCallback(async () => {
    if (!filtros) return
    try {
      const [v, r] = await Promise.all([
        listarVentas(client, clubId, filtros),
        filtros.nocheId ? resumenDeNoche(client, filtros.nocheId) : Promise.resolve([]),
      ])
      setVentas(v)
      setResumen(r)
      setError(null)
    } catch {
      setError("No se pudieron cargar las ventas.")
    } finally {
      setCargando(false)
    }
  }, [client, clubId, filtros])

  useEffect(() => {
    void recargar()
  }, [recargar])

  // Tiempo real: una venta nueva, un pago, un retiro (la barra escanea el
  // QR) o un cambio de caja vuelven a leer la lista y el resumen.
  const ultimoRecargar = useRef(recargar)
  useEffect(() => {
    ultimoRecargar.current = recargar
  }, [recargar])
  useEffect(() => {
    let espera: ReturnType<typeof setTimeout> | undefined
    const desuscribir = suscribirCambios(
      client,
      clubId,
      ["sales", "sale_payments", "cash_register_floats"],
      () => {
        clearTimeout(espera)
        espera = setTimeout(() => void ultimoRecargar.current(), 300)
      },
      setEnVivo,
    )
    return () => {
      clearTimeout(espera)
      desuscribir()
    }
  }, [client, clubId])

  const etiquetaMetodo = useCallback(
    (code: string) => metodos.find((m) => m.code === code)?.label ?? code,
    [metodos],
  )

  if (!filtros) return <p className="text-sm text-muted-foreground">Cargando ventas...</p>

  const nocheElegida = noches.find((n) => n.id === filtros.nocheId) ?? null
  const nocheEnCurso = nocheElegida !== null && nocheAbierta?.id === nocheElegida.id
  const resumenVisible = filtros.cajaId ? resumen.filter((r) => r.cash_register_id === filtros.cajaId) : resumen

  return (
    <div className="flex w-full max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Ventas</h1>
          <p className="text-sm text-muted-foreground">En tiempo real, con el resumen de caja de la noche.</p>
        </div>
        <Badge variant={enVivo ? "default" : "secondary"} aria-live="polite">
          {enVivo ? "En vivo" : "Sin conexión en vivo"}
        </Badge>
      </div>

      {!nocheAbierta && (
        <Alert>
          <AlertDescription>
            No hay una noche en curso: los posnets no venden hasta que se presione "Iniciar noche".
          </AlertDescription>
        </Alert>
      )}

      <Filtros
        filtros={filtros}
        onCambiar={setFiltros}
        noches={noches}
        nocheAbiertaId={nocheAbierta?.id ?? null}
        cajas={cajas}
        cajeros={cajeros}
        metodos={metodos.filter((m) => m.active)}
      />

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {nocheElegida && (
        <ResumenNoche
          resumen={resumenVisible}
          enCurso={nocheEnCurso}
          onAgregarCambio={(caja) => setCambioPara(caja)}
        />
      )}

      <ListaVentas
        ventas={ventas}
        cargando={cargando}
        etiquetaMetodo={etiquetaMetodo}
        onElegir={setVentaElegida}
      />

      <DetalleVentaSheet
        client={client}
        venta={ventaElegida}
        etiquetaMetodo={etiquetaMetodo}
        onCerrar={() => setVentaElegida(null)}
      />

      {nocheElegida && (
        <AgregarCambioDialog
          client={client}
          clubId={clubId}
          nocheId={nocheElegida.id}
          caja={cambioPara}
          onCerrar={() => setCambioPara(null)}
          onGuardado={async () => {
            setCambioPara(null)
            await recargar()
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Filtros: noche, fechas, metodo, cajero, caja y estado
// ---------------------------------------------------------------------
function Filtros({
  filtros,
  onCambiar,
  noches,
  nocheAbiertaId,
  cajas,
  cajeros,
  metodos,
}: {
  filtros: FiltrosVentas
  onCambiar: (f: FiltrosVentas) => void
  noches: Noche[]
  nocheAbiertaId: string | null
  cajas: Caja[]
  cajeros: Persona[]
  metodos: MetodoPago[]
}) {
  const poner = (cambio: Partial<FiltrosVentas>) => onCambiar({ ...filtros, ...cambio })
  const etiquetaNoche = (n: Noche) =>
    n.id === nocheAbiertaId
      ? `En curso (desde ${formatearFechaHora(n.started_at)})`
      : `${formatearFechaHora(n.started_at)} a ${n.ended_at ? formatearHora(n.ended_at) : "…"}`

  return (
    <Card>
      <CardContent className="grid gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-4">
        <FiltroCampo id="f-noche" etiqueta="Noche">
          <Selector
            id="f-noche"
            value={filtros.nocheId}
            onChange={(v) => poner({ nocheId: v })}
            vacio="Todas las noches"
            opciones={noches.map((n) => ({ value: n.id, label: etiquetaNoche(n) }))}
          />
        </FiltroCampo>
        <FiltroCampo id="f-desde" etiqueta="Desde">
          <Input id="f-desde" type="date" className="h-11 sm:h-9" value={filtros.desde} onChange={(e) => poner({ desde: e.target.value })} />
        </FiltroCampo>
        <FiltroCampo id="f-hasta" etiqueta="Hasta">
          <Input id="f-hasta" type="date" className="h-11 sm:h-9" value={filtros.hasta} onChange={(e) => poner({ hasta: e.target.value })} />
        </FiltroCampo>
        <FiltroCampo id="f-metodo" etiqueta="Método de pago">
          <Selector
            id="f-metodo"
            value={filtros.metodo}
            onChange={(v) => poner({ metodo: v })}
            vacio="Todos"
            opciones={[...metodos.map((m) => ({ value: m.code, label: m.label })), { value: "mixto", label: "Mixto" }]}
          />
        </FiltroCampo>
        <FiltroCampo id="f-cajero" etiqueta="Cajero/a">
          <Selector
            id="f-cajero"
            value={filtros.cajeroId}
            onChange={(v) => poner({ cajeroId: v })}
            vacio="Todos"
            opciones={cajeros.map((c) => ({ value: c.id, label: c.full_name }))}
          />
        </FiltroCampo>
        <FiltroCampo id="f-caja" etiqueta="Caja">
          <Selector
            id="f-caja"
            value={filtros.cajaId}
            onChange={(v) => poner({ cajaId: v })}
            vacio="Todas"
            opciones={cajas.map((c) => ({ value: c.id, label: c.name }))}
          />
        </FiltroCampo>
        <FiltroCampo id="f-estado" etiqueta="Estado">
          <Selector
            id="f-estado"
            value={filtros.estado}
            onChange={(v) => poner({ estado: v as FiltrosVentas["estado"] })}
            vacio="Todos"
            opciones={[
              { value: "pending", label: ESTADO_VENTA.pending },
              { value: "delivered", label: ESTADO_VENTA.delivered },
            ]}
          />
        </FiltroCampo>
        <div className="flex items-end">
          <Button
            variant="outline"
            className="min-h-11 w-full sm:min-h-9"
            onClick={() => onCambiar({ ...FILTROS_VACIOS, nocheId: filtros.nocheId })}
          >
            Limpiar filtros
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function FiltroCampo({ id, etiqueta, children }: { id: string; etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {etiqueta}
      </label>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------
// Resumen de la noche. Efectivo = ventas en efectivo + cambio dado.
// Los totales los calcula la base (v_night_register_summary); aca solo se
// suman las filas de cada caja, en centavos.
// ---------------------------------------------------------------------
function ResumenNoche({
  resumen,
  enCurso,
  onAgregarCambio,
}: {
  resumen: ResumenCaja[]
  enCurso: boolean
  onAgregarCambio: (caja: ResumenCaja) => void
}) {
  const total = (campo: keyof ResumenCaja) => sumarMontos(resumen.map((r) => r[campo] as string))
  const tickets = resumen.reduce((t, r) => t + Number(r.tickets), 0)
  const tarjetas = [
    {
      titulo: "Efectivo en caja",
      valor: total("expected_cash"),
      detalle: `Ventas ${formatearMonto(total("cash_sales"))} + cambio ${formatearMonto(total("float_total"))}`,
    },
    { titulo: "PIX", valor: total("pix_sales"), detalle: null },
    { titulo: "Transferencia", valor: total("transfer_sales"), detalle: null },
    { titulo: "Total vendido", valor: total("sales_total"), detalle: `${tickets} ticket${tickets === 1 ? "" : "s"}` },
  ]

  return (
    <section className="flex flex-col gap-3" aria-label="Resumen de la noche">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tarjetas.map((t) => (
          <Card key={t.titulo}>
            <CardHeader className="pb-2">
              <CardDescription>{t.titulo}</CardDescription>
              <CardTitle className="text-2xl tabular-nums" aria-label={`${t.titulo}: ${formatearMonto(t.valor)}`}>
                {formatearMonto(t.valor)}
              </CardTitle>
            </CardHeader>
            {t.detalle && <CardContent className="pt-0 text-xs text-muted-foreground">{t.detalle}</CardContent>}
          </Card>
        ))}
      </div>

      {resumen.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-xs">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Caja</th>
                <th className="p-3 text-right font-medium">Cambio</th>
                <th className="p-3 text-right font-medium">Efectivo ventas</th>
                <th className="p-3 text-right font-medium">Efectivo en caja</th>
                <th className="p-3 text-right font-medium">PIX</th>
                <th className="p-3 text-right font-medium">Transferencia</th>
                <th className="p-3 text-right font-medium">Total</th>
                {enCurso && <th className="p-3 font-medium">
                  <span className="sr-only">Acciones</span>
                </th>}
              </tr>
            </thead>
            <tbody>
              {resumen.map((r) => (
                <tr key={r.cash_register_id} className="border-t border-border transition-colors hover:bg-muted/30">
                  <td className="p-3 font-medium">{r.cash_register_name}</td>
                  <td className="p-3 text-right tabular-nums">
                    {formatearMonto(r.float_total)}
                    {Number(r.added_float) !== 0 && (
                      <div className="text-xs text-muted-foreground">
                        inicial {formatearMonto(r.opening_float)} + {formatearMonto(r.added_float)}
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-right tabular-nums">{formatearMonto(r.cash_sales)}</td>
                  <td className="p-3 text-right font-semibold tabular-nums" aria-label={`Efectivo en ${r.cash_register_name}: ${formatearMonto(r.expected_cash)}`}>
                    {formatearMonto(r.expected_cash)}
                  </td>
                  <td className="p-3 text-right tabular-nums">{formatearMonto(r.pix_sales)}</td>
                  <td className="p-3 text-right tabular-nums">{formatearMonto(r.transfer_sales)}</td>
                  <td className="p-3 text-right tabular-nums">{formatearMonto(r.sales_total)}</td>
                  {enCurso && (
                    <td className="p-3">
                      <Button
                        variant="outline"
                        className="min-h-11 sm:min-h-8"
                        aria-label={`Agregar cambio a ${r.cash_register_name}`}
                        onClick={() => onAgregarCambio(r)}
                      >
                        Agregar cambio
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------
// Lista de ventas: una fila tocable por venta (en telefono, dos lineas).
// ---------------------------------------------------------------------
function ListaVentas({
  ventas,
  cargando,
  etiquetaMetodo,
  onElegir,
}: {
  ventas: Venta[]
  cargando: boolean
  etiquetaMetodo: (code: string) => string
  onElegir: (v: Venta) => void
}) {
  const totalLista = useMemo(() => sumarMontos(ventas.map((v) => v.total)), [ventas])
  if (cargando) return <p className="text-sm text-muted-foreground">Cargando ventas...</p>
  if (ventas.length === 0) {
    return <p className="text-sm text-muted-foreground">No hay ventas con estos filtros.</p>
  }
  return (
    <section className="flex flex-col gap-2" aria-labelledby="titulo-ventas">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="titulo-ventas" className="text-lg font-semibold">
          {ventas.length} venta{ventas.length === 1 ? "" : "s"}
        </h2>
        <span className="text-sm text-muted-foreground">
          Total de la lista: <span className="font-medium tabular-nums">{formatearMonto(totalLista)}</span>
          {ventas.length >= LIMITE_VENTAS && ` (se muestran las ${LIMITE_VENTAS} más recientes)`}
        </span>
      </div>
      <div className="hidden grid-cols-[5rem_6rem_1fr_7rem_1fr_7rem_6rem] gap-2 px-3 text-xs font-medium text-muted-foreground md:grid">
        <span>Hora</span>
        <span>Ticket</span>
        <span>Cajero/a</span>
        <span>Caja</span>
        <span>Método</span>
        <span className="text-right">Monto</span>
        <span>Estado</span>
      </div>
      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-xs" aria-label="Ventas">
        {ventas.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => onElegir(v)}
              aria-label={`Venta ${v.ticket_number}`}
              className="grid min-h-11 w-full grid-cols-[1fr_auto] gap-x-2 gap-y-1 px-3 py-2 text-left text-sm hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none md:grid-cols-[5rem_6rem_1fr_7rem_1fr_7rem_6rem] md:items-center"
            >
              <span className="text-muted-foreground tabular-nums md:order-none">{formatearHora(v.created_at_device)}</span>
              <span className="text-right font-semibold tabular-nums md:hidden">{formatearMonto(v.total)}</span>
              <span className="font-medium">{v.ticket_number}</span>
              <span className="hidden md:inline">{v.cashier_name}</span>
              <span className="text-right md:text-left">
                <span className="md:hidden">{v.cashier_name} · </span>
                {v.cash_register_name}
              </span>
              <span className="flex flex-wrap items-center gap-1">
                <MetodosVenta venta={v} etiquetaMetodo={etiquetaMetodo} />
              </span>
              <span className="hidden text-right font-semibold tabular-nums md:inline">{formatearMonto(v.total)}</span>
              <span className="flex flex-wrap items-center justify-end gap-1 md:justify-start">
                <Badge variant={v.status === "delivered" ? "default" : "outline"}>{ESTADO_VENTA[v.status]}</Badge>
                {v.outside_night && <Badge variant="destructive">Fuera de noche</Badge>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function MetodosVenta({ venta, etiquetaMetodo }: { venta: Venta; etiquetaMetodo: (c: string) => string }) {
  if (venta.is_mixed) {
    return (
      <>
        <Badge variant="secondary">Mixto</Badge>
        <span className="text-xs text-muted-foreground">{venta.payment_methods.map(etiquetaMetodo).join(" + ")}</span>
      </>
    )
  }
  if (venta.payment_methods.length === 0) return <span className="text-xs text-muted-foreground">Sin pago</span>
  return <Badge variant="secondary">{etiquetaMetodo(venta.payment_methods[0])}</Badge>
}

// ---------------------------------------------------------------------
// Detalle: productos, cantidades, sustituciones y cuanto se pago con cada
// metodo (pago mixto).
// ---------------------------------------------------------------------
function DetalleVentaSheet({
  client,
  venta,
  etiquetaMetodo,
  onCerrar,
}: {
  client: SupabaseClient
  venta: Venta | null
  etiquetaMetodo: (code: string) => string
  onCerrar: () => void
}) {
  const [detalle, setDetalle] = useState<DetalleVenta | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!venta) return
    let vigente = true
    setDetalle(null)
    setError(false)
    detalleDeVenta(client, venta.id)
      .then((d) => vigente && setDetalle(d))
      .catch(() => vigente && setError(true))
    return () => {
      vigente = false
    }
  }, [client, venta])

  return (
    <Sheet open={venta !== null} onOpenChange={(v) => !v && onCerrar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {venta && (
          <>
            <SheetHeader>
              <SheetTitle>Ticket {venta.ticket_number}</SheetTitle>
              <SheetDescription>
                {formatearFechaHora(venta.created_at_device)} · {venta.cash_register_name} · {venta.cashier_name}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-5 px-4 pb-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={venta.status === "delivered" ? "default" : "outline"}>{ESTADO_VENTA[venta.status]}</Badge>
                {venta.status === "delivered" && venta.delivered_at && (
                  <span className="text-sm text-muted-foreground">
                    {formatearHora(venta.delivered_at)}
                    {venta.delivered_by_name ? ` por ${venta.delivered_by_name}` : ""}
                  </span>
                )}
                {venta.outside_night && <Badge variant="destructive">Fuera de noche</Badge>}
              </div>

              {error && <p className="text-sm text-destructive">No se pudo cargar el detalle.</p>}
              {!detalle && !error && <p className="text-sm text-muted-foreground">Cargando detalle...</p>}

              {detalle && (
                <>
                  <section aria-label="Productos">
                    <h3 className="mb-2 text-sm font-semibold">Productos</h3>
                    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card text-sm shadow-xs">
                      {detalle.items.map((it) => {
                        const sust = detalle.sustituciones.filter((s) => s.sale_item_id === it.id)
                        return (
                          <li key={it.id} className="flex flex-col gap-1 p-3">
                            <div className="flex justify-between gap-2">
                              <span>
                                <span className="font-medium tabular-nums">{it.quantity} ×</span> {it.product_name}
                              </span>
                              <span className="tabular-nums">{formatearMonto(it.line_total)}</span>
                            </div>
                            <span className="text-xs text-muted-foreground">{formatearMonto(it.unit_price)} c/u</span>
                            {sust.map((s, i) => (
                              <span key={i} className="text-xs text-muted-foreground">
                                Se entregó {s.quantity} × {s.substitute_product_name} en su lugar
                              </span>
                            ))}
                          </li>
                        )
                      })}
                    </ul>
                  </section>

                  <section aria-label="Pagos">
                    <h3 className="mb-2 text-sm font-semibold">
                      Pago{venta.is_mixed ? " mixto" : ""}
                    </h3>
                    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card text-sm shadow-xs">
                      {detalle.pagos.map((p, i) => (
                        <li key={i} className="flex justify-between gap-2 p-3">
                          <span>{etiquetaMetodo(p.method)}</span>
                          <span className="tabular-nums" aria-label={`${etiquetaMetodo(p.method)}: ${formatearMonto(p.amount)}`}>
                            {formatearMonto(p.amount)}
                          </span>
                        </li>
                      ))}
                      <li className="flex justify-between gap-2 p-3 font-semibold">
                        <span>Total</span>
                        <span className="tabular-nums">{formatearMonto(venta.total)}</span>
                      </li>
                    </ul>
                  </section>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ---------------------------------------------------------------------
// Refuerzo de cambio durante la noche
// ---------------------------------------------------------------------
function AgregarCambioDialog({
  client,
  clubId,
  nocheId,
  caja,
  onCerrar,
  onGuardado,
}: {
  client: SupabaseClient
  clubId: string
  nocheId: string
  caja: ResumenCaja | null
  onCerrar: () => void
  onGuardado: () => Promise<void>
}) {
  const [monto, setMonto] = useState("")
  const [nota, setNota] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  function cerrar() {
    setMonto("")
    setNota("")
    setError(null)
    onCerrar()
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!caja) return
    const r = validarCambio(monto, true)
    if (!r.ok) {
      setError(r.errores)
      return
    }
    setGuardando(true)
    setError(null)
    try {
      await agregarCambio(client, clubId, nocheId, caja.cash_register_id, r.valor, nota.trim() || null)
      setMonto("")
      setNota("")
      await onGuardado()
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : ""
      setError(mensaje.includes("no esta abierta") ? "La noche ya se paró." : "No se pudo guardar el cambio.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={caja !== null} onOpenChange={(v) => !v && cerrar()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Agregar cambio{caja ? ` a ${caja.cash_register_name}` : ""}</DialogTitle>
          <DialogDescription>Efectivo que se le entrega a la caja durante la noche. Suma al efectivo en caja.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
          <label htmlFor="cambio-monto" className="text-sm font-medium">
            Monto ($)
          </label>
          <Input id="cambio-monto" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} />
          <label htmlFor="cambio-nota" className="text-sm font-medium">
            Nota (opcional)
          </label>
          <Input id="cambio-nota" value={nota} onChange={(e) => setNota(e.target.value)} />
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={cerrar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando}>
              Guardar cambio
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
