import { useEffect, useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { actualizarMiPerfil, obtenerMiPerfil, type Perfil } from "@/lib/datos"
import { validarPerfil, type ErroresPerfil, type FormPerfil } from "@/lib/perfil"

type Props = {
  client: SupabaseClient
  authUserId: string
  abierto: boolean
  onCerrar: () => void
}

const VACIO: FormPerfil = { nombre: "", apellido: "", telefono: "" }

// Datos del administrador: nombre y apellido (los ve el personal de sus
// clubs en el historial) y telefono (solo lo ve el). El email es el de la
// cuenta con la que entra y no se cambia aca.
export function MiPerfil({ client, authUserId, abierto, onCerrar }: Props) {
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [form, setForm] = useState<FormPerfil>(VACIO)
  const [errores, setErrores] = useState<ErroresPerfil>({})
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState(false)

  useEffect(() => {
    if (!abierto) return
    let vigente = true
    setError(null)
    setErrores({})
    setGuardado(false)
    obtenerMiPerfil(client, authUserId)
      .then((p) => {
        if (!vigente) return
        setPerfil(p)
        setForm(
          p
            ? {
                nombre: p.first_name ?? p.full_name,
                apellido: p.last_name ?? "",
                telefono: p.phone ?? "",
              }
            : VACIO,
        )
        if (!p) setError("No se encontró tu ficha de administrador.")
      })
      .catch(() => vigente && setError("No se pudo cargar tu perfil."))
    return () => {
      vigente = false
    }
  }, [abierto, client, authUserId])

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (!perfil) return
    const r = validarPerfil(form)
    if (!r.ok) {
      setErrores(r.errores)
      return
    }
    setErrores({})
    setGuardando(true)
    try {
      setPerfil(await actualizarMiPerfil(client, perfil.id, r.valor))
      setError(null)
      setGuardado(true)
    } catch {
      setError("No se pudo guardar. Revisá los datos e intentá de nuevo.")
    } finally {
      setGuardando(false)
    }
  }

  const campo = (clave: keyof FormPerfil, etiqueta: string, extra?: React.ComponentProps<typeof Input>) => (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={`perfil-${clave}`} className="font-medium">
        {etiqueta}
      </label>
      <Input
        id={`perfil-${clave}`}
        className="h-11 sm:h-9"
        value={form[clave]}
        aria-invalid={errores[clave] ? true : undefined}
        onChange={(e) => {
          setForm((f) => ({ ...f, [clave]: e.target.value }))
          setGuardado(false)
        }}
        {...extra}
      />
      {errores[clave] && <span className="text-xs text-destructive">{errores[clave]}</span>}
    </div>
  )

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mi perfil</DialogTitle>
          <DialogDescription>
            Tu nombre aparece en el historial de tus clubs. El teléfono solo lo ves vos.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={guardar} noValidate className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {campo("nombre", "Nombre")}
            {campo("apellido", "Apellido")}
          </div>
          {campo("telefono", "Teléfono", { type: "tel", inputMode: "tel" })}
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor="perfil-email" className="font-medium">
              Email
            </label>
            <Input id="perfil-email" className="h-11 sm:h-9" value={perfil?.email ?? ""} readOnly disabled />
            <span className="text-xs text-muted-foreground">Es el de la cuenta con la que entrás.</span>
          </div>
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {guardado && (
            <p role="status" className="text-sm text-success">
              Perfil guardado.
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={onCerrar}>
              Cerrar
            </Button>
            <Button type="submit" className="min-h-11 sm:min-h-9" disabled={!perfil || guardando}>
              {guardando ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
