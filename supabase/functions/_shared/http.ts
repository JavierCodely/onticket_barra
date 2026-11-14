// Respuestas HTTP comunes de las Edge Functions de Onticket.
//
// CORS: el panel llama desde el navegador. La autenticacion va en el
// header Authorization (no en cookies), asi que no hay riesgo de CSRF;
// igual se puede restringir el origen con la variable PANEL_ORIGIN.

export function corsHeaders(origen: string | undefined): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origen && origen.trim() !== "" ? origen : "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  }
}

export function json(
  cuerpo: unknown,
  status: number,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  })
}

// Extrae el token de "Authorization: Bearer <token>". Null si no hay.
export function tokenBearer(req: Request): string | null {
  const valor = req.headers.get("Authorization") ?? ""
  const m = /^Bearer\s+(\S+)$/i.exec(valor)
  return m ? m[1] : null
}
