// Paletas de colores del panel, una por club (club_settings.palette,
// archivo 20). Los codigos son los del CHECK de la base; los colores de
// cada una estan en index.css ([data-palette="..."]). La muestra es el
// color principal en tema claro y oscuro.
export const PALETAS = [
  { codigo: "violeta", nombre: "Violeta", claro: "oklch(0.52 0.22 288)", oscuro: "oklch(0.72 0.16 290)" },
  { codigo: "azul", nombre: "Azul", claro: "oklch(0.52 0.2 258)", oscuro: "oklch(0.72 0.14 258)" },
  { codigo: "turquesa", nombre: "Turquesa", claro: "oklch(0.53 0.12 205)", oscuro: "oklch(0.75 0.11 205)" },
  { codigo: "esmeralda", nombre: "Esmeralda", claro: "oklch(0.53 0.14 160)", oscuro: "oklch(0.74 0.15 160)" },
  { codigo: "ambar", nombre: "Ámbar", claro: "oklch(0.58 0.16 58)", oscuro: "oklch(0.8 0.15 58)" },
  { codigo: "coral", nombre: "Coral", claro: "oklch(0.57 0.19 32)", oscuro: "oklch(0.74 0.15 32)" },
  { codigo: "rosa", nombre: "Rosa", claro: "oklch(0.55 0.21 355)", oscuro: "oklch(0.74 0.16 355)" },
  { codigo: "grafito", nombre: "Grafito", claro: "oklch(0.3 0.01 270)", oscuro: "oklch(0.88 0.01 270)" },
  // Archivo 21. Rojo: en modo oscuro, ademas, fondo negro profundo.
  { codigo: "rojo", nombre: "Rojo", claro: "oklch(0.55 0.24 27)", oscuro: "oklch(0.62 0.25 27)" },
  { codigo: "naranja", nombre: "Naranja", claro: "oklch(0.6 0.19 48)", oscuro: "oklch(0.75 0.17 48)" },
  { codigo: "lima", nombre: "Lima", claro: "oklch(0.56 0.16 130)", oscuro: "oklch(0.84 0.19 130)" },
  { codigo: "cielo", nombre: "Cielo", claro: "oklch(0.56 0.15 232)", oscuro: "oklch(0.77 0.13 232)" },
  { codigo: "indigo", nombre: "Índigo", claro: "oklch(0.47 0.22 275)", oscuro: "oklch(0.7 0.16 275)" },
  { codigo: "fucsia", nombre: "Fucsia", claro: "oklch(0.55 0.25 325)", oscuro: "oklch(0.73 0.2 325)" },
] as const

export type CodigoPaleta = (typeof PALETAS)[number]["codigo"]

export const PALETA_POR_DEFECTO: CodigoPaleta = "violeta"

export function esPaleta(valor: unknown): valor is CodigoPaleta {
  return PALETAS.some((p) => p.codigo === valor)
}

export function nombrePaleta(codigo: unknown): string {
  return PALETAS.find((p) => p.codigo === codigo)?.nombre ?? String(codigo)
}

// Aplica la paleta a toda la pagina. Sin club (o una desconocida): la de
// Onticket.
export function aplicarPaleta(codigo: string | null): void {
  const raiz = document.documentElement
  if (codigo && esPaleta(codigo) && codigo !== PALETA_POR_DEFECTO) raiz.dataset.palette = codigo
  else delete raiz.dataset.palette
}
