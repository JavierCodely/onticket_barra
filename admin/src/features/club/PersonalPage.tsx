import { useCallback, useEffect, useState, type FormEvent } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Pencil } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Campo } from "@/features/clubs/ClubsPage"
import { Selector } from "@/features/club/Selector"
import {
  asignarPersonal,
  crearPersonal,
  editarPersonal,
  ErrorDeAlta,
  listarAsignaciones,
  listarBloqueados,
  listarCajas,
  listarPersonal,
  listarUbicaciones,
  quitarAsignacion,
  type Asignacion,
  type Caja,
  type CambiosPersonal,
  type Persona,
  type Ubicacion,
} from "@/lib/datos"
import { validarPersonal, type ErroresPersonal, type RolPersonal } from "@/lib/validaciones"

type Props = {
  client: SupabaseClient
  clubId: string
}

const ROLES: Record<string, string> = {
  club_admin: "Encargado (panel web)",
  cashier: "Cajero",
  bartender: "Barra",
}

type Estado = "activo" | "bloqueado" | "inactivo"

function estadoDe(p: Persona, bloqueados: Set<string>): Estado {
  if (!p.active) return "inactivo"
  return bloqueados.has(p.id) ? "bloqueado" : "activo"
}

const ETIQUETA_ESTADO: Record<Estado, { texto: string; variante: "default" | "secondary" | "destructive" }> = {
  activo: { texto: "Activo", variante: "default" },
  bloqueado: { texto: "Bloqueado por intentos", variante: "destructive" },
  inactivo: { texto: "Inactivo", variante: "secondary" },
}

// Solo el personal del club seleccionado: la consulta filtra por club_id
// y, ademas, RLS solo devuelve filas de los clubs que gestiona quien entra.
export function PersonalPage({ client, clubId }: Props) {
  const [personal, setPersonal] = useState<Persona[]>([])
  const [bloqueados, setBloqueados] = useState<Set<string>>(new Set())
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [cajas, setCajas] = useState<Caja[]>([])
  const [barras, setBarras] = useState<Ubicacion[]>([])
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([])
  const [editando, setEditando] = useState<Persona | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const [filas, ids, c, u, a] = await Promise.all([
        listarPersonal(client, clubId),
        listarBloqueados(client, clubId),
        listarCajas(client, clubId),
        listarUbicaciones(client, clubId),
        listarAsignaciones(client, clubId),
      ])
      setPersonal(filas)
      setBloqueados(ids)
      setCajas(c)
      setBarras(u.filter((x) => x.kind === "bar"))
      setAsignaciones(a)
    } catch {
      setError("No se pudo cargar el personal.")
    } finally {
      setCargando(false)
    }
  }, [client, clubId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const asignacionDe = (userId: string) => asignaciones.find((a) => a.user_id === userId) ?? null
  function destinoDe(a: Asignacion | null): string | null {
    if (!a) return null
    if (a.cash_register_id) return cajas.find((c) => c.id === a.cash_register_id)?.name ?? "Caja"
    return barras.find((b) => b.id === a.location_id)?.name ?? "Barra"
  }

  return (
    <div className="flex w-full max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Personal</h1>
          <p className="text-sm text-muted-foreground">Cajeros, barra y encargados de este club.</p>
        </div>
        {!mostrarForm && <Button onClick={() => setMostrarForm(true)}>Nuevo personal</Button>}
      </div>

      {mostrarForm && (
        <NuevoPersonalForm
          client={client}
          clubId={clubId}
          onCancelar={() => setMostrarForm(false)}
          onCreado={(p) => {
            setMostrarForm(false)
            setPersonal((prev) => [...prev, p].sort((a, b) => a.full_name.localeCompare(b.full_name)))
          }}
        />
      )}

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {cargando ? (
        <p className="text-sm text-muted-foreground">Cargando personal...</p>
      ) : personal.length === 0 && !error ? (
        <p className="text-sm text-muted-foreground">Este club todavía no tiene personal.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-xs">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Nombre</th>
                <th className="p-3 font-medium">Rol</th>
                <th className="p-3 font-medium">Usuario</th>
                <th className="p-3 font-medium">Asignado a</th>
                <th className="p-3 font-medium">Estado</th>
                <th className="p-3 text-right font-medium">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {personal.map((p) => {
                const estado = ETIQUETA_ESTADO[estadoDe(p, bloqueados)]
                return (
                  <tr key={p.id} className="border-t border-border transition-colors hover:bg-muted/30">
                    <td className="p-3 font-medium">{p.full_name}</td>
                    <td className="p-3">{ROLES[p.role] ?? p.role}</td>
                    <td className="p-3 text-muted-foreground">{p.username ?? p.email ?? "—"}</td>
                    <td
                      className="p-3"
                      aria-label={`${p.full_name} asignado a: ${destinoDe(asignacionDe(p.id)) ?? "nada"}`}
                    >
                      {p.role === "club_admin" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : destinoDe(asignacionDe(p.id)) ? (
                        <Badge variant="outline">{destinoDe(asignacionDe(p.id))}</Badge>
                      ) : (
                        <span className="text-muted-foreground">Sin asignar</span>
                      )}
                    </td>
                    <td className="p-3">
                      <Badge variant={estado.variante}>{estado.texto}</Badge>
                    </td>
                    <td className="p-2 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 md:size-8"
                        aria-label={`Editar ${p.full_name}`}
                        title="Editar"
                        onClick={() => setEditando(p)}
                      >
                        <Pencil aria-hidden />
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={editando !== null} onOpenChange={(v) => !v && setEditando(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar personal</DialogTitle>
            <DialogDescription>
              {editando?.role === "club_admin"
                ? "Entra al panel web con su email."
                : `Entra al posnet como "${editando?.username ?? ""}". El usuario no cambia; el PIN se cambia aparte.`}
            </DialogDescription>
          </DialogHeader>
          {editando && (
            <EditarPersonalForm
              key={editando.id}
              client={client}
              clubId={clubId}
              persona={editando}
              asignacion={asignacionDe(editando.id)}
              cajas={cajas}
              barras={barras}
              onCancelar={() => setEditando(null)}
              onGuardado={(persona, asignacion, cerrar) => {
                setPersonal((prev) =>
                  prev
                    .map((x) => (x.id === persona.id ? persona : x))
                    .sort((a, b) => a.full_name.localeCompare(b.full_name)),
                )
                setAsignaciones((prev) => [
                  ...prev.filter((a) => a.user_id !== persona.id),
                  ...(asignacion ? [asignacion] : []),
                ])
                // Guardado a medias: el dialogo sigue abierto con el error y
                // con la persona ya actualizada, para reintentar la asignacion.
                setEditando(cerrar ? null : persona)
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

type FormProps = {
  client: SupabaseClient
  clubId: string
  onCancelar: () => void
  onCreado: (persona: Persona) => void
}

function NuevoPersonalForm({ client, clubId, onCancelar, onCreado }: FormProps) {
  const [fullName, setFullName] = useState("")
  const [role, setRole] = useState<RolPersonal>("cashier")
  const [username, setUsername] = useState("")
  const [pin, setPin] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [errores, setErrores] = useState<ErroresPersonal>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const esPosnet = role !== "club_admin"

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrorGeneral(null)
    const resultado = validarPersonal({ fullName, role, username, pin, email, password })
    if (!resultado.ok) {
      setErrores(resultado.errores)
      return
    }
    setErrores({})
    setGuardando(true)
    try {
      onCreado(await crearPersonal(client, clubId, resultado.valor))
    } catch (err) {
      if (err instanceof ErrorDeAlta) {
        setErrorGeneral(err.message)
        setErrores({
          username: err.errores.username,
          pin: err.errores.pin,
          email: err.errores.email,
          password: err.errores.password,
          fullName: err.errores.full_name,
        })
      } else {
        setErrorGeneral("No se pudo crear el usuario. Intentá de nuevo.")
      }
    } finally {
      // El PIN y la contrasena no quedan en pantalla despues de enviarlos.
      setPin("")
      setPassword("")
      setGuardando(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nuevo personal</CardTitle>
        <CardDescription>
          {esPosnet
            ? "Entra al posnet con su usuario y PIN. El PIN se guarda cifrado: no se puede volver a ver."
            : "Entra al panel web con su email y contraseña, y gestiona solo este club."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="pers-nombre" etiqueta="Nombre" error={errores.fullName}>
              <Input id="pers-nombre" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </Campo>
            <Campo id="pers-rol" etiqueta="Rol">
              <Selector
                id="pers-rol"
                value={role}
                onChange={(v) => setRole(v as RolPersonal)}
                opciones={[
                  { value: "cashier", label: "Cajero" },
                  { value: "bartender", label: "Barra" },
                  { value: "club_admin", label: "Encargado (panel web)" },
                ]}
              />
            </Campo>
            {esPosnet ? (
              <>
                <Campo id="pers-usuario" etiqueta="Usuario" error={errores.username}>
                  <Input
                    id="pers-usuario"
                    autoComplete="off"
                    autoCapitalize="none"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </Campo>
                <Campo id="pers-pin" etiqueta="PIN (6 a 8 dígitos)" error={errores.pin}>
                  <Input
                    id="pers-pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    maxLength={8}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  />
                </Campo>
              </>
            ) : (
              <>
                <Campo id="pers-email" etiqueta="Email" error={errores.email}>
                  <Input
                    id="pers-email"
                    type="email"
                    autoComplete="off"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Campo>
                <Campo id="pers-password" etiqueta="Contraseña inicial" error={errores.password}>
                  <Input
                    id="pers-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Campo>
              </>
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
              {guardando ? "Creando..." : "Crear"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------
// Editar: nombre, rol (cajero <-> barra), activo y caja o barra asignada.
// Los datos de la persona van por Edge Function (admin-update-user); la
// asignacion, directo a staff_assignments (RLS). Si cambia el rol, la base
// quita sola la asignacion vieja.
// ---------------------------------------------------------------------
type EditarProps = {
  client: SupabaseClient
  clubId: string
  persona: Persona
  asignacion: Asignacion | null
  cajas: Caja[]
  barras: Ubicacion[]
  onCancelar: () => void
  onGuardado: (persona: Persona, asignacion: Asignacion | null, cerrar: boolean) => void
}

function EditarPersonalForm({
  client,
  clubId,
  persona,
  asignacion,
  cajas,
  barras,
  onCancelar,
  onGuardado,
}: EditarProps) {
  const esEncargado = persona.role === "club_admin"
  const [fullName, setFullName] = useState(persona.full_name)
  const [role, setRole] = useState(persona.role)
  const [activo, setActivo] = useState(persona.active)
  const [destino, setDestino] = useState(asignacion?.cash_register_id ?? asignacion?.location_id ?? "")
  const [error, setError] = useState<string | null>(null)
  const [errorNombre, setErrorNombre] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  // Opciones segun el rol elegido: cajas activas o barras activas. Si la
  // actual quedo inactiva, se muestra igual para poder verla o quitarla.
  const lista = role === "cashier" ? cajas : role === "bartender" ? barras : []
  const opciones = lista
    .filter((x) => x.active || x.id === destino)
    .map((x) => ({ value: x.id, label: x.active ? x.name : `${x.name} (inactiva)` }))

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const nombre = fullName.trim()
    if (!nombre) {
      setErrorNombre("Ingresá el nombre.")
      return
    }
    setErrorNombre(null)
    setError(null)
    setGuardando(true)

    const cambios: CambiosPersonal = {}
    if (nombre !== persona.full_name) cambios.full_name = nombre
    if (!esEncargado && role !== persona.role) cambios.role = role as "cashier" | "bartender"
    if (activo !== persona.active) cambios.active = activo

    let actual = persona
    try {
      if (Object.keys(cambios).length > 0) actual = await editarPersonal(client, clubId, persona.id, cambios)
    } catch (err) {
      setError(err instanceof ErrorDeAlta ? err.message : "No se pudo guardar el cambio.")
      setGuardando(false)
      return
    }

    // Con el rol cambiado, la base ya borro la asignacion vieja.
    let vigente = cambios.role ? null : asignacion
    const destinoActual = vigente?.cash_register_id ?? vigente?.location_id ?? ""
    try {
      if (!esEncargado && destino !== destinoActual) {
        if (destino === "") {
          if (vigente) await quitarAsignacion(client, vigente.id)
          vigente = null
        } else {
          vigente = await asignarPersonal(client, clubId, actual, destino, vigente)
        }
      }
    } catch {
      setError(
        `Se guardaron los datos de ${actual.full_name}, pero no se pudo cambiar la asignación. Intentá de nuevo.`,
      )
      setGuardando(false)
      onGuardado(actual, vigente, false)
      return
    }
    setGuardando(false)
    onGuardado(actual, vigente, true)
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Campo id="edit-nombre" etiqueta="Nombre" error={errorNombre ?? undefined}>
        <Input id="edit-nombre" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </Campo>

      {esEncargado ? (
        <p className="text-sm text-muted-foreground">
          Rol: <span className="font-medium text-foreground">Encargado (panel web)</span>. El rol de un encargado no se
          cambia.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo id="edit-rol" etiqueta="Rol">
            <Selector
              id="edit-rol"
              value={role}
              onChange={(v) => {
                setRole(v)
                setDestino("")
              }}
              opciones={[
                { value: "cashier", label: "Cajero" },
                { value: "bartender", label: "Barra" },
              ]}
            />
          </Campo>
          <Campo id="edit-asignacion" etiqueta={role === "cashier" ? "Caja asignada" : "Barra asignada"}>
            <Selector
              id="edit-asignacion"
              value={destino}
              onChange={setDestino}
              vacio="Sin asignar"
              opciones={opciones}
            />
          </Campo>
          {opciones.length === 0 && (
            <p className="text-sm text-muted-foreground sm:col-span-2">
              No hay {role === "cashier" ? "cajas" : "barras"} activas. Creálas en Cajas/Barras.
            </p>
          )}
        </div>
      )}

      <label className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border p-3">
        <span className="flex flex-col">
          <span className="text-sm font-medium">Activo</span>
          <span className="text-xs text-muted-foreground">
            {esEncargado ? "Inactivo no entra al panel." : "Inactivo no entra al posnet."}
          </span>
        </span>
        <Switch checked={activo} onCheckedChange={setActivo} aria-label="Activo" />
      </label>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="submit" disabled={guardando}>
          {guardando ? "Guardando..." : "Guardar cambios"}
        </Button>
      </div>
    </form>
  )
}
