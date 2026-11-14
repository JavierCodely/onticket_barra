import { useEffect, useState, type ReactNode } from "react"
import type { Session, SupabaseClient } from "@supabase/supabase-js"
import { TopBar } from "@/components/layout/TopBar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { LoginForm } from "@/features/auth/LoginForm"
import { PanelAdmin } from "@/features/panel/PanelAdmin"
import { ThemeProvider } from "@/features/theme/ThemeProvider"
import { supabase as clientePorDefecto } from "@/lib/supabase"

type Props = {
  client?: SupabaseClient | null
}

export default function App({ client = clientePorDefecto }: Props) {
  const [session, setSession] = useState<Session | null>(null)
  const [listo, setListo] = useState(false)

  useEffect(() => {
    if (!client) return
    let activo = true
    client.auth.getSession().then(({ data }) => {
      if (!activo) return
      setSession(data.session)
      setListo(true)
    })
    const { data: suscripcion } = client.auth.onAuthStateChange((_evento, s) => {
      setSession(s)
    })
    return () => {
      activo = false
      suscripcion.subscription.unsubscribe()
    }
  }, [client])

  // Con sesion, el panel trae su propio menu lateral y barra superior.
  if (client && session) {
    return (
      <ThemeProvider>
        <PanelAdmin client={client} authUserId={session.user.id} />
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider>
      <Layout>
        <Contenido client={client} listo={listo} />
      </Layout>
    </ThemeProvider>
  )
}

function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <TopBar />
      {children}
    </div>
  )
}

type ContenidoProps = {
  client: SupabaseClient | null
  listo: boolean
}

function Contenido({ client, listo }: ContenidoProps) {
  if (!client) {
    return (
      <main className="flex flex-1 items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-sm">
          <AlertTitle>Falta la configuración</AlertTitle>
          <AlertDescription>
            Definí VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY en admin/.env.local.
          </AlertDescription>
        </Alert>
      </main>
    )
  }

  if (!listo) {
    return null
  }

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <LoginForm client={client} />
    </main>
  )
}
