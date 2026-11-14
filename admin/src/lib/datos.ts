// Consultas al panel. Pasan por RLS: la base filtra las filas y valida los
// permisos por columna. Se piden solo las columnas que el panel puede leer
// (users no expone pin_hash, failed_attempts ni locked_until).
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Monto } from "./formato"
import type { PlanPreciosBarra, PrecioBarra } from "./precios-barra"
import type { ComboItemGuardado, PlanComboItems, ValorCombo } from "./combos"
import type { CondicionesPromocion, ValorPromocion, VigenciaPromocion } from "./promociones"
import type { Actividad } from "./historial"
import { PALETA_POR_DEFECTO, esPaleta, type CodigoPaleta } from "./paletas"
import type {
  DatosClub,
  FilaMovimiento,
  PedidoPersonal,
  ValorImpuesto,
  ValorProducto,
} from "@/lib/validaciones"

export type Club = {
  id: string
  name: string
  slug: string
  timezone: string
  business_day_start_hour: number
  active: boolean
}

export type Producto = {
  id: string
  name: string
  sku: string | null
  category_id: string | null
  cost: Monto
  price: Monto
  image_url: string | null
  active: boolean
  kind?: "product" | "combo" // archivo 17; sin el, "product"
  units_per_box?: number | null // archivo 22; null = no viene por caja
}

export type Ubicacion = {
  id: string
  name: string
  kind: "bar" | "storage"
  active: boolean
}

export type Caja = {
  id: string
  name: string
  inventory_location_id: string
  active: boolean
}

export type Persona = {
  id: string
  full_name: string
  role: string
  active: boolean
  username: string | null
  email: string | null
}

type Respuesta<T> = { data: T | null; error: { message: string } | null }

function sinError<T>(respuesta: Respuesta<T>): T {
  if (respuesta.error) throw new Error(respuesta.error.message)
  return respuesta.data as T
}

// ---------------------------------------------------------------------
// Cache del panel. Cada pedido a Supabase es un viaje por internet
// (100-300 ms) aunque la base conteste en 1-2 ms: lo que cambia poco
// (catalogo, cajas, personal, impuestos, promociones) se guarda 60 s por
// cliente y se reutiliza al navegar entre pantallas. Pedidos iguales al
// mismo tiempo comparten la respuesta.
//   * Toda escritura del panel vacia el cache (invalidarCache).
//   * Cambiar de sesion lo vacia (otra persona no ve datos ajenos).
//   * Ventas, stock, noches y el estado de las promociones NO se guardan:
//     cambian solos (posnet, Realtime, la hora).
// ---------------------------------------------------------------------
export const DURACION_CACHE_MS = 60_000

type EntradaCache = { hasta: number; valor: Promise<unknown> }
const caches = new WeakMap<object, Map<string, EntradaCache>>()
const escuchandoSesion = new WeakSet<object>()

function cacheDe(client: SupabaseClient): Map<string, EntradaCache> {
  let cache = caches.get(client)
  if (!cache) {
    cache = new Map()
    caches.set(client, cache)
  }
  if (!escuchandoSesion.has(client)) {
    escuchandoSesion.add(client)
    client.auth?.onAuthStateChange?.((evento: string) => {
      if (evento !== "TOKEN_REFRESHED") invalidarCache(client)
    })
  }
  return cache
}

export function invalidarCache(client: SupabaseClient): void {
  caches.get(client)?.clear()
}

async function enCache<T>(client: SupabaseClient, clave: string, leer: () => Promise<T>): Promise<T> {
  const cache = cacheDe(client)
  const ahora = Date.now()
  let entrada = cache.get(clave)
  if (!entrada || entrada.hasta <= ahora) {
    const valor = leer()
    entrada = { hasta: ahora + DURACION_CACHE_MS, valor }
    cache.set(clave, entrada)
    // Un error no se guarda: el proximo pedido vuelve a intentar.
    valor.catch(() => {
      if (cache.get(clave)?.valor === valor) cache.delete(clave)
    })
  }
  const valor = (await entrada.valor) as T
  // Copia: una pantalla no puede alterar lo que ve otra.
  return (Array.isArray(valor) ? [...valor] : valor) as T
}

// Id del administrador de plataforma logueado, o null si no lo es.
export async function obtenerIdAdmin(client: SupabaseClient, authUserId: string): Promise<string | null> {
  const fila = sinError<{ id: string } | null>(
    await client
      .from("platform_admins")
      .select("id")
      .eq("auth_user_id", authUserId)
      .is("deleted_at", null)
      .maybeSingle(),
  )
  return fila?.id ?? null
}

const COLUMNAS_CLUB = "id, name, slug, timezone, business_day_start_hour, active"

export async function listarClubs(client: SupabaseClient): Promise<Club[]> {
  return enCache(client, `clubs`, async () => {
    return sinError<Club[]>(
      await client.from("clubs").select(COLUMNAS_CLUB).is("deleted_at", null).order("name"),
    )
  })
}

export async function crearClub(
  client: SupabaseClient,
  adminId: string,
  datos: DatosClub,
): Promise<Club> {
  invalidarCache(client)
  return sinError<Club>(
    await client
      .from("clubs")
      .insert({
        created_by_admin_id: adminId,
        name: datos.name,
        slug: datos.slug,
        timezone: datos.timezone,
        business_day_start_hour: datos.businessDayStartHour,
      })
      .select(COLUMNAS_CLUB)
      .single(),
  )
}

const COLUMNAS_PRODUCTO = "id, name, sku, category_id, cost, price, image_url, active, kind, units_per_box"

// Productos con stock ("product") o combos ("combo"): nunca mezclados.
export async function listarProductos(
  client: SupabaseClient,
  clubId: string,
  kind: "product" | "combo" = "product",
): Promise<Producto[]> {
  return enCache(client, `productos:${clubId}:${kind}`, async () => {
    return sinError<Producto[]>(
      await client
        .from("products")
        .select(COLUMNAS_PRODUCTO)
        .eq("club_id", clubId)
        .eq("kind", kind)
        .is("deleted_at", null)
        .order("name"),
    )
  })
}

export async function crearProducto(
  client: SupabaseClient,
  clubId: string,
  valor: ValorProducto,
): Promise<Producto> {
  invalidarCache(client)
  return sinError<Producto>(
    await client
      .from("products")
      .insert({ club_id: clubId, ...valor, active: true })
      .select(COLUMNAS_PRODUCTO)
      .single(),
  )
}

// Editar: solo las columnas que el panel puede modificar (CLAUDE.md, seccion 5).
// Cambiar el precio o el costo no toca ventas pasadas: cada venta guardo su foto.
export async function actualizarProducto(
  client: SupabaseClient,
  productoId: string,
  valor: ValorProducto,
): Promise<Producto> {
  invalidarCache(client)
  const { name, sku, category_id, cost, price, units_per_box } = valor
  return sinError<Producto>(
    await client
      .from("products")
      .update({ name, sku, category_id, cost, price, units_per_box })
      .eq("id", productoId)
      .select(COLUMNAS_PRODUCTO)
      .single(),
  )
}

// Inhabilitar: el producto deja de ofrecerse en el posnet, pero sigue en la
// historia y en el stock. Se puede volver a habilitar.
export async function cambiarActivoProducto(
  client: SupabaseClient,
  productoId: string,
  active: boolean,
): Promise<Producto> {
  invalidarCache(client)
  return sinError<Producto>(
    await client.from("products").update({ active }).eq("id", productoId).select(COLUMNAS_PRODUCTO).single(),
  )
}

// ---------------------------------------------------------------------
// Fotos de productos (Storage, bucket publico de solo lectura; archivo 14)
// Ruta: <club_id>/<producto>-<marca de tiempo>.<ext>. Un nombre nuevo por
// cada foto evita que el navegador o el posnet muestren la vieja en cache.
// ---------------------------------------------------------------------
export const BUCKET_FOTOS = "product-images"

const EXTENSION: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }

// Ruta dentro del bucket a partir de la URL publica (para borrar la vieja).
export function rutaDeFoto(url: string | null): string | null {
  if (!url) return null
  const marca = `/object/public/${BUCKET_FOTOS}/`
  const i = url.indexOf(marca)
  return i === -1 ? null : decodeURIComponent(url.slice(i + marca.length))
}

export async function subirFotoProducto(
  client: SupabaseClient,
  clubId: string,
  producto: Producto,
  archivo: File,
): Promise<Producto> {
  invalidarCache(client)
  const ruta = `${clubId}/${producto.id}-${Date.now()}.${EXTENSION[archivo.type] ?? "jpg"}`
  const { error } = await client.storage
    .from(BUCKET_FOTOS)
    .upload(ruta, archivo, { contentType: archivo.type, cacheControl: "31536000", upsert: false })
  if (error) throw new Error(error.message)
  const url = client.storage.from(BUCKET_FOTOS).getPublicUrl(ruta).data.publicUrl
  let actualizado: Producto
  try {
    actualizado = await guardarUrlFoto(client, producto.id, url)
  } catch (err) {
    // La fila no cambio: la foto nueva queda huerfana y se borra.
    await client.storage.from(BUCKET_FOTOS).remove([ruta])
    throw err
  }
  await borrarFotoVieja(client, producto.image_url)
  return actualizado
}

export async function quitarFotoProducto(client: SupabaseClient, producto: Producto): Promise<Producto> {
  const actualizado = await guardarUrlFoto(client, producto.id, null)
  await borrarFotoVieja(client, producto.image_url)
  return actualizado
}

async function guardarUrlFoto(client: SupabaseClient, productoId: string, url: string | null): Promise<Producto> {
  invalidarCache(client)
  return sinError<Producto>(
    await client.from("products").update({ image_url: url }).eq("id", productoId).select(COLUMNAS_PRODUCTO).single(),
  )
}

// Si no se puede borrar, queda un archivo sin usar: no rompe nada.
async function borrarFotoVieja(client: SupabaseClient, url: string | null) {
  const ruta = rutaDeFoto(url)
  if (!ruta) return
  try {
    await client.storage.from(BUCKET_FOTOS).remove([ruta])
  } catch {
    /* sin efecto para el usuario */
  }
}

const COLUMNAS_UBICACION = "id, name, kind, active"

export async function listarUbicaciones(client: SupabaseClient, clubId: string): Promise<Ubicacion[]> {
  return enCache(client, `ubicaciones:${clubId}`, async () => {
    return sinError<Ubicacion[]>(
      await client
        .from("inventory_locations")
        .select(COLUMNAS_UBICACION)
        .eq("club_id", clubId)
        .is("deleted_at", null)
        .order("name"),
    )
  })
}

export async function crearBarra(client: SupabaseClient, clubId: string, nombre: string): Promise<Ubicacion> {
  return crearUbicacion(client, clubId, nombre, "bar")
}

// El deposito es donde entra la mercaderia: el "stock del producto".
export async function crearDeposito(client: SupabaseClient, clubId: string, nombre: string): Promise<Ubicacion> {
  return crearUbicacion(client, clubId, nombre, "storage")
}

async function crearUbicacion(
  client: SupabaseClient,
  clubId: string,
  nombre: string,
  kind: Ubicacion["kind"],
): Promise<Ubicacion> {
  invalidarCache(client)
  return sinError<Ubicacion>(
    await client
      .from("inventory_locations")
      .insert({ club_id: clubId, name: nombre, kind, active: true })
      .select(COLUMNAS_UBICACION)
      .single(),
  )
}

const COLUMNAS_CAJA = "id, name, inventory_location_id, active"

export async function listarCajas(client: SupabaseClient, clubId: string): Promise<Caja[]> {
  return enCache(client, `cajas:${clubId}`, async () => {
    return sinError<Caja[]>(
      await client
        .from("cash_registers")
        .select(COLUMNAS_CAJA)
        .eq("club_id", clubId)
        .is("deleted_at", null)
        .order("name"),
    )
  })
}

export async function crearCaja(
  client: SupabaseClient,
  clubId: string,
  nombre: string,
  ubicacionId: string,
): Promise<Caja> {
  invalidarCache(client)
  return sinError<Caja>(
    await client
      .from("cash_registers")
      .insert({ club_id: clubId, name: nombre, inventory_location_id: ubicacionId, active: true })
      .select(COLUMNAS_CAJA)
      .single(),
  )
}

export async function listarPersonal(client: SupabaseClient, clubId: string): Promise<Persona[]> {
  return enCache(client, `personal:${clubId}`, async () => {
    return sinError<Persona[]>(
      await client
        .from("users")
        .select("id, full_name, role, active, username, email")
        .eq("club_id", clubId)
        .is("deleted_at", null)
        .order("full_name"),
    )
  })
}

// Ids del personal bloqueado por intentos de PIN (funcion del archivo 10:
// devuelve solo is_locked, nunca contadores ni horas).
export async function listarBloqueados(client: SupabaseClient, clubId: string): Promise<Set<string>> {
  const filas = sinError<{ user_id: string; is_locked: boolean }[]>(
    await client.rpc("club_staff_status", { p_club_id: clubId }),
  )
  return new Set(filas.filter((f) => f.is_locked).map((f) => f.user_id))
}

export class ErrorDeAlta extends Error {
  readonly errores: Record<string, string>
  constructor(mensaje: string, errores: Record<string, string> = {}) {
    super(mensaje)
    this.errores = errores
  }
}

// Alta de personal: SOLO por la Edge Function (el hash del PIN se calcula
// en el servidor). supabase-js agrega el JWT de la sesion.
export async function crearPersonal(
  client: SupabaseClient,
  clubId: string,
  pedido: PedidoPersonal,
): Promise<Persona> {
  invalidarCache(client)
  const { data, error } = await client.functions.invoke("admin-create-user", {
    body: { club_id: clubId, ...pedido },
  })
  if (!error) return data as Persona

  throw await errorDeEdgeFunction(error, "No se pudo crear el usuario.", "admin-create-user")
}

// Los errores HTTP de una Edge Function traen su respuesta en error.context.
// Nuestras funciones responden { error, errores }. Si no viene eso, el
// pedido no llego a la funcion: no esta desplegada (404 de Supabase) o no
// hubo conexion (red, CORS).
async function errorDeEdgeFunction(error: unknown, porDefecto: string, funcion: string): Promise<ErrorDeAlta> {
  let cuerpo: { error?: string; errores?: Record<string, string> } = {}
  const { name, context: contexto } = error as { name?: string; context?: unknown }
  if (contexto instanceof Response) {
    try {
      cuerpo = await contexto.json()
    } catch {
      cuerpo = {}
    }
    if (!cuerpo.error && contexto.status === 404) {
      return new ErrorDeAlta(`El servidor todavía no tiene la función ${funcion}. Falta desplegarla en Supabase.`, {})
    }
  } else if (name === "FunctionsFetchError" || name === "FunctionsRelayError") {
    return new ErrorDeAlta(
      `No se pudo conectar con la función ${funcion}. Revisá la conexión o que esté desplegada en Supabase.`,
      {},
    )
  }
  return new ErrorDeAlta(cuerpo.error ?? porDefecto, cuerpo.errores ?? {})
}

// Editar personal: SOLO por la Edge Function admin-update-user (el panel no
// tiene UPDATE sobre users). Nombre, rol (cajero <-> barra) y activo.
export type CambiosPersonal = { full_name?: string; role?: "cashier" | "bartender"; active?: boolean }

export async function editarPersonal(
  client: SupabaseClient,
  clubId: string,
  userId: string,
  cambios: CambiosPersonal,
): Promise<Persona> {
  invalidarCache(client)
  const { data, error } = await client.functions.invoke("admin-update-user", {
    body: { club_id: clubId, user_id: userId, ...cambios },
  })
  if (!error) return data as Persona
  throw await errorDeEdgeFunction(error, "No se pudo guardar el cambio.", "admin-update-user")
}

// ---------------------------------------------------------------------
// Asignacion de personal: cajero -> una caja; barra -> una barra (15).
// Una por persona. Quitar = borrar la fila (queda auditado).
// ---------------------------------------------------------------------
export type Asignacion = {
  id: string
  user_id: string
  cash_register_id: string | null
  location_id: string | null
}

const COLUMNAS_ASIGNACION = "id, user_id, cash_register_id, location_id"

export async function listarAsignaciones(client: SupabaseClient, clubId: string): Promise<Asignacion[]> {
  return enCache(client, `asignaciones:${clubId}`, async () => {
    return sinError<Asignacion[]>(
      await client.from("staff_assignments").select(COLUMNAS_ASIGNACION).eq("club_id", clubId),
    )
  })
}

// destino: el id de la caja (cajero) o de la barra (bartender).
export async function asignarPersonal(
  client: SupabaseClient,
  clubId: string,
  persona: { id: string; role: string },
  destinoId: string,
  existente: Asignacion | null,
): Promise<Asignacion> {
  invalidarCache(client)
  const destino =
    persona.role === "cashier"
      ? { cash_register_id: destinoId, location_id: null }
      : { cash_register_id: null, location_id: destinoId }
  if (existente) {
    return sinError<Asignacion>(
      await client
        .from("staff_assignments")
        .update(destino)
        .eq("id", existente.id)
        .select(COLUMNAS_ASIGNACION)
        .single(),
    )
  }
  return sinError<Asignacion>(
    await client
      .from("staff_assignments")
      .insert({ club_id: clubId, user_id: persona.id, ...destino })
      .select(COLUMNAS_ASIGNACION)
      .single(),
  )
}

export async function quitarAsignacion(client: SupabaseClient, asignacionId: string): Promise<void> {
  invalidarCache(client)
  const { error } = await client.from("staff_assignments").delete().eq("id", asignacionId)
  if (error) throw new Error(error.message)
}

// ---------------------------------------------------------------------
// Stock: saldos (los mantiene un trigger) y movimientos manuales
// ---------------------------------------------------------------------
export type Saldo = {
  location_id: string
  product_id: string
  quantity: number
}

export async function listarSaldos(client: SupabaseClient, clubId: string): Promise<Saldo[]> {
  return sinError<Saldo[]>(
    await client
      .from("inventory_balances")
      .select("location_id, product_id, quantity")
      .eq("club_id", clubId),
  )
}

// Una sola insercion: una transferencia (dos lineas) entra completa o no entra.
// Costo de compra nuevo (por ejemplo, el de la ultima factura). Solo el
// costo: no altera ventas pasadas (regla 7).
export async function actualizarCostoProducto(client: SupabaseClient, productoId: string, cost: string): Promise<Producto> {
  invalidarCache(client)
  return sinError<Producto>(
    await client.from("products").update({ cost }).eq("id", productoId).select(COLUMNAS_PRODUCTO).single(),
  )
}

export async function registrarMovimientos(
  client: SupabaseClient,
  clubId: string,
  filas: FilaMovimiento[],
): Promise<void> {
  invalidarCache(client)
  sinError(
    await client
      .from("inventory_movements")
      .insert(filas.map((f) => ({ club_id: clubId, ...f }))),
  )
}

// ---------------------------------------------------------------------
// Combos (archivo 17): un combo es un producto con kind = 'combo'. Su
// precio y su costo los calcula la base (suma de sus productos): el panel
// nunca los escribe; solo la composicion (combo_items).
// ---------------------------------------------------------------------
const COLUMNAS_COMBO_ITEM = "id, combo_id, product_id, quantity, unit_price"
export type ComboItem = ComboItemGuardado & { combo_id: string }

export async function listarComboItems(client: SupabaseClient, clubId: string): Promise<ComboItem[]> {
  return enCache(client, `combo_items:${clubId}`, async () => {
    return sinError<ComboItem[]>(await client.from("combo_items").select(COLUMNAS_COMBO_ITEM).eq("club_id", clubId))
  })
}

async function leerCombo(client: SupabaseClient, clubId: string, comboId: string) {
  const [combo, items] = await Promise.all([
    client.from("products").select(COLUMNAS_PRODUCTO).eq("id", comboId).single(),
    client.from("combo_items").select(COLUMNAS_COMBO_ITEM).eq("club_id", clubId).eq("combo_id", comboId),
  ])
  return { combo: sinError<Producto>(combo), items: sinError<ComboItem[]>(items) }
}

export class ErrorDeCombo extends Error {
  readonly comboCreado: Producto | null
  constructor(mensaje: string, comboCreado: Producto | null = null) {
    super(mensaje)
    this.comboCreado = comboCreado
  }
}

export async function crearCombo(
  client: SupabaseClient,
  clubId: string,
  valor: ValorCombo,
): Promise<{ combo: Producto; items: ComboItem[] }> {
  invalidarCache(client)
  const combo = sinError<Producto>(
    await client
      .from("products")
      .insert({
        club_id: clubId,
        kind: "combo",
        name: valor.name,
        sku: valor.sku,
        category_id: valor.category_id,
        price: "0",
        cost: "0",
        active: true,
      })
      .select(COLUMNAS_PRODUCTO)
      .single(),
  )
  const { error } = await client
    .from("combo_items")
    .insert(valor.items.map((i) => ({ club_id: clubId, combo_id: combo.id, ...i })))
  if (error) {
    throw new ErrorDeCombo("El combo se creó, pero no se guardaron sus productos. Abrilo con Editar y agregalos.", combo)
  }
  return leerCombo(client, clubId, combo.id)
}

// Nombre, SKU y categoria (nunca precio ni costo) y la composicion.
export async function actualizarCombo(
  client: SupabaseClient,
  clubId: string,
  comboId: string,
  valor: ValorCombo,
  plan: PlanComboItems,
): Promise<{ combo: Producto; items: ComboItem[] }> {
  invalidarCache(client)
  sinError(
    await client
      .from("products")
      .update({ name: valor.name, sku: valor.sku, category_id: valor.category_id })
      .eq("id", comboId),
  )
  if (plan.borrar.length > 0) sinError(await client.from("combo_items").delete().in("id", plan.borrar))
  for (const c of plan.actualizar) {
    sinError(
      await client.from("combo_items").update({ quantity: c.quantity, unit_price: c.unit_price }).eq("id", c.id),
    )
  }
  if (plan.insertar.length > 0) {
    sinError(
      await client
        .from("combo_items")
        .insert(plan.insertar.map((i) => ({ club_id: clubId, combo_id: comboId, ...i }))),
    )
  }
  return leerCombo(client, clubId, comboId)
}

// ---------------------------------------------------------------------
// Precio por barra (archivo 16): sin fila, la barra cobra el general.
// Cambiar = update del precio; quitar = borrar la fila. Queda auditado.
// ---------------------------------------------------------------------
const COLUMNAS_PRECIO_BARRA = "id, product_id, location_id, price"

export async function listarPreciosBarra(client: SupabaseClient, clubId: string): Promise<PrecioBarra[]> {
  return enCache(client, `precios_barra:${clubId}`, async () => {
    return sinError<PrecioBarra[]>(
      await client.from("product_location_prices").select(COLUMNAS_PRECIO_BARRA).eq("club_id", clubId),
    )
  })
}

// Devuelve los precios de barra del producto como quedaron.
export async function aplicarPreciosBarra(
  client: SupabaseClient,
  clubId: string,
  productoId: string,
  plan: PlanPreciosBarra,
): Promise<PrecioBarra[]> {
  invalidarCache(client)
  if (plan.borrar.length > 0) {
    sinError(await client.from("product_location_prices").delete().in("id", plan.borrar))
  }
  for (const cambio of plan.actualizar) {
    sinError(await client.from("product_location_prices").update({ price: cambio.price }).eq("id", cambio.id))
  }
  if (plan.insertar.length > 0) {
    sinError(
      await client
        .from("product_location_prices")
        .insert(plan.insertar.map((p) => ({ club_id: clubId, product_id: productoId, ...p }))),
    )
  }
  return sinError<PrecioBarra[]>(
    await client
      .from("product_location_prices")
      .select(COLUMNAS_PRECIO_BARRA)
      .eq("club_id", clubId)
      .eq("product_id", productoId),
  )
}

// ---------------------------------------------------------------------
// Impuestos (se activan y desactivan; no se borran)
// ---------------------------------------------------------------------
// Catalogo global, igual para todos los clubs: PIX, Transferencia y
// Efectivo. "Mixto" no es un metodo: es una venta con varios pagos.
// Los inactivos (Tarjeta, Otro) solo se muestran si un impuesto ya los usa.
export type MetodoPago = { code: string; label: string; active: boolean }

export type Impuesto = {
  id: string
  name: string
  kind: "percentage" | "fixed"
  percentage: Monto | null
  fixed_amount: Monto | null
  active: boolean
  metodos: string[]
}

export async function listarMetodosPago(client: SupabaseClient): Promise<MetodoPago[]> {
  return enCache(client, `metodos_pago`, async () => {
    return sinError<MetodoPago[]>(
      await client.from("payment_methods").select("code, label, active").order("sort_order"),
    )
  })
}

const COLUMNAS_IMPUESTO = "id, name, kind, percentage, fixed_amount, active"
type FilaImpuesto = Omit<Impuesto, "metodos">

export async function listarImpuestos(client: SupabaseClient, clubId: string): Promise<Impuesto[]> {
  return enCache(client, `impuestos:${clubId}`, async () => {
    const [impuestos, metodos] = await Promise.all([
      client.from("taxes").select(COLUMNAS_IMPUESTO).eq("club_id", clubId).order("name"),
      client.from("tax_payment_methods").select("tax_id, method").eq("club_id", clubId),
    ])
    const filas = sinError<FilaImpuesto[]>(impuestos)
    const relaciones = sinError<{ tax_id: string; method: string }[]>(metodos)
    return filas.map((t) => ({
      ...t,
      metodos: relaciones.filter((r) => r.tax_id === t.id).map((r) => r.method),
    }))
  })
}

export async function crearImpuesto(
  client: SupabaseClient,
  clubId: string,
  valor: ValorImpuesto,
): Promise<Impuesto> {
  invalidarCache(client)
  const fila = sinError<FilaImpuesto>(
    await client
      .from("taxes")
      .insert({
        club_id: clubId,
        name: valor.name,
        kind: valor.kind,
        percentage: valor.percentage,
        fixed_amount: valor.fixed_amount,
        active: true,
      })
      .select(COLUMNAS_IMPUESTO)
      .single(),
  )
  sinError(
    await client
      .from("tax_payment_methods")
      .insert(valor.metodos.map((method) => ({ club_id: clubId, tax_id: fila.id, method }))),
  )
  return { ...fila, metodos: valor.metodos }
}

export async function actualizarImpuesto(
  client: SupabaseClient,
  clubId: string,
  anterior: Impuesto,
  valor: ValorImpuesto,
): Promise<Impuesto> {
  invalidarCache(client)
  const fila = sinError<FilaImpuesto>(
    await client
      .from("taxes")
      .update({
        name: valor.name,
        kind: valor.kind,
        percentage: valor.percentage,
        fixed_amount: valor.fixed_amount,
      })
      .eq("id", anterior.id)
      .select(COLUMNAS_IMPUESTO)
      .single(),
  )
  const agregar = valor.metodos.filter((m) => !anterior.metodos.includes(m))
  const quitar = anterior.metodos.filter((m) => !valor.metodos.includes(m))
  if (agregar.length > 0) {
    sinError(
      await client
        .from("tax_payment_methods")
        .insert(agregar.map((method) => ({ club_id: clubId, tax_id: anterior.id, method }))),
    )
  }
  if (quitar.length > 0) {
    sinError(
      await client.from("tax_payment_methods").delete().eq("tax_id", anterior.id).in("method", quitar),
    )
  }
  return { ...fila, metodos: valor.metodos }
}

export async function cambiarActivoImpuesto(
  client: SupabaseClient,
  id: string,
  active: boolean,
): Promise<void> {
  invalidarCache(client)
  sinError(await client.from("taxes").update({ active }).eq("id", id))
}

// ---------------------------------------------------------------------
// Categorias de producto (por club; "Vaso" la crea la base en cada club)
// ---------------------------------------------------------------------
export type Categoria = { id: string; name: string; sort_order: number; active: boolean }

const COLUMNAS_CATEGORIA = "id, name, sort_order, active"

export async function listarCategorias(client: SupabaseClient, clubId: string): Promise<Categoria[]> {
  return enCache(client, `categorias:${clubId}`, async () => {
    return sinError<Categoria[]>(
      await client
        .from("product_categories")
        .select(COLUMNAS_CATEGORIA)
        .eq("club_id", clubId)
        .is("deleted_at", null)
        .order("sort_order")
        .order("name"),
    )
  })
}

export async function crearCategoria(client: SupabaseClient, clubId: string, nombre: string): Promise<Categoria> {
  invalidarCache(client)
  return sinError<Categoria>(
    await client
      .from("product_categories")
      .insert({ club_id: clubId, name: nombre, sort_order: 10, active: true })
      .select(COLUMNAS_CATEGORIA)
      .single(),
  )
}

export async function cambiarActivaCategoria(client: SupabaseClient, id: string, active: boolean): Promise<void> {
  invalidarCache(client)
  sinError(await client.from("product_categories").update({ active }).eq("id", id))
}

// ---------------------------------------------------------------------
// Noche: iniciar (con el cambio de cada caja) y parar
// ---------------------------------------------------------------------
export type Noche = { id: string; started_at: string; ended_at: string | null }

const COLUMNAS_NOCHE = "id, started_at, ended_at"

export async function obtenerNocheAbierta(client: SupabaseClient, clubId: string): Promise<Noche | null> {
  return sinError<Noche | null>(
    await client
      .from("club_nights")
      .select(COLUMNAS_NOCHE)
      .eq("club_id", clubId)
      .is("ended_at", null)
      .maybeSingle(),
  )
}

export async function listarNoches(client: SupabaseClient, clubId: string): Promise<Noche[]> {
  return sinError<Noche[]>(
    await client
      .from("club_nights")
      .select(COLUMNAS_NOCHE)
      .eq("club_id", clubId)
      .order("started_at", { ascending: false })
      .limit(60),
  )
}

export class ErrorDeNoche extends Error {
  readonly noche: Noche | null
  constructor(mensaje: string, noche: Noche | null = null) {
    super(mensaje)
    this.noche = noche
  }
}

// La hora y el autor los pone la base. El cambio inicial va en UNA
// insercion; si falla, la noche ya quedo iniciada y se avisa para cargarlo
// como refuerzo.
export async function iniciarNoche(
  client: SupabaseClient,
  clubId: string,
  cambios: { cajaId: string; monto: string }[],
): Promise<Noche> {
  invalidarCache(client)
  const respuesta = await client.from("club_nights").insert({ club_id: clubId }).select(COLUMNAS_NOCHE).single()
  if (respuesta.error) {
    throw new ErrorDeNoche(
      respuesta.error.message.includes("uq_club_nights_one_open")
        ? "Ya hay una noche en curso en este club."
        : "No se pudo iniciar la noche.",
    )
  }
  const noche = respuesta.data as Noche
  const filas = cambios
    .filter((c) => Number(c.monto) > 0)
    .map((c) => ({ club_id: clubId, night_id: noche.id, cash_register_id: c.cajaId, kind: "opening", amount: c.monto }))
  if (filas.length > 0) {
    const { error } = await client.from("cash_register_floats").insert(filas)
    if (error) {
      throw new ErrorDeNoche(
        'La noche se inició, pero no se guardó el cambio. Cargalo desde Ventas con "Agregar cambio".',
        noche,
      )
    }
  }
  return noche
}

export async function pararNoche(client: SupabaseClient, nocheId: string): Promise<Noche> {
  invalidarCache(client)
  return sinError<Noche>(
    await client
      .from("club_nights")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", nocheId)
      .select(COLUMNAS_NOCHE)
      .single(),
  )
}

export async function agregarCambio(
  client: SupabaseClient,
  clubId: string,
  nocheId: string,
  cajaId: string,
  monto: string,
  nota: string | null,
): Promise<void> {
  invalidarCache(client)
  sinError(
    await client.from("cash_register_floats").insert({
      club_id: clubId,
      night_id: nocheId,
      cash_register_id: cajaId,
      kind: "top_up",
      amount: monto,
      note: nota,
    }),
  )
}

// ---------------------------------------------------------------------
// Inicio y cierre de la noche: fotos del stock (las toma la base al iniciar
// y al parar) y recargas de barra (transfer_in) con quien las hizo.
// ---------------------------------------------------------------------
export type FotoStock = {
  location_id: string
  product_id: string
  kind: "opening" | "closing"
  quantity: number
}

export async function fotosDeNoche(client: SupabaseClient, nocheId: string): Promise<FotoStock[]> {
  return sinError<FotoStock[]>(
    await client
      .from("night_stock_snapshots")
      .select("location_id, product_id, kind, quantity")
      .eq("night_id", nocheId),
  )
}

export type Recarga = {
  id: string
  location_id: string
  product_id: string
  quantity: number
  occurred_at: string
  note: string | null
  actor_type: "platform_admin" | "user" | null
  actor_id: string | null
}

// Las entradas a una ubicacion por transferencia entre el inicio y el fin
// de la noche (o ahora, si sigue en curso).
export async function recargasDeNoche(client: SupabaseClient, clubId: string, noche: Noche): Promise<Recarga[]> {
  let consulta = client
    .from("inventory_movements")
    .select("id, location_id, product_id, quantity, occurred_at, note, actor_type, actor_id")
    .eq("club_id", clubId)
    .eq("movement_type", "transfer_in")
    .gte("occurred_at", noche.started_at)
  if (noche.ended_at) consulta = consulta.lte("occurred_at", noche.ended_at)
  return sinError<Recarga[]>(await consulta.order("occurred_at"))
}

// ---------------------------------------------------------------------
// Ventas (vista v_sales_list) y su resumen por caja
// ---------------------------------------------------------------------
export type Venta = {
  id: string
  night_id: string | null
  ticket_number: string
  total: Monto
  status: "pending" | "delivered"
  created_at_device: string
  delivered_at: string | null
  cash_register_id: string
  cash_register_name: string
  cashier_user_id: string
  cashier_name: string
  delivered_by_name: string | null
  payment_methods: string[]
  is_mixed: boolean
  cash_amount: Monto
  pix_amount: Monto
  transfer_amount: Monto
  outside_night: boolean
}

// Una sola cadena literal: supabase-js deduce el tipo de la respuesta.
const COLUMNAS_VENTA =
  "id, night_id, ticket_number, total, status, created_at_device, delivered_at, cash_register_id, cash_register_name, cashier_user_id, cashier_name, delivered_by_name, payment_methods, is_mixed, cash_amount, pix_amount, transfer_amount, outside_night"

export type FiltrosVentas = {
  nocheId: string // "" = todas
  desde: string // "AAAA-MM-DD" o ""
  hasta: string
  metodo: string // "", "mixto" o el codigo del metodo
  cajeroId: string
  cajaId: string
  estado: "" | "pending" | "delivered"
}

export const FILTROS_VACIOS: FiltrosVentas = {
  nocheId: "",
  desde: "",
  hasta: "",
  metodo: "",
  cajeroId: "",
  cajaId: "",
  estado: "",
}

export const LIMITE_VENTAS = 300

// Dia siguiente a "AAAA-MM-DD" (el filtro "hasta" incluye todo ese dia).
export function diaSiguiente(fecha: string): string {
  const [a, m, d] = fecha.split("-").map(Number)
  return new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10)
}

export async function listarVentas(
  client: SupabaseClient,
  clubId: string,
  filtros: FiltrosVentas,
): Promise<Venta[]> {
  let consulta = client.from("v_sales_list").select(COLUMNAS_VENTA).eq("club_id", clubId)
  if (filtros.nocheId) consulta = consulta.eq("night_id", filtros.nocheId)
  if (filtros.desde) consulta = consulta.gte("created_at_device", filtros.desde)
  if (filtros.hasta) consulta = consulta.lt("created_at_device", diaSiguiente(filtros.hasta))
  if (filtros.metodo === "mixto") consulta = consulta.eq("is_mixed", true)
  else if (filtros.metodo) consulta = consulta.contains("payment_methods", [filtros.metodo])
  if (filtros.cajeroId) consulta = consulta.eq("cashier_user_id", filtros.cajeroId)
  if (filtros.cajaId) consulta = consulta.eq("cash_register_id", filtros.cajaId)
  if (filtros.estado) consulta = consulta.eq("status", filtros.estado)
  return sinError<Venta[]>(await consulta.order("created_at_device", { ascending: false }).limit(LIMITE_VENTAS))
}

export type ResumenCaja = {
  cash_register_id: string
  cash_register_name: string
  opening_float: Monto
  added_float: Monto
  float_total: Monto
  tickets: number
  sales_total: Monto
  cash_sales: Monto
  pix_sales: Monto
  transfer_sales: Monto
  expected_cash: Monto
}

export async function resumenDeNoche(client: SupabaseClient, nocheId: string): Promise<ResumenCaja[]> {
  return sinError<ResumenCaja[]>(
    await client
      .from("v_night_register_summary")
      .select(
        "cash_register_id, cash_register_name, opening_float, added_float, float_total, tickets, sales_total, cash_sales, pix_sales, transfer_sales, expected_cash",
      )
      .eq("night_id", nocheId)
      .order("cash_register_name"),
  )
}

export type DetalleVenta = {
  items: { id: string; product_name: string; quantity: number; unit_price: Monto; line_total: Monto }[]
  pagos: { method: string; amount: Monto }[]
  sustituciones: { sale_item_id: string; quantity: number; substitute_product_name: string }[]
}

export async function detalleDeVenta(client: SupabaseClient, ventaId: string): Promise<DetalleVenta> {
  const [items, pagos, sustituciones] = await Promise.all([
    client.from("sale_items").select("id, product_name, quantity, unit_price, line_total").eq("sale_id", ventaId),
    client.from("sale_payments").select("method, amount").eq("sale_id", ventaId),
    client.from("sale_item_substitutions").select("sale_item_id, quantity, substitute_product_name").eq("sale_id", ventaId),
  ])
  return {
    items: sinError<DetalleVenta["items"]>(items),
    pagos: sinError<DetalleVenta["pagos"]>(pagos),
    sustituciones: sinError<DetalleVenta["sustituciones"]>(sustituciones),
  }
}

// Tiempo real (Supabase Realtime respeta RLS): cualquier venta, pago, retiro
// o cambio de noche del club avisa, y la pantalla vuelve a leer.
export function suscribirCambios(
  client: SupabaseClient,
  clubId: string,
  tablas: string[],
  onCambio: () => void,
  onEstado?: (enVivo: boolean) => void,
): () => void {
  const canal = client.channel(`club-${clubId}-${tablas.join("-")}`)
  for (const tabla of tablas) {
    canal.on(
      "postgres_changes" as never,
      { event: "*", schema: "public", table: tabla, filter: `club_id=eq.${clubId}` } as never,
      () => onCambio(),
    )
  }
  canal.subscribe((estado: string) => onEstado?.(estado === "SUBSCRIBED"))
  return () => {
    void client.removeChannel(canal)
  }
}

// ---------------------------------------------------------------------
// Promociones (archivo 18). Sobre un producto; se activan y desactivan,
// no se borran. Las condiciones (producto, tipo y valores) no cambian
// despues de crearla: la base no deja. Barras: sin filas = todas.
// ---------------------------------------------------------------------
export type Promocion = CondicionesPromocion &
  VigenciaPromocion & {
    id: string
    product_id: string
    name: string
    active: boolean
    barras: string[]
  }

export type EstadoPromocion = {
  promotion_id: string
  in_schedule_now: boolean
  applies_now: boolean
  expired: boolean
}

const COLUMNAS_PROMOCION =
  "id, product_id, name, kind, percentage, fixed_amount, buy_quantity, pay_quantity, starts_on, ends_on, weekdays, start_time, end_time, active"

type FilaPromocion = Omit<Promocion, "barras">

export async function listarPromociones(client: SupabaseClient, clubId: string): Promise<Promocion[]> {
  return enCache(client, `promociones:${clubId}`, async () => {
    const [filas, barras] = await Promise.all([
      client.from("promotions").select(COLUMNAS_PROMOCION).eq("club_id", clubId).order("name"),
      client.from("promotion_locations").select("id, promotion_id, location_id").eq("club_id", clubId),
    ])
    const deBarras = sinError<{ promotion_id: string; location_id: string }[]>(barras)
    return sinError<FilaPromocion[]>(filas).map((p) => ({
      ...p,
      barras: deBarras.filter((b) => b.promotion_id === p.id).map((b) => b.location_id),
    }))
  })
}

export async function listarEstadoPromociones(client: SupabaseClient, clubId: string): Promise<EstadoPromocion[]> {
  return sinError<EstadoPromocion[]>(
    await client
      .from("v_promotions_status")
      .select("promotion_id, in_schedule_now, applies_now, expired")
      .eq("club_id", clubId),
  )
}

export class ErrorDePromocion extends Error {
  readonly promocionGuardada: Promocion | null
  constructor(message: string, promocionGuardada: Promocion | null) {
    super(message)
    this.promocionGuardada = promocionGuardada
  }
}

async function guardarBarras(
  client: SupabaseClient,
  clubId: string,
  promocionId: string,
  antes: string[],
  despues: string[],
) {
  // Primero agregar y despues quitar: si algo falla a mitad de camino, la
  // promocion nunca queda sin barras (sin barras vale en TODAS).
  const quitar = antes.filter((b) => !despues.includes(b))
  const agregar = despues.filter((b) => !antes.includes(b))
  if (agregar.length > 0) {
    sinError(
      await client
        .from("promotion_locations")
        .insert(agregar.map((location_id) => ({ club_id: clubId, promotion_id: promocionId, location_id }))),
    )
  }
  if (quitar.length > 0) {
    sinError(
      await client.from("promotion_locations").delete().eq("promotion_id", promocionId).in("location_id", quitar),
    )
  }
}

export async function crearPromocion(client: SupabaseClient, clubId: string, valor: ValorPromocion): Promise<Promocion> {
  invalidarCache(client)
  const fila = sinError<FilaPromocion>(
    await client
      .from("promotions")
      .insert({
        club_id: clubId,
        product_id: valor.product_id,
        name: valor.name,
        kind: valor.kind,
        percentage: valor.percentage,
        fixed_amount: valor.fixed_amount,
        buy_quantity: valor.buy_quantity,
        pay_quantity: valor.pay_quantity,
        starts_on: valor.starts_on,
        ends_on: valor.ends_on,
        weekdays: valor.weekdays,
        start_time: valor.start_time,
        end_time: valor.end_time,
        active: true,
      })
      .select(COLUMNAS_PROMOCION)
      .single(),
  )
  try {
    await guardarBarras(client, clubId, fila.id, [], valor.barras)
  } catch {
    // Sin barras guardadas la promocion valdria en TODAS: se deja inactiva.
    const inactiva = sinError<FilaPromocion>(
      await client.from("promotions").update({ active: false }).eq("id", fila.id).select(COLUMNAS_PROMOCION).single(),
    )
    throw new ErrorDePromocion(
      "La promoción se creó inactiva porque no se guardaron sus barras. Editala y volvé a elegirlas.",
      { ...inactiva, barras: [] },
    )
  }
  return { ...fila, barras: valor.barras }
}

// Solo nombre, vigencia y barras: las condiciones no cambian.
export async function actualizarPromocion(
  client: SupabaseClient,
  anterior: Promocion,
  clubId: string,
  valor: ValorPromocion,
): Promise<Promocion> {
  invalidarCache(client)
  const fila = sinError<FilaPromocion>(
    await client
      .from("promotions")
      .update({
        name: valor.name,
        starts_on: valor.starts_on,
        ends_on: valor.ends_on,
        weekdays: valor.weekdays,
        start_time: valor.start_time,
        end_time: valor.end_time,
      })
      .eq("id", anterior.id)
      .select(COLUMNAS_PROMOCION)
      .single(),
  )
  try {
    await guardarBarras(client, clubId, anterior.id, anterior.barras, valor.barras)
  } catch {
    throw new ErrorDePromocion("Se guardaron los datos, pero no las barras. Intentá de nuevo.", {
      ...fila,
      barras: anterior.barras,
    })
  }
  return { ...fila, barras: valor.barras }
}

export async function cambiarActivoPromocion(client: SupabaseClient, id: string, active: boolean): Promise<void> {
  invalidarCache(client)
  sinError(await client.from("promotions").update({ active }).eq("id", id))
}

// ---------------------------------------------------------------------
// Historial de cambios (archivo 19). No se guarda en cache: cambia con
// cada cosa que hace el panel. Las fechas son del calendario en la zona
// horaria del club.
// ---------------------------------------------------------------------
export const LIMITE_HISTORIAL = 500

export async function listarActividad(
  client: SupabaseClient,
  clubId: string,
  desde: string,
  hasta: string,
): Promise<Actividad[]> {
  return sinError<Actividad[]>(
    await client.rpc("club_activity", { p_club_id: clubId, p_from: desde, p_to: hasta, p_limit: LIMITE_HISTORIAL }),
  )
}

export async function contarActividadPorDia(
  client: SupabaseClient,
  clubId: string,
  desde: string,
  hasta: string,
): Promise<Map<string, number>> {
  const filas = sinError<{ day: string; changes: number | string }[]>(
    await client.rpc("club_activity_by_day", { p_club_id: clubId, p_from: desde, p_to: hasta }),
  )
  return new Map(filas.map((f) => [f.day, Number(f.changes)]))
}

// Nombre del administrador del club: el encargado no puede leer
// platform_admins, la base le da solo el nombre (nunca email ni telefono).
export async function nombresAdministradores(client: SupabaseClient, clubId: string): Promise<Map<string, string>> {
  const filas = await enCache(client, `administradores:${clubId}`, async () => {
    return sinError<{ admin_id: string; full_name: string }[]>(
      await client.rpc("club_admin_names", { p_club_id: clubId }),
    )
  })
  return new Map(filas.map((f) => [f.admin_id, f.full_name]))
}

// ---------------------------------------------------------------------
// Mi perfil (administrador de plataforma): nombre, apellido y telefono.
// El email es el de la cuenta de Google/Supabase y no se cambia aca.
// ---------------------------------------------------------------------
export type Perfil = {
  id: string
  email: string
  full_name: string
  first_name: string | null
  last_name: string | null
  phone: string | null
}

const COLUMNAS_PERFIL = "id, email, full_name, first_name, last_name, phone"

export async function obtenerMiPerfil(client: SupabaseClient, authUserId: string): Promise<Perfil | null> {
  return sinError<Perfil | null>(
    await client
      .from("platform_admins")
      .select(COLUMNAS_PERFIL)
      .eq("auth_user_id", authUserId)
      .is("deleted_at", null)
      .maybeSingle(),
  )
}

export type DatosPerfil = { first_name: string; last_name: string | null; phone: string | null }

export async function actualizarMiPerfil(client: SupabaseClient, id: string, datos: DatosPerfil): Promise<Perfil> {
  invalidarCache(client)
  return sinError<Perfil>(
    await client.from("platform_admins").update(datos).eq("id", id).select(COLUMNAS_PERFIL).single(),
  )
}

// ---------------------------------------------------------------------
// Configuracion del club (archivo 20): por ahora, su paleta de colores.
// La fila la crea la base; el panel solo cambia la paleta. Si todavia no
// llego (o el valor es desconocido), se usa la de Onticket.
// ---------------------------------------------------------------------
export async function obtenerPaleta(client: SupabaseClient, clubId: string): Promise<CodigoPaleta> {
  const fila = await enCache(client, `configuracion:${clubId}`, async () => {
    return sinError<{ palette: string } | null>(
      await client.from("club_settings").select("palette").eq("club_id", clubId).maybeSingle(),
    )
  })
  return esPaleta(fila?.palette) ? fila.palette : PALETA_POR_DEFECTO
}

export async function guardarPaleta(client: SupabaseClient, clubId: string, paleta: CodigoPaleta): Promise<void> {
  invalidarCache(client)
  const filas = sinError<{ palette: string }[]>(
    await client.from("club_settings").update({ palette: paleta }).eq("club_id", clubId).select("palette"),
  )
  // Sin fila (o sin permiso, RLS): no se guardo nada.
  if (!filas || filas.length === 0) throw new Error("No se pudo guardar la paleta.")
}
