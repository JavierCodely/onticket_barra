import { useContext } from "react"
import { ContextoTemaReact, type ContextoTema } from "./theme-context"

export function useTema(): ContextoTema {
  const contexto = useContext(ContextoTemaReact)
  if (!contexto) {
    throw new Error("useTema debe usarse dentro de <ThemeProvider>")
  }
  return contexto
}
