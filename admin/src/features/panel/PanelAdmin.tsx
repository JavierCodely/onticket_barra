import { useCallback, useEffect, useRef, useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { ArrowLeft, ChevronRight, LogOut, Ticket, UserRound } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { CajasBarrasPage } from "@/features/club/CajasBarrasPage"
import { ImpuestosPage } from "@/features/club/ImpuestosPage"
import { PersonalPage } from "@/features/club/PersonalPage"
import { ProductosPage } from "@/features/club/ProductosPage"
import { CombosPage } from "@/features/club/CombosPage"
import { ConfiguracionPage } from "@/features/club/ConfiguracionPage"
import { HistorialPage } from "@/features/club/HistorialPage"
import { PromocionesPage } from "@/features/club/PromocionesPage"
import { InicioCierrePage } from "@/features/club/InicioCierrePage"
import { StockBarraPage } from "@/features/club/StockBarraPage"
import { VentasPage } from "@/features/club/VentasPage"
import { ClubsPage } from "@/features/clubs/ClubsPage"
import { EnDesarrollo } from "@/features/navegacion/EnDesarrollo"
import {
  ETIQUETA_ESTADO,
  MENU_CLUB,
  MENU_GLOBAL,
  type OpcionMenu,
  type SeccionClub,
  type SeccionGlobal,
} from "@/features/navegacion/menus"
import { ControlNoche } from "@/features/noche/ControlNoche"
import { MiPerfil } from "@/features/perfil/MiPerfil"
import { useNoche, type EstadoNoche } from "@/features/noche/useNoche"
import { ThemeToggle } from "@/features/theme/ThemeToggle"
import { listarClubs, obtenerIdAdmin, obtenerPaleta, type Club } from "@/lib/datos"
import { PALETA_POR_DEFECTO, aplicarPaleta, type CodigoPaleta } from "@/lib/paletas"
import { escribirRuta, leerRuta, type Ruta } from "@/lib/ruta"

type Props = {
  client: SupabaseClient
  authUserId: string
}

export function PanelAdmin({ client, authUserId }: Props) {
  // Al recargar se vuelve a donde estaba: club y seccion salen de la
  // direccion (#/club/<id>/<seccion>), ver lib/ruta.ts.
  const [rutaInicial] = useState<Ruta>(() => leerRuta(window.location.hash))
  const [adminId, setAdminId] = useState<string | null>(null)
  const [club, setClub] = useState<Club | null>(null)
  const [seccionGlobal, setSeccionGlobal] = useState<SeccionGlobal>(
    rutaInicial.tipo === "global" ? rutaInicial.seccion : "clubs",
  )
  const [seccionClub, setSeccionClub] = useState<SeccionClub>(
    rutaInicial.tipo === "club" ? rutaInicial.seccion : "dashboard",
  )
  const [abriendoClub, setAbriendoClub] = useState(rutaInicial.tipo === "club")
  // Colores del club abierto (club_settings). Sin club: los de Onticket.
  const [paleta, setPaleta] = useState<CodigoPaleta>(PALETA_POR_DEFECTO)
  const [perfilAbierto, setPerfilAbierto] = useState(false)
  const estadoNoche = useNoche(client, club?.id ?? null)

  useEffect(() => {
    let activo = true
    obtenerIdAdmin(client, authUserId)
      .then((id) => {
        if (activo) setAdminId(id)
      })
      .catch(() => {
        if (activo) setAdminId(null)
      })
    return () => {
      activo = false
    }
  }, [client, authUserId])

  // Lleva el panel a una ruta. El club se vuelve a leer de la base (con RLS):
  // si no existe o quien entra no lo ve, se queda en la lista de clubs.
  const clubActual = useRef<Club | null>(null)
  clubActual.current = club
  const irA = useCallback(
    (ruta: Ruta) => {
      if (ruta.tipo === "global") {
        setClub(null)
        setSeccionGlobal(ruta.seccion)
        return
      }
      setSeccionClub(ruta.seccion)
      if (clubActual.current?.id === ruta.clubId) return
      setAbriendoClub(true)
      listarClubs(client)
        .then((clubs) => {
          const encontrado = clubs.find((c) => c.id === ruta.clubId) ?? null
          setClub(encontrado)
          if (!encontrado) setSeccionGlobal("clubs")
        })
        .catch(() => {
          setClub(null)
          setSeccionGlobal("clubs")
        })
        .finally(() => setAbriendoClub(false))
    },
    [client],
  )

  useEffect(() => {
    if (rutaInicial.tipo === "club") irA(rutaInicial)
  }, [rutaInicial, irA])

  // Atras / Adelante del navegador.
  useEffect(() => {
    const alVolver = () => irA(leerRuta(window.location.hash))
    window.addEventListener("popstate", alVolver)
    return () => window.removeEventListener("popstate", alVolver)
  }, [irA])

  // Cada cambio de club o seccion queda en la direccion (y en el historial
  // del navegador). La primera vez se reemplaza, para no sumar un paso.
  useEffect(() => {
    if (abriendoClub) return
    const destino = escribirRuta(
      club ? { tipo: "club", clubId: club.id, seccion: seccionClub } : { tipo: "global", seccion: seccionGlobal },
    )
    if (window.location.hash === destino) return
    if (window.location.hash === "") window.history.replaceState(null, "", destino)
    else window.history.pushState(null, "", destino)
  }, [club, seccionClub, seccionGlobal, abriendoClub])

  useEffect(() => {
    let vigente = true
    if (!club) {
      setPaleta(PALETA_POR_DEFECTO)
      return
    }
    obtenerPaleta(client, club.id)
      .then((p) => vigente && setPaleta(p))
      .catch(() => vigente && setPaleta(PALETA_POR_DEFECTO))
    return () => {
      vigente = false
    }
  }, [client, club])

  useEffect(() => {
    aplicarPaleta(paleta)
  }, [paleta])

  // Al salir del panel (cerrar sesion), vuelven los colores de Onticket.
  useEffect(() => () => aplicarPaleta(null), [])

  function cerrarSesion() {
    // Quien entre despues arranca en la lista de clubs.
    window.history.replaceState(null, "", window.location.pathname + window.location.search)
    void client.auth.signOut()
  }

  function abrirClub(seleccionado: Club) {
    setClub(seleccionado)
    setSeccionClub("dashboard")
  }

  const opcionActual = club
    ? MENU_CLUB.find((o) => o.id === seccionClub)
    : MENU_GLOBAL.find((o) => o.id === seccionGlobal)

  return (
    <SidebarProvider>
      <Sidebar variant="inset" collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-1 py-1.5">
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
            >
              <Ticket className="size-4" />
            </span>
            <span className="truncate text-base font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
              Onticket
            </span>
          </div>
          {club && <TarjetaClub club={club} nocheEnCurso={estadoNoche.noche !== null} />}
        </SidebarHeader>
        <SidebarContent>
          {club ? (
            <>
              <SidebarGroup className="py-0">
                <SidebarMenu>
                  <SidebarMenuItem>
                    <BotonMenu onClick={() => setClub(null)}>
                      <ArrowLeft aria-hidden />
                      <span>Todos los clubs</span>
                    </BotonMenu>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroup>
              <ListaMenu
                titulo={club.name}
                opciones={MENU_CLUB}
                activa={seccionClub}
                onElegir={setSeccionClub}
              />
            </>
          ) : (
            <ListaMenu
              titulo="Plataforma"
              opciones={MENU_GLOBAL}
              activa={seccionGlobal}
              onElegir={setSeccionGlobal}
            />
          )}
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            {adminId && (
              <SidebarMenuItem>
                <BotonMenu onClick={() => setPerfilAbierto(true)}>
                  <UserRound aria-hidden />
                  <span>Mi perfil</span>
                </BotonMenu>
              </SidebarMenuItem>
            )}
            <SidebarMenuItem>
              <BotonMenu onClick={cerrarSesion}>
                <LogOut aria-hidden />
                <span>Cerrar sesión</span>
              </BotonMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 md:rounded-t-xl md:px-4">
          <div className="flex min-w-0 items-center gap-1.5">
            <SidebarTrigger className="size-11 md:size-8" aria-label="Abrir o cerrar el menú" />
            <span aria-hidden className="mx-1 hidden h-4 w-px bg-border sm:block" />
            <nav aria-label="Ubicación" className="flex min-w-0 items-center gap-1.5 text-sm">
              <span className="hidden truncate text-muted-foreground sm:inline">{club ? club.name : "Plataforma"}</span>
              <ChevronRight aria-hidden className="hidden size-3.5 shrink-0 text-muted-foreground sm:block" />
              <span className="truncate font-medium">{opcionActual?.titulo ?? ""}</span>
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {club && <ControlNoche key={club.id} client={client} clubId={club.id} estado={estadoNoche} />}
            <ThemeToggle />
          </div>
        </header>
        <main className="flex min-w-0 flex-1 flex-col items-center px-3 py-4 sm:px-4 md:px-6 md:py-6">
          {abriendoClub ? (
            <p className="text-sm text-muted-foreground">Abriendo club...</p>
          ) : club ? (
            <ContenidoClub
              client={client}
              club={club}
              seccion={seccionClub}
              noche={estadoNoche}
              paleta={paleta}
              onCambioPaleta={setPaleta}
            />
          ) : (
            <ContenidoGlobal
              client={client}
              adminId={adminId}
              seccion={seccionGlobal}
              onAbrirClub={abrirClub}
            />
          )}
        </main>
      </SidebarInset>
      {adminId && (
        <MiPerfil
          client={client}
          authUserId={authUserId}
          abierto={perfilAbierto}
          onCerrar={() => setPerfilAbierto(false)}
        />
      )}
    </SidebarProvider>
  )
}

// Club abierto: inicial, nombre y estado de la noche. En modo iconos solo la inicial.
function TarjetaClub({ club, nocheEnCurso }: { club: Club; nocheEnCurso: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-sidebar-border bg-background/60 p-2 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0">
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-accent text-sm font-semibold text-sidebar-accent-foreground"
      >
        {club.name.trim().charAt(0).toUpperCase()}
      </span>
      <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
        <span className="truncate text-sm font-medium">{club.name}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            aria-hidden
            className={
              nocheEnCurso
                ? "size-2 rounded-full bg-success shadow-[0_0_0_3px] shadow-success/20"
                : "size-2 rounded-full bg-muted-foreground/40"
            }
          />
          {nocheEnCurso ? "Noche en curso" : "Noche sin iniciar"}
        </span>
      </div>
    </div>
  )
}

// En telefono el menu es un panel desplegable: al elegir una opcion se cierra.
function BotonMenu({
  onClick,
  isActive,
  children,
}: {
  onClick: () => void
  isActive?: boolean
  children: React.ReactNode
}) {
  const { isMobile, setOpenMobile } = useSidebar()
  return (
    <SidebarMenuButton
      isActive={isActive}
      aria-current={isActive ? "page" : undefined}
      className="min-h-11 md:min-h-8"
      onClick={() => {
        onClick()
        if (isMobile) setOpenMobile(false)
      }}
    >
      {children}
    </SidebarMenuButton>
  )
}

type ListaMenuProps<T extends string> = {
  titulo: string
  opciones: OpcionMenu<T>[]
  activa: T
  onElegir: (id: T) => void
}

function ListaMenu<T extends string>({ titulo, opciones, activa, onElegir }: ListaMenuProps<T>) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="truncate">{titulo}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu aria-label={`Menú de ${titulo}`}>
          {opciones.map((opcion) => {
            const etiqueta = ETIQUETA_ESTADO[opcion.estado]
            return (
              <SidebarMenuItem key={opcion.id}>
                <BotonMenu isActive={opcion.id === activa} onClick={() => onElegir(opcion.id)}>
                  <opcion.icono aria-hidden />
                  <span className="flex-1">{opcion.titulo}</span>
                  {etiqueta && (
                    <Badge
                      variant="outline"
                      className="h-5 px-1.5 text-[10px] font-normal text-muted-foreground group-data-[collapsible=icon]:hidden"
                    >
                      {etiqueta}
                    </Badge>
                  )}
                </BotonMenu>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function ContenidoGlobal({
  client,
  adminId,
  seccion,
  onAbrirClub,
}: {
  client: SupabaseClient
  adminId: string | null
  seccion: SeccionGlobal
  onAbrirClub: (club: Club) => void
}) {
  if (seccion === "clubs") {
    return <ClubsPage client={client} adminId={adminId} onSeleccionar={onAbrirClub} />
  }
  return <Placeholder opciones={MENU_GLOBAL} seccion={seccion} />
}

function ContenidoClub({
  client,
  club,
  seccion,
  noche,
  paleta,
  onCambioPaleta,
}: {
  client: SupabaseClient
  club: Club
  seccion: SeccionClub
  noche: EstadoNoche
  paleta: CodigoPaleta
  onCambioPaleta: (paleta: CodigoPaleta) => void
}) {
  switch (seccion) {
    case "configuracion":
      return (
        <ConfiguracionPage
          key={club.id}
          client={client}
          clubId={club.id}
          paleta={paleta}
          onCambio={onCambioPaleta}
        />
      )
    case "ventas":
      return <VentasPage key={club.id} client={client} clubId={club.id} nocheAbierta={noche.noche} />
    case "productos":
      return <ProductosPage client={client} clubId={club.id} />
    case "stock_barra":
      return <StockBarraPage client={client} clubId={club.id} />
    case "inicio_cierre":
      return <InicioCierrePage key={club.id} client={client} club={club} nocheAbierta={noche.noche} />
    case "combos":
      return <CombosPage key={club.id} client={client} clubId={club.id} />
    case "promociones":
      return <PromocionesPage key={club.id} client={client} clubId={club.id} />
    case "cajas":
      return <CajasBarrasPage client={client} clubId={club.id} />
    case "impuestos":
      return <ImpuestosPage client={client} clubId={club.id} />
    case "personal":
      return <PersonalPage client={client} clubId={club.id} />
    case "historial":
      return <HistorialPage key={club.id} client={client} club={club} />
    default:
      return <Placeholder opciones={MENU_CLUB} seccion={seccion} />
  }
}

function Placeholder<T extends string>({ opciones, seccion }: { opciones: OpcionMenu<T>[]; seccion: T }) {
  const opcion = opciones.find((o) => o.id === seccion)
  if (!opcion) return null
  return (
    <EnDesarrollo
      titulo={opcion.titulo}
      etiqueta={ETIQUETA_ESTADO[opcion.estado] ?? "En desarrollo"}
    />
  )
}
