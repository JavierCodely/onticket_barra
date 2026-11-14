import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type Props = {
  titulo: string
  etiqueta: string
}

export function EnDesarrollo({ titulo, etiqueta }: Props) {
  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle>{titulo}</CardTitle>
        <CardDescription>{etiqueta}. Esta sección todavía no tiene datos.</CardDescription>
      </CardHeader>
    </Card>
  )
}
