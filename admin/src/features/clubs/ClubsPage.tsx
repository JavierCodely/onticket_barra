import { useCallback, useEffect, useState, type FormEvent } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { crearClub, listarClubs, type Club } from "@/lib/datos"
import { slugDesdeNombre, validarClub, type ErroresClub } from "@/lib/validaciones"

type Props = {
  client: SupabaseClient
  adminId: string | null
  onSeleccionar: (club: Club) => void
}

export function ClubsPage({ client, adminId, onSeleccionar }: Props) {
  const [clubs, setClubs] = useState<Club[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      setClubs(await listarClubs(client))
    } catch {
      setError("No se pudieron cargar los clubs. Revisá tu sesión y tus permisos.")
    } finally {
      setCargando(false)
    }
  }, [client])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return (
    <div className="flex w-full max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Clubs</h1>
          <p className="text-sm text-muted-foreground">Los clubs que administrás. Elegí uno para gestionarlo.</p>
        </div>
        {adminId && !mostrarForm && (
          <Button onClick={() => setMostrarForm(true)}>Nuevo club</Button>
        )}
      </div>

      {!adminId && (
        <Alert>
          <AlertDescription>
            Tu usuario no es administrador de la plataforma: no puede crear clubs.
          </AlertDescription>
        </Alert>
      )}

      {adminId && mostrarForm && (
        <CrearClubForm
          client={client}
          adminId={adminId}
          onCancelar={() => setMostrarForm(false)}
          onCreado={(club) => {
            setMostrarForm(false)
            setClubs((anteriores) =>
              [...anteriores, club].sort((a, b) => a.name.localeCompare(b.name)),
            )
          }}
        />
      )}

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {cargando ? (
        <p className="text-sm text-muted-foreground">Cargando clubs...</p>
      ) : clubs.length === 0 && !error ? (
        <p className="text-sm text-muted-foreground">Todavía no hay clubs. Creá el primero.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {clubs.map((club) => (
            <li key={club.id}>
              <button
                type="button"
                onClick={() => onSeleccionar(club)}
                className="flex min-h-11 w-full flex-col items-start gap-1 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="font-medium">{club.name}</span>
                  {!club.active && <Badge variant="secondary">Inactivo</Badge>}
                </span>
                <span className="text-sm text-muted-foreground">{club.slug}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type FormProps = {
  client: SupabaseClient
  adminId: string
  onCancelar: () => void
  onCreado: (club: Club) => void
}

const ZONA_POR_DEFECTO = "America/Argentina/Buenos_Aires"

export function CrearClubForm({ client, adminId, onCancelar, onCreado }: FormProps) {
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugEditado, setSlugEditado] = useState(false)
  const [timezone, setTimezone] = useState(ZONA_POR_DEFECTO)
  const [hora, setHora] = useState("12")
  const [errores, setErrores] = useState<ErroresClub>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrorGeneral(null)
    const resultado = validarClub({
      name,
      slug,
      timezone,
      businessDayStartHour: Number(hora),
    })
    if (!resultado.ok) {
      setErrores(resultado.errores)
      return
    }
    setErrores({})
    setGuardando(true)
    try {
      onCreado(await crearClub(client, adminId, resultado.valor))
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : ""
      setErrorGeneral(
        mensaje.includes("clubs_slug_unique")
          ? "Ya existe un club con ese identificador. Elegí otro."
          : mensaje.includes("Zona horaria")
            ? "La zona horaria no existe. Usá un nombre como America/Argentina/Buenos_Aires."
            : "No se pudo crear el club. Intentá de nuevo.",
      )
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nuevo club</CardTitle>
        <CardDescription>Después vas a poder cargar su stock, cajas, barras y personal.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <Campo id="club-nombre" etiqueta="Nombre" error={errores.name}>
            <Input
              id="club-nombre"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (!slugEditado) setSlug(slugDesdeNombre(e.target.value))
              }}
            />
          </Campo>
          <Campo
            id="club-slug"
            etiqueta="Identificador (slug)"
            error={errores.slug}
            ayuda="Minúsculas, números y guiones. Se usa en direcciones y no se repite."
          >
            <Input
              id="club-slug"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value)
                setSlugEditado(true)
              }}
            />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="club-zona" etiqueta="Zona horaria" error={errores.timezone}>
              <Input id="club-zona" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </Campo>
            <Campo
              id="club-hora"
              etiqueta="Hora de inicio de jornada"
              error={errores.businessDayStartHour}
              ayuda="Con 12, una venta de las 03:00 cuenta para el día anterior."
            >
              <Input
                id="club-hora"
                type="number"
                inputMode="numeric"
                min={0}
                max={23}
                value={hora}
                onChange={(e) => setHora(e.target.value)}
              />
            </Campo>
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
              {guardando ? "Creando..." : "Crear club"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

type CampoProps = {
  id: string
  etiqueta: string
  error?: string
  ayuda?: string
  children: React.ReactNode
}

export function Campo({ id, etiqueta, error, ayuda, children }: CampoProps) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{etiqueta}</Label>
      {children}
      {ayuda && !error && <p className="text-xs text-muted-foreground">{ayuda}</p>}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
