import { Button } from "@/components/ui/button"
import type { Categoria } from "@/lib/datos"

// Filtro por categoria (Productos, Inicio y cierre). "productos" son las
// filas que se filtran: solo importa su category_id, para contar.
export const TODAS = ""
export const SIN_CATEGORIA = "__sin_categoria"

// Filtro por categoria, arriba de la lista. Muestra las categorias activas y
// las inactivas que todavia tienen productos.
export function FiltroCategorias({
  productos,
  categorias,
  valor,
  onCambio,
}: {
  productos: { category_id: string | null }[]
  categorias: Categoria[]
  valor: string
  onCambio: (v: string) => void
}) {
  const cuenta = (id: string | null) => productos.filter((p) => p.category_id === id).length
  const opciones = [
    { value: TODAS, label: "Todas", n: productos.length },
    ...categorias
      .filter((c) => c.active || cuenta(c.id) > 0)
      .map((c) => ({ value: c.id, label: c.name, n: cuenta(c.id) })),
    ...(cuenta(null) > 0 ? [{ value: SIN_CATEGORIA, label: "Sin categoría", n: cuenta(null) }] : []),
  ]
  return (
    <div role="group" aria-label="Filtrar por categoría" className="flex flex-wrap gap-2">
      {opciones.map((o) => {
        const activa = o.value === valor
        return (
          <Button
            key={o.value || "todas"}
            type="button"
            size="sm"
            variant={activa ? "default" : "outline"}
            aria-pressed={activa}
            className="min-h-11 rounded-full sm:min-h-8"
            onClick={() => onCambio(o.value)}
          >
            {o.label}
            <span
              aria-hidden
              className={`ml-1 rounded-full px-1.5 text-xs tabular-nums ${activa ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground"}`}
            >
              {o.n}
            </span>
          </Button>
        )
      })}
    </div>
  )
}
