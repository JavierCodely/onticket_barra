import { useState, type FormEvent } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export const MENSAJE_CREDENCIALES = "Email o contraseña incorrectos."
export const MENSAJE_ERROR_GENERICO = "No se pudo iniciar sesión. Intentá de nuevo."

type Props = {
  client: SupabaseClient
}

export function LoginForm({ client }: Props) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setCargando(true)
    try {
      const { error: authError } = await client.auth.signInWithPassword({
        email,
        password,
      })
      if (authError) {
        // Mensaje generico: no revela si el email existe.
        setError(
          authError.status === 400 || authError.status === 401
            ? MENSAJE_CREDENCIALES
            : MENSAJE_ERROR_GENERICO,
        )
      }
    } catch {
      setError(MENSAJE_ERROR_GENERICO)
    } finally {
      setCargando(false)
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Onticket</CardTitle>
        <CardDescription>Panel de administración</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={cargando}>
            {cargando ? "Ingresando..." : "Ingresar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
