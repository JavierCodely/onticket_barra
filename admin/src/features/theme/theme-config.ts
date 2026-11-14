// Funciones puras del tema. No dependen de React, asi se prueban aisladas.

export type Tema = "light" | "dark"

// Clave de localStorage. index.html la lee antes de que cargue React para
// evitar el destello de tema claro: si cambia, cambiarla tambien ahi.
export const CLAVE_TEMA = "onticket-theme"

const CONSULTA_OSCURO = "(prefers-color-scheme: dark)"

export function esTema(valor: unknown): valor is Tema {
  return valor === "light" || valor === "dark"
}

export function leerTemaGuardado(): Tema | null {
  try {
    const valor = window.localStorage.getItem(CLAVE_TEMA)
    return esTema(valor) ? valor : null
  } catch {
    // Sin acceso a localStorage (modo privado, datos bloqueados): se ignora.
    return null
  }
}

export function guardarTema(tema: Tema): void {
  try {
    window.localStorage.setItem(CLAVE_TEMA, tema)
  } catch {
    // El tema vale solo para esta sesion si no se puede guardar.
  }
}

export function temaDelSistema(): Tema {
  const consulta = window.matchMedia?.(CONSULTA_OSCURO)
  return consulta?.matches ? "dark" : "light"
}

export function temaInicial(): Tema {
  return leerTemaGuardado() ?? temaDelSistema()
}

export function aplicarTema(tema: Tema): void {
  const raiz = document.documentElement
  raiz.classList.toggle("dark", tema === "dark")
  raiz.style.colorScheme = tema
}

export function temaOpuesto(tema: Tema): Tema {
  return tema === "dark" ? "light" : "dark"
}
