import { createContext } from "react"
import type { Tema } from "./theme-config"

export type ContextoTema = {
  tema: Tema
  alternarTema: () => void
}

export const ContextoTemaReact = createContext<ContextoTema | null>(null)
