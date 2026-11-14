// Menus del panel (CLAUDE.md, seccion 4 bis).
// "activa": pantalla con datos. "en_desarrollo" y "proxima": solo aviso.
import {
  Building2,
  Calculator,
  ClipboardList,
  GlassWater,
  History,
  LayoutDashboard,
  Package,
  Percent,
  Receipt,
  Settings,
  ScrollText,
  Store,
  Tag,
  Users,
  type LucideIcon,
} from "lucide-react"

export type EstadoOpcion = "activa" | "en_desarrollo" | "proxima"

export type SeccionGlobal = "dashboard" | "clubs" | "logs"

export type SeccionClub =
  | "dashboard"
  | "ventas"
  | "productos"
  | "stock_barra"
  | "inicio_cierre"
  | "combos"
  | "promociones"
  | "cajas"
  | "impuestos"
  | "personal"
  | "historial"
  | "configuracion"

export type OpcionMenu<T extends string> = {
  id: T
  titulo: string
  estado: EstadoOpcion
  icono: LucideIcon
}

// Sin club seleccionado.
export const MENU_GLOBAL: OpcionMenu<SeccionGlobal>[] = [
  { id: "dashboard", titulo: "Dashboard", estado: "en_desarrollo", icono: LayoutDashboard },
  { id: "clubs", titulo: "Clubs", estado: "activa", icono: Building2 },
  { id: "logs", titulo: "Logs", estado: "en_desarrollo", icono: ScrollText },
]

// Al seleccionar un club, en este orden.
export const MENU_CLUB: OpcionMenu<SeccionClub>[] = [
  { id: "dashboard", titulo: "Dashboard", estado: "en_desarrollo", icono: LayoutDashboard },
  { id: "ventas", titulo: "Ventas", estado: "activa", icono: Receipt },
  { id: "productos", titulo: "Productos", estado: "activa", icono: Package },
  { id: "stock_barra", titulo: "Stock en barra", estado: "activa", icono: GlassWater },
  { id: "inicio_cierre", titulo: "Inicio y cierre", estado: "activa", icono: ClipboardList },
  { id: "combos", titulo: "Combos", estado: "activa", icono: Tag },
  { id: "promociones", titulo: "Promociones", estado: "activa", icono: Percent },
  { id: "cajas", titulo: "Cajas/Barras", estado: "activa", icono: Store },
  { id: "impuestos", titulo: "Impuestos", estado: "activa", icono: Calculator },
  { id: "personal", titulo: "Personal", estado: "activa", icono: Users },
  { id: "historial", titulo: "Historial", estado: "activa", icono: History },
  { id: "configuracion", titulo: "Configuración", estado: "activa", icono: Settings },
]

export const ETIQUETA_ESTADO: Record<EstadoOpcion, string | null> = {
  activa: null,
  en_desarrollo: "En desarrollo",
  proxima: "Próximamente",
}
