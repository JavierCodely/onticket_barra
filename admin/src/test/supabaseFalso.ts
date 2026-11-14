// Cliente de Supabase falso para pruebas de componentes. Cada llamada a
// from(tabla) consume la siguiente respuesta preparada para esa tabla; sin
// respuestas, devuelve una lista vacia. Las RPC se preparan con la clave
// "rpc:<nombre>" y las Edge Functions con "fn:<nombre>". Storage: las
// subidas se preparan con "storage:upload:<bucket>" y quedan en "subidas";
// lo que se borra queda en "borrados".
// Registra todo lo que se escribe, para verificar el contrato con la base.
import type { Session, SupabaseClient } from "@supabase/supabase-js"
import { vi } from "vitest"

export type RespuestaFalsa = { data: unknown; error: unknown }

export type Escritura = {
  tabla: string
  operacion: "insert" | "update" | "delete"
  fila?: unknown
  filtros: { metodo: string; args: unknown[] }[]
}

export type ClienteFalso = {
  client: SupabaseClient
  signOut: ReturnType<typeof vi.fn>
  inserciones: { tabla: string; fila: unknown }[]
  escrituras: Escritura[]
  consultas: { tabla: string; metodo: string; args: unknown[] }[]
  rpcs: { nombre: string; args: unknown }[]
  invocaciones: { nombre: string; body: unknown }[]
  // Realtime: canales abiertos y como simular un cambio en una tabla.
  canales: { nombre: string; tablas: string[]; cerrado: boolean }[]
  emitir: (tabla: string) => void
  subidas: { bucket: string; ruta: string; archivo: unknown; opciones: unknown }[]
  borrados: { bucket: string; rutas: string[] }[]
}

export const URL_STORAGE = "https://proyecto.supabase.co/storage/v1/object/public"

export function crearClienteFalso(
  session: Session | null,
  respuestas: Record<string, RespuestaFalsa[]> = {},
): ClienteFalso {
  const signOut = vi.fn().mockResolvedValue({ error: null })
  const inserciones: ClienteFalso["inserciones"] = []
  const escrituras: Escritura[] = []
  const consultas: ClienteFalso["consultas"] = []
  const rpcs: ClienteFalso["rpcs"] = []
  const invocaciones: ClienteFalso["invocaciones"] = []
  const pendientes: Record<string, RespuestaFalsa[]> = Object.fromEntries(
    Object.entries(respuestas).map(([clave, lista]) => [clave, [...lista]]),
  )
  const siguiente = (clave: string, porDefecto: RespuestaFalsa) => pendientes[clave]?.shift() ?? porDefecto

  function from(tabla: string) {
    const preparada = pendientes[tabla]?.shift()
    let unico = false
    let escritura: Escritura | null = null
    const consulta: Record<string, unknown> = {}
    for (const metodo of ["select", "eq", "is", "in", "gte", "lt", "lte", "contains", "order", "limit", "maybeSingle", "single"]) {
      consulta[metodo] = (...args: unknown[]) => {
        if (metodo === "maybeSingle" || metodo === "single") unico = true
        consultas.push({ tabla, metodo, args })
        escritura?.filtros.push({ metodo, args })
        return consulta
      }
    }
    consulta.insert = (fila: unknown) => {
      inserciones.push({ tabla, fila })
      escritura = { tabla, operacion: "insert", fila, filtros: [] }
      escrituras.push(escritura)
      return consulta
    }
    consulta.update = (fila: unknown) => {
      escritura = { tabla, operacion: "update", fila, filtros: [] }
      escrituras.push(escritura)
      return consulta
    }
    consulta.delete = () => {
      escritura = { tabla, operacion: "delete", filtros: [] }
      escrituras.push(escritura)
      return consulta
    }
    // Sin respuesta preparada: lista vacia, o null si se pidio una sola fila.
    consulta.then = (ok: (r: RespuestaFalsa) => unknown, mal?: (e: unknown) => unknown) =>
      Promise.resolve(preparada ?? { data: unico ? null : [], error: null }).then(ok, mal)
    return consulta
  }

  const canales: ClienteFalso["canales"] = []
  const oyentes: { tabla: string; canal: ClienteFalso["canales"][number]; cb: () => void }[] = []
  function channel(nombre: string) {
    const registro = { nombre, tablas: [] as string[], cerrado: false }
    canales.push(registro)
    const canal = {
      on: (_tipo: string, filtro: { table: string }, cb: () => void) => {
        registro.tablas.push(filtro.table)
        oyentes.push({ tabla: filtro.table, canal: registro, cb })
        return canal
      },
      subscribe: (cb?: (estado: string) => void) => {
        cb?.("SUBSCRIBED")
        return canal
      },
      _registro: registro,
    }
    return canal
  }
  const emitir = (tabla: string) => {
    for (const o of oyentes) if (o.tabla === tabla && !o.canal.cerrado) o.cb()
  }

  const subidas: ClienteFalso["subidas"] = []
  const borrados: ClienteFalso["borrados"] = []
  const storage = {
    from: (bucket: string) => ({
      upload: (ruta: string, archivo: unknown, opciones: unknown) => {
        subidas.push({ bucket, ruta, archivo, opciones })
        return Promise.resolve(siguiente(`storage:upload:${bucket}`, { data: { path: ruta }, error: null }))
      },
      getPublicUrl: (ruta: string) => ({ data: { publicUrl: `${URL_STORAGE}/${bucket}/${ruta}` } }),
      remove: (rutas: string[]) => {
        borrados.push({ bucket, rutas })
        return Promise.resolve({ data: [], error: null })
      },
    }),
  }

  const client = {
    from,
    storage,
    channel,
    removeChannel: (canal: { _registro: { cerrado: boolean } }) => {
      canal._registro.cerrado = true
      return Promise.resolve("ok")
    },
    rpc: (nombre: string, args: unknown) => {
      rpcs.push({ nombre, args })
      return Promise.resolve(siguiente(`rpc:${nombre}`, { data: [], error: null }))
    },
    functions: {
      invoke: (nombre: string, opciones: { body: unknown }) => {
        invocaciones.push({ nombre, body: opciones.body })
        return Promise.resolve(siguiente(`fn:${nombre}`, { data: null, error: null }))
      },
    },
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      signInWithPassword: vi.fn(),
      signOut,
    },
  } as unknown as SupabaseClient

  return { client, signOut, inserciones, escrituras, consultas, rpcs, invocaciones, canales, emitir, subidas, borrados }
}

// Error HTTP como lo entrega supabase-js al invocar una Edge Function.
export function errorDeFuncion(status: number, cuerpo: unknown): RespuestaFalsa {
  return {
    data: null,
    error: { name: "FunctionsHttpError", context: new Response(JSON.stringify(cuerpo), { status }) },
  }
}

export const SESION_DE_PRUEBA = {
  access_token: "t",
  user: { id: "auth-admin-1" },
} as unknown as Session
