import { useCallback, useEffect, useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Selector } from "@/features/club/Selector"
import {
  listarCategorias,
  listarProductos,
  listarSaldos,
  listarUbicaciones,
  registrarMovimientos,
  type Categoria,
  type Producto,
  type Saldo,
  type Ubicacion,
} from "@/lib/datos"
import { calcularAjusteConteo, validarCargaBarra, validarDevolucion, validarMovimiento } from "@/lib/validaciones"

type Props = {
  client: SupabaseClient
  clubId: string
}

// Elegir una barra muestra TODOS los productos: cuanto hay en el deposito,
// cuanto hay en la barra y cuanto cargar. Cargar = transferencia
// deposito -> barra (dos lineas del libro en una sola insercion). Nunca
// se carga mas de lo que hay en el deposito.
export function StockBarraPage({ client, clubId }: Props) {
  const [productos, setProductos] = useState<Producto[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([])
  const [saldos, setSaldos] = useState<Saldo[]>([])
  const [barraId, setBarraId] = useState("")
  const [depositoId, setDepositoId] = useState("")
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modificando, setModificando] = useState<Producto | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const [p, c, u, s] = await Promise.all([
        listarProductos(client, clubId),
        listarCategorias(client, clubId),
        listarUbicaciones(client, clubId),
        listarSaldos(client, clubId),
      ])
      setProductos(p.filter((x) => x.active))
      setCategorias(c)
      setUbicaciones(u.filter((x) => x.active))
      setSaldos(s)
      setDepositoId((actual) => actual || u.find((x) => x.kind === "storage" && x.active)?.id || "")
    } catch {
      setError("No se pudo cargar el stock.")
    } finally {
      setCargando(false)
    }
  }, [client, clubId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const barras = ubicaciones.filter((u) => u.kind === "bar")
  const depositos = ubicaciones.filter((u) => u.kind === "storage")
  const barra = barras.find((b) => b.id === barraId) ?? null
  const cantidad = (productoId: string, ubicacionId: string) =>
    saldos.find((s) => s.product_id === productoId && s.location_id === ubicacionId)?.quantity ?? 0

  async function recargarSaldos() {
    setSaldos(await listarSaldos(client, clubId))
  }

  if (cargando) return <p className="text-sm text-muted-foreground">Cargando stock...</p>

  return (
    <div className="flex w-full max-w-5xl flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Stock en barra</h1>
        <p className="text-sm text-muted-foreground">
          Cargá cada barra desde el depósito, corregí su conteo o devolvé al depósito.
        </p>
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {barras.length === 0 ? (
        <Alert>
          <AlertDescription>Todavía no hay barras. Creálas en Cajas/Barras.</AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium" id="titulo-barras">
            Elegí una barra
          </span>
          <div
            className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
            role="group"
            aria-labelledby="titulo-barras"
          >
            {barras.map((b) => (
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
      )}

      {barra && depositos.length === 0 && (
        <Alert>
          <AlertDescription>
            Para cargar la barra o devolverle mercadería hace falta un depósito: crealo en Productos. Mientras tanto
            podés corregir el conteo de la barra con Modificar.
          </AlertDescription>
        </Alert>
      )}

      {barra && (
        <section className="flex flex-col gap-3" aria-labelledby="titulo-barra">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <h2 id="titulo-barra" className="text-lg font-semibold">
              {barra.name}
            </h2>
            {depositos.length > 1 && (
              <label className="flex flex-col gap-1 text-sm sm:w-64">
                <span className="font-medium">Cargar desde</span>
                <Selector
                  id="barra-deposito"
                  value={depositoId}
                  onChange={setDepositoId}
                  opciones={depositos.map((d) => ({ value: d.id, label: d.name }))}
                />
              </label>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Cargá en la barra solo lo que entra. No se puede cargar más de lo que hay en el depósito; un saldo negativo
            en la barra es una sobreventa.
          </p>
          {productos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Este club todavía no tiene productos.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-xs">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-3 font-medium">Producto</th>
                    <th className="p-3 text-right font-medium">En depósito</th>
                    <th className="p-3 text-right font-medium">En barra</th>
                    <th className="p-3 font-medium">Cargar</th>
                    <th className="p-3 text-right font-medium">Modificar</th>
                  </tr>
                </thead>
                <tbody>
                  {productos.map((p) => (
                    <FilaCarga
                      key={`${barra.id}-${p.id}`}
                      client={client}
                      clubId={clubId}
                      producto={p}
                      categoria={categorias.find((c) => c.id === p.category_id)?.name ?? null}
                      depositoId={depositoId}
                      barraId={barra.id}
                      enDeposito={cantidad(p.id, depositoId)}
                      enBarra={cantidad(p.id, barra.id)}
                      onCargado={recargarSaldos}
                      onModificar={() => setModificando(p)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <Dialog open={modificando !== null} onOpenChange={(v) => !v && setModificando(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Modificar stock{modificando ? `: ${modificando.name}` : ""}</DialogTitle>
            <DialogDescription>
              {barra?.name}: hay {modificando && barra ? cantidad(modificando.id, barra.id) : 0}. Cada cambio queda
              registrado con quién lo hizo; el saldo no se escribe a mano.
            </DialogDescription>
          </DialogHeader>
          {modificando && barra && (
            <ModificarStockBarra
              key={`${barra.id}-${modificando.id}`}
              client={client}
              clubId={clubId}
              producto={modificando}
              barraId={barra.id}
              depositoId={depositoId}
              hayDeposito={depositos.length > 0}
              enBarra={cantidad(modificando.id, barra.id)}
              onCancelar={() => setModificando(null)}
              onHecho={async () => {
                setModificando(null)
                await recargarSaldos()
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

type FilaProps = {
  client: SupabaseClient
  clubId: string
  producto: Producto
  categoria: string | null
  depositoId: string
  barraId: string
  enDeposito: number
  enBarra: number
  onCargado: () => Promise<void>
  onModificar: () => void
}

function FilaCarga({
  client,
  clubId,
  producto,
  categoria,
  depositoId,
  barraId,
  enDeposito,
  enBarra,
  onCargado,
  onModificar,
}: FilaProps) {
  const [valor, setValor] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const idCampo = `carga-${producto.id}`

  async function cargar() {
    const carga = validarCargaBarra(valor, enDeposito)
    if (!carga.ok) {
      setError(carga.errores)
      return
    }
    const movimiento = validarMovimiento({
      tipo: "transfer",
      productoId: producto.id,
      ubicacionId: depositoId,
      destinoId: barraId,
      cantidad: String(carga.valor),
      nota: "Carga de barra",
    })
    if (!movimiento.ok) {
      setError("No se pudo preparar la carga.")
      return
    }
    setError(null)
    setGuardando(true)
    try {
      await registrarMovimientos(client, clubId, movimiento.valor)
      setValor("")
      await onCargado()
    } catch {
      setError("No se pudo cargar. Intentá de nuevo.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <tr className="border-t border-border align-top">
      <td className="p-3">
        <div className="font-medium">{producto.name}</div>
        {categoria && <div className="text-xs text-muted-foreground">{categoria}</div>}
      </td>
      <td className="p-3 text-right tabular-nums" aria-label={`${producto.name} en depósito: ${enDeposito}`}>
        {enDeposito}
      </td>
      <td
        className={`p-3 text-right tabular-nums ${enBarra < 0 ? "font-semibold text-destructive" : ""}`}
        aria-label={`${producto.name} en barra: ${enBarra}`}
      >
        {enBarra}
      </td>
      <td className="p-3">
        <form
          className="flex items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void cargar()
          }}
          noValidate
        >
          <div className="flex flex-col gap-1">
            <label htmlFor={idCampo} className="sr-only">
              Cantidad de {producto.name}
            </label>
            <Input
              id={idCampo}
              inputMode="numeric"
              className="h-11 w-24 sm:h-9"
              value={valor}
              onChange={(e) => setValor(e.target.value.replace(/\D/g, ""))}
              aria-invalid={error ? true : undefined}
            />
            {error && (
              <p className="max-w-48 text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>
          <Button
            type="submit"
            variant="outline"
            className="min-h-11 sm:min-h-9"
            disabled={guardando || enDeposito <= 0}
          >
            Cargar
          </Button>
        </form>
      </td>
      <td className="p-3 text-right">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 md:size-9"
          aria-label={`Modificar stock de ${producto.name} en la barra`}
          title="Corregir conteo o devolver al depósito"
          onClick={onModificar}
        >
          <Pencil aria-hidden />
        </Button>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------
// Modificar el stock de una barra. Dos formas, las dos son lineas del libro:
//   - Corregir conteo: se escribe lo que hay de verdad y se registra un
//     ajuste por la diferencia (puede ser negativo).
//   - Devolver al deposito: transferencia barra -> deposito.
// ---------------------------------------------------------------------
type Modo = "conteo" | "devolver"

function ModificarStockBarra({
  client,
  clubId,
  producto,
  barraId,
  depositoId,
  hayDeposito,
  enBarra,
  onCancelar,
  onHecho,
}: {
  client: SupabaseClient
  clubId: string
  producto: Producto
  barraId: string
  depositoId: string
  hayDeposito: boolean
  enBarra: number
  onCancelar: () => void
  onHecho: () => Promise<void>
}) {
  const [modo, setModo] = useState<Modo>("conteo")
  const [valor, setValor] = useState("")
  const [nota, setNota] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const ajuste = modo === "conteo" && valor !== "" ? calcularAjusteConteo(valor, enBarra) : null

  async function guardar() {
    let movimiento
    if (modo === "conteo") {
      const r = calcularAjusteConteo(valor, enBarra)
      if (!r.ok) return setError(r.errores)
      movimiento = validarMovimiento({
        tipo: "adjustment",
        productoId: producto.id,
        ubicacionId: barraId,
        destinoId: "",
        cantidad: String(r.valor),
        nota: nota.trim() || "Corrección de conteo en barra",
      })
    } else {
      const r = validarDevolucion(valor, enBarra)
      if (!r.ok) return setError(r.errores)
      movimiento = validarMovimiento({
        tipo: "transfer",
        productoId: producto.id,
        ubicacionId: barraId,
        destinoId: depositoId,
        cantidad: String(r.valor),
        nota: nota.trim() || "Devolución de barra",
      })
    }
    if (!movimiento.ok) return setError("No se pudo preparar el movimiento.")
    setError(null)
    setGuardando(true)
    try {
      await registrarMovimientos(client, clubId, movimiento.valor)
      await onHecho()
    } catch {
      setError("No se pudo guardar. Intentá de nuevo.")
    } finally {
      setGuardando(false)
    }
  }

  const opciones: { value: Modo; label: string; ayuda: string; deshabilitado?: boolean }[] = [
    {
      value: "conteo",
      label: "Corregir conteo",
      ayuda: "Contaste la barra y hay otra cantidad (rotura, pérdida, error).",
    },
    {
      value: "devolver",
      label: "Devolver al depósito",
      ayuda: hayDeposito ? "Sobró mercadería y vuelve al depósito." : "Hace falta un depósito.",
      deshabilitado: !hayDeposito,
    },
  ]

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void guardar()
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">¿Qué querés hacer?</legend>
        {opciones.map((o) => (
          <label
            key={o.value}
            className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${modo === o.value ? "border-primary bg-accent" : "border-border hover:bg-muted/40"} ${o.deshabilitado ? "pointer-events-none opacity-50" : ""}`}
          >
            <input
              type="radio"
              name="modo-barra"
              value={o.value}
              checked={modo === o.value}
              disabled={o.deshabilitado}
              onChange={() => {
                setModo(o.value)
                setValor("")
                setError(null)
              }}
              className="mt-1 size-4 accent-primary"
            />
            <span className="flex flex-col">
              <span className="text-sm font-medium">{o.label}</span>
              <span className="text-xs text-muted-foreground">{o.ayuda}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="barra-modificar-cantidad" className="text-sm font-medium">
          {modo === "conteo" ? "Cantidad real en la barra" : "Cantidad a devolver"}
        </label>
        <Input
          id="barra-modificar-cantidad"
          inputMode="numeric"
          className="h-11 sm:h-9"
          value={valor}
          onChange={(e) => {
            setValor(e.target.value.replace(/\D/g, ""))
            setError(null)
          }}
          aria-invalid={error ? true : undefined}
        />
        {ajuste?.ok && (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Figura {enBarra}: se registra un ajuste de {ajuste.valor > 0 ? `+${ajuste.valor}` : ajuste.valor}.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="barra-modificar-nota" className="text-sm font-medium">
          Motivo (opcional)
        </label>
        <Input
          id="barra-modificar-nota"
          className="h-11 sm:h-9"
          placeholder={modo === "conteo" ? "Ej: botella rota" : "Ej: cierre de la noche"}
          value={nota}
          onChange={(e) => setNota(e.target.value)}
        />
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="submit" className="min-h-11 sm:min-h-9" disabled={guardando}>
          {guardando ? "Guardando..." : modo === "conteo" ? "Guardar conteo" : "Devolver"}
        </Button>
      </div>
    </form>
  )
}
