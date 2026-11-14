// Lista desplegable nativa: en telefono abre el selector del sistema,
// que es el mas comodo de usar con el dedo.
type Opcion = { value: string; label: string }

type Props = {
  id: string
  value: string
  onChange: (valor: string) => void
  opciones: Opcion[]
  vacio?: string
}

export function Selector({ id, value, onChange, opciones, vacio }: Props) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9"
    >
      {vacio !== undefined && <option value="">{vacio}</option>}
      {opciones.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
