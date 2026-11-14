import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTema } from "./useTema"

export function ThemeToggle() {
  const { tema, alternarTema } = useTema()
  const esOscuro = tema === "dark"

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={alternarTema}
      aria-label={esOscuro ? "Activar modo claro" : "Activar modo oscuro"}
    >
      {esOscuro ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  )
}
