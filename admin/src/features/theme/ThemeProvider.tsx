import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { ContextoTemaReact } from "./theme-context"
import {
  aplicarTema,
  guardarTema,
  temaInicial,
  temaOpuesto,
  type Tema,
} from "./theme-config"

type Props = {
  children: ReactNode
}

export function ThemeProvider({ children }: Props) {
  const [tema, setTema] = useState<Tema>(temaInicial)

  useEffect(() => {
    aplicarTema(tema)
  }, [tema])

  const alternarTema = useCallback(() => {
    const siguiente = temaOpuesto(tema)
    guardarTema(siguiente)
    setTema(siguiente)
  }, [tema])

  const valor = useMemo(() => ({ tema, alternarTema }), [tema, alternarTema])

  return (
    <ContextoTemaReact.Provider value={valor}>{children}</ContextoTemaReact.Provider>
  )
}
