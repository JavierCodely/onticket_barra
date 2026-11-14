import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

afterEach(() => {
  cleanup()
  // El panel guarda club y seccion en la direccion (lib/ruta.ts): cada
  // prueba arranca sin ella.
  window.history.replaceState(null, "", "/")
  // Y con los colores de Onticket (la paleta de cada club, lib/paletas.ts).
  delete document.documentElement.dataset.palette
})

// jsdom no trae matchMedia; la barra lateral lo usa para detectar telefono.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}
