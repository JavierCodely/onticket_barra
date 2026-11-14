import { useState } from "react"
import { Check, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FiltroCategorias, SIN_CATEGORIA, TODAS } from "@/features/club/FiltroCategorias"
import { Miniatura } from "@/features/club/ProductosPage"
import type { Categoria, Producto } from "@/lib/datos"
import { formatearMonto } from "@/lib/formato"

// PANTALLA_COMPLETA: clases del DialogContent de Combos y Promociones, que
// ocupan toda la pantalla para ver el catalogo a la izquierda.
export const PANTALLA_COMPLETA =
  "top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-4 overflow-y-auto rounded-none p-4 sm:max-w-none sm:p-6 lg:overflow-hidden"

// Grilla de dos columnas (catalogo | formulario) dentro de PANTALLA_COMPLETA.
export const GRILLA_CATALOGO =
  "grid min-h-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]"

type Props = {
  productos: Producto[] // ya filtrados (por ejemplo, solo activos)
  categorias: Categoria[]
  elegidos: Set<string>
  onElegir: (p: Producto) => void
  onQuitar: (productId: string) => void
  textoElegir: (nombre: string) => string // aria-label del boton "+"
  textoQuitar: (nombre: string) => string // aria-label del boton "check"
  bloqueado?: boolean // solo mirar (por ejemplo, al editar una promocion)
  aviso?: string
}

// Catalogo de productos con filtro por categoria y busqueda por nombre o
// SKU. Cada producto se elige (o se quita) con su boton.
export function CatalogoProductos({
  productos,
  categorias,
  elegidos,
  onElegir,
  onQuitar,
  textoElegir,
  textoQuitar,
  bloqueado = false,
  aviso,
}: Props) {
  const [categoria, setCategoria] = useState(TODAS)
  const [busqueda, setBusqueda] = useState("")
  const texto = busqueda.trim().toLocaleLowerCase("es")
  const visibles = productos.filter(
    (p) =>
      (categoria === TODAS ? true : categoria === SIN_CATEGORIA ? p.category_id === null : p.category_id === categoria) &&
      (!texto || p.name.toLocaleLowerCase("es").includes(texto) || (p.sku ?? "").toLocaleLowerCase("es").includes(texto)),
  )
  const nombreCategoria = (id: string | null) => categorias.find((c) => c.id === id)?.name ?? "Sin categoría"

  return (
    <section
      aria-labelledby="titulo-catalogo"
      className="flex min-h-0 min-w-0 flex-col gap-3 rounded-xl border border-border bg-muted/20 p-3"
    >
      <div className="flex flex-col gap-2">
        <h3 id="titulo-catalogo" className="text-sm font-medium">
          Catálogo de productos
        </h3>
        {aviso && <p className="text-xs text-muted-foreground">{aviso}</p>}
        <Input
          type="search"
          aria-label="Buscar producto"
          placeholder="Buscar por nombre o SKU"
          className="h-11 sm:h-9"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        {productos.length > 0 && (
          <FiltroCategorias productos={productos} categorias={categorias} valor={categoria} onCambio={setCategoria} />
        )}
      </div>
      {productos.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay productos activos. Crealos en Productos.</p>
      ) : visibles.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ningún producto coincide.</p>
      ) : (
        <ul className="grid min-h-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:overflow-y-auto lg:pr-1">
          {visibles.map((p) => {
            const elegido = elegidos.has(p.id)
            return (
              <li
                key={p.id}
                className={`flex items-center gap-3 rounded-lg border p-2 ${elegido ? "border-primary bg-accent" : "border-border bg-card"}`}
              >
                <Miniatura url={p.image_url} nombre={p.name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{nombreCategoria(p.category_id)}</div>
                  <div className="text-xs tabular-nums text-muted-foreground">
                    Costo {formatearMonto(p.cost)} · Precio {formatearMonto(p.price)}
                  </div>
                </div>
                {elegido ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11 shrink-0 md:size-9"
                    aria-label={textoQuitar(p.name)}
                    title={textoQuitar(p.name)}
                    disabled={bloqueado}
                    onClick={() => onQuitar(p.id)}
                  >
                    <Check aria-hidden />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="default"
                    size="icon"
                    className="size-11 shrink-0 md:size-9"
                    aria-label={textoElegir(p.name)}
                    title={textoElegir(p.name)}
                    disabled={bloqueado}
                    onClick={() => onElegir(p)}
                  >
                    <Plus aria-hidden />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
