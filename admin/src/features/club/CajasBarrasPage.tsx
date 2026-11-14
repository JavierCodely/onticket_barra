import { useCallback, useEffect, useState, type FormEvent } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Campo } from "@/features/clubs/ClubsPage"
import {
  crearBarra,
  crearCaja,
  listarCajas,
  listarUbicaciones,
  type Caja,
  type Ubicacion,
} from "@/lib/datos"

type Props = {
  client: SupabaseClient
  clubId: string
}

export function CajasBarrasPage({ client, clubId }: Props) {
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([])
  const [cajas, setCajas] = useState<Caja[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const [u, c] = await Promise.all([listarUbicaciones(client, clubId), listarCajas(client, clubId)])
      setUbicaciones(u)
      setCajas(c)
    } catch {
      setError("No se pudieron cargar las cajas y barras.")
    } finally {
      setCargando(false)
    }
  }, [client, clubId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const barras = ubicaciones.filter((u) => u.kind === "bar")
  const nombreUbicacion = (id: string) => ubicaciones.find((u) => u.id === id)?.name ?? "—"

  return (
    <div className="flex w-full max-w-4xl flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Cajas y barras</h1>
        <p className="text-sm text-muted-foreground">Cada caja vende desde una ubicación de stock. Cada barra tiene su propio stock.</p>
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {cargando ? (
        <p className="text-sm text-muted-foreground">Cargando...</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Barras</CardTitle>
              <CardDescription>Cada barra tiene su propio stock (una heladera por barra).</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {barras.length === 0 ? (
                <p className="text-sm text-muted-foreground">Todavía no hay barras.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                  {barras.map((b) => (
                    <li key={b.id} className="p-3 text-sm">
                      {b.name}
                    </li>
                  ))}
                </ul>
              )}
              <NuevaBarraForm
                onCrear={async (nombre) => {
                  const barra = await crearBarra(client, clubId, nombre)
                  setUbicaciones((prev) => [...prev, barra])
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cajas</CardTitle>
              <CardDescription>Cada caja vende desde el stock de una barra.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {cajas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Todavía no hay cajas.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                  {cajas.map((c) => (
                    <li key={c.id} className="flex flex-wrap justify-between gap-2 p-3 text-sm">
                      <span>{c.name}</span>
                      <span className="text-muted-foreground">
                        Vende desde: {nombreUbicacion(c.inventory_location_id)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {barras.length === 0 ? (
                <p className="text-sm text-muted-foreground">Creá una barra antes de crear una caja.</p>
              ) : (
                <NuevaCajaForm
                  barras={barras}
                  onCrear={async (nombre, ubicacionId) => {
                    const caja = await crearCaja(client, clubId, nombre, ubicacionId)
                    setCajas((prev) => [...prev, caja])
                  }}
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

function mensajeDeError(err: unknown, entidad: string): string {
  const mensaje = err instanceof Error ? err.message : ""
  return mensaje.includes("_club_name")
    ? `Ya hay una ${entidad} con ese nombre en este club.`
    : `No se pudo crear la ${entidad}. Intentá de nuevo.`
}

function NuevaBarraForm({ onCrear }: { onCrear: (nombre: string) => Promise<void> }) {
  const [nombre, setNombre] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!nombre.trim()) {
      setError("Ingresá el nombre de la barra.")
      return
    }
    setError(null)
    setGuardando(true)
    try {
      await onCrear(nombre.trim())
      setNombre("")
    } catch (err) {
      setError(mensajeDeError(err, "barra"))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <Campo id="barra-nombre" etiqueta="Nueva barra" error={error ?? undefined}>
        <Input
          id="barra-nombre"
          placeholder="Ej: Barra principal"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />
      </Campo>
      <Button type="submit" disabled={guardando} className="sm:self-end">
        {guardando ? "Guardando..." : "Agregar barra"}
      </Button>
    </form>
  )
}

type NuevaCajaProps = {
  barras: Ubicacion[]
  onCrear: (nombre: string, ubicacionId: string) => Promise<void>
}

function NuevaCajaForm({ barras, onCrear }: NuevaCajaProps) {
  const [nombre, setNombre] = useState("")
  const [ubicacionId, setUbicacionId] = useState(barras[0]?.id ?? "")
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!nombre.trim()) {
      setError("Ingresá el nombre de la caja.")
      return
    }
    if (!ubicacionId) {
      setError("Elegí la barra desde la que vende.")
      return
    }
    setError(null)
    setGuardando(true)
    try {
      await onCrear(nombre.trim(), ubicacionId)
      setNombre("")
    } catch (err) {
      setError(mensajeDeError(err, "caja"))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <Campo id="caja-nombre" etiqueta="Nueva caja" error={error ?? undefined}>
        <Input
          id="caja-nombre"
          placeholder="Ej: Caja 1"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />
      </Campo>
      <Campo id="caja-barra" etiqueta="Vende desde">
        <select
          id="caja-barra"
          value={ubicacionId}
          onChange={(e) => setUbicacionId(e.target.value)}
          className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9"
        >
          {barras.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </Campo>
      <Button type="submit" disabled={guardando} className="sm:self-end">
        {guardando ? "Guardando..." : "Agregar caja"}
      </Button>
    </form>
  )
}
