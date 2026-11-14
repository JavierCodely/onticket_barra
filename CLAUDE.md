# Onticket: reglas, arquitectura y plan de trabajo

Este archivo es la fuente de verdad del proyecto. **Leelo completo antes de tocar código.** Si un pedido contradice una regla de acá, frená y preguntá antes de seguir.

## 1. Qué es Onticket

Sistema de gestión de **barra, stock y caja** para clubes nocturnos. Es multi-club: una sola plataforma administra varios clubs y los datos de cada uno nunca se mezclan.

- **No incluye venta de entradas.** Solo consumos en barra.
- El cajero vende en un **posnet Android** e imprime un ticket con **QR**. La barra escanea el QR para registrar el retiro.
- Tiene que **seguir funcionando sin internet** (vender, imprimir, retirar) y sincronizar al reconectar.
- Un **administrador** crea clubs y gestiona los que creó. Cada club tiene sus usuarios (personal), productos, combos, promociones, impuestos, **cajas**, **barras** y estadísticas.

## 2. Arquitectura

```
Posnet (Kotlin + SDK oficial de PowerSync + SQLite local)
        ⇅  Sync Streams (baja)        ⇅  Edge Function pos-upload (sube)
PowerSync Service  ⇄  Supabase: Postgres + RLS + Edge Functions
                                   ↑
                 Panel web (React + Vite + TypeScript + shadcn/ui)
```

| Pieza | Tecnología | Rol de base de datos |
|---|---|---|
| Panel web | `@supabase/supabase-js` con la **clave publicable** y sesión de Supabase Auth | `authenticated` (filtrado por RLS) |
| Edge Functions | Deno/TypeScript con la **clave secreta** | `service_role` (saltea RLS: valida en su código) |
| Sincronización | PowerSync, replicación lógica | `powersync_role` (solo lectura) |
| Posnet | SDK oficial de PowerSync para Kotlin (1.7 como mínimo para Sync Streams; usar 1.9 o superior). **Sin puentes propios para SQLite** | No toca Postgres directo |

No existe servidor local por club ni Spring Boot: esa arquitectura se descartó. No la reintroduzcas.

### Estructura del repositorio

```
CLAUDE.md                este archivo
.claude/agents/          agentes (sección 9)
supabase/sql/            esquema, en archivos numerados (sección 6)
supabase/tests/          pruebas SQL: run.sh, mutaciones.sh, *.test.sql
supabase/functions/      Edge Functions            (por construir)
powersync/               Sync Streams y esquema del cliente  (por construir)
admin/                   panel web React           (por construir)
app-pos/                 app Android en Kotlin     (por construir)
```

## 3. Roles

| Rol | Cómo entra | Qué hace |
|---|---|---|
| Administrador (`platform_admins`) | Panel web, Supabase Auth | Crea clubs. En **los clubs que creó**: todo lo de un `club_admin`, más editar los datos del club |
| `club_admin` | Panel web, Supabase Auth | Productos, precios, impuestos, cajas, ubicaciones, stock y reportes de **su** club |
| `cashier` | Posnet, usuario + PIN | Vende y cobra |
| `bartender` | Posnet, usuario + PIN | Escanea el QR, registra el retiro, sustituye productos |

- Un usuario pertenece a **un solo club**.
- El posnet **no usa Supabase Auth**. La Edge Function `pos-login` verifica el PIN y firma un JWT propio (claims `club_id`, `user_id`, `role`; vence en 1 hora o menos) que PowerSync valida por JWKS.
- El PIN se guarda solo como hash (bcrypt o argon2). Tras 5 fallos seguidos, bloqueo temporal.
- Crear usuarios, asignar roles y cambiar PIN se hace **solo por Edge Function** (el hash se calcula en el servidor).
- No hay registro de aparatos: quien tenga la app, usuario y PIN puede entrar. Mitigación acordada: wifi de operación protegido, bloqueo por intentos y auditoría.

## 4. Reglas de oro

### Aislamiento y seguridad
1. Todo dato operativo lleva `club_id`, con **claves foráneas compuestas** `(x_id, club_id)` hacia `UNIQUE (id, club_id)`. La base impide mezclar clubs aunque el código falle.
2. Dos candados obligatorios en cada tabla: **GRANT** (qué operaciones y columnas) y **RLS** (qué filas). `anon` no tiene nada. **Única excepción:** las fotos de productos (bucket `product-images`, archivo `14`) se ven por su URL pública sin sesión, porque el posnet las baja sin Supabase Auth para usarlas sin conexión; `anon` no puede listarlas ni subirlas, y una foto no es un dato del club.
3. Ocultar un botón no es seguridad. Toda regla vive en la base o en una Edge Function.
4. Nunca se guarda, se loguea ni se sube al repositorio un PIN, un token o una clave.
5. Una fila nunca cambia de club.

### Dinero e historia
6. Dinero: `numeric(12,2)` en Postgres. Llega al posnet como **texto**: usar `BigDecimal`, nunca `Double`.
7. Cambiar un precio, un costo o un impuesto **no altera ventas pasadas**: cada venta guarda su foto.
8. Libros de **solo agregar** (sin UPDATE ni DELETE): `sale_items`, `sale_payments`, `sale_status_events`, `sale_item_substitutions`, `sale_item_taxes`, `inventory_movements`, `audit_log`. Se corrige agregando un registro.
9. Una venta no se borra, y de ella solo cambia el retiro (`pending` → `delivered`).

### Stock
10. **Nadie escribe el número de stock.** Cada entrada o salida es una línea del libro; el saldo es la suma y lo mantiene un trigger.
11. El stock **puede quedar negativo**: dos cajas sin conexión pueden vender la última unidad. La venta ya ocurrió y no se rechaza: se abre una alerta que se cierra sola cuando el saldo vuelve a cero o más.
12. Cada caja vende desde una ubicación de stock. Una heladera por barra reduce los conflictos.

### Sin conexión
13. Los UUID de lo que crea el posnet **se generan en el posnet**: son la clave de idempotencia (`INSERT ... ON CONFLICT (id) DO NOTHING`).
14. El posnet **solo inserta**. Nunca modifica ni borra ventas, pagos, retiros, sustituciones o impuestos.
15. `pos-upload` **nunca responde 4xx por un problema de negocio**: eso traba la cola del posnet. Registra en `sync_errors`, responde 2xx y un encargado lo revisa.
16. Tickets numerados por caja (`C2-000123`), nunca un correlativo global. El número es una etiqueta para personas y **no es único en la base**: la identidad de la venta es su UUID. Si dos posnets repiten un número, la venta no se rechaza y aparece en `v_ticket_number_conflicts`.
17. El QR lleva el **contenido** de la venta y va **firmado** (HMAC con clave del club): la barra puede estar sin conexión y no debe aceptar tickets falsos.
18. Si dos barras escanean el mismo ticket, vale el primer retiro en llegar; el resto queda `is_duplicate`.
19. El reloj del posnet no es confiable: se guarda su hora y también la del servidor (`received_at`).

### Sustitución en barra
20. Si falta un producto, la barra entrega otro (en un combo, se indica cuál de sus productos). `sale_items` conserva **lo vendido**; `sale_item_substitutions` registra **lo entregado**. Ingreso = lo cobrado; costo = el del producto entregado; la diferencia de precio de lista es un **descuento que absorbe el club** (no se le cobra al cliente). El stock devuelve el producto vendido a la ubicación donde se había descontado y descuenta el entregado en la barra que lo entrega.

### Impuestos
21. Cada club define los suyos: nombre, porcentaje **o** monto fijo **por unidad**, y los métodos de pago que los disparan.
22. Están **incluidos en el precio**: se descuentan de lo que el club se queda. Margen neto = precio − impuestos − costo.
23. Pago mixto: proporcional a la parte del ticket pagada con los métodos del impuesto. Fórmulas en `02_catalogo_cajas_impuestos.sql`, sección E.
23 bis. **Métodos de pago iguales en todos los clubs:** PIX, Transferencia y Efectivo (`payment_methods`, catálogo global; `11_metodos_de_pago.sql`). **Mixto no es un método**: es una venta con varias filas de `sale_payments` (por ejemplo, parte PIX y parte efectivo), para que la regla 23 sepa qué parte se pagó con qué. Tarjeta y Otro quedan **inactivos** (no se borran, por la historia): no se ofrecen en el panel ni en el posnet, la vista previa no los muestra y un impuesto no puede sumarlos. `pos-upload` no rechaza una venta con un método inactivo (regla 15).
24. Se **activan y desactivan; no se borran**. Desactivar no toca ventas anteriores; las nuevas ya no lo aplican.
25. El posnet calcula y guarda la foto del impuesto. El servidor no bloquea: `v_sale_tax_issues` lista lo que no coincide.

### Reportes
26. Las estadísticas son **siempre por club**. El administrador ve las de cada club suyo; un total de todos sus clubs se arma sumando esas filas. Comprar estadísticas de clubs ajenos es **futuro** y requerirá su propio diseño con consentimiento: no agregar consultas que crucen clubs.
27. La **jornada** de un club empieza a `business_day_start_hour` (12 por defecto): la venta de las 03:00 del sábado pertenece al viernes.

### Diseño responsive
28. Toda pantalla se adapta al ancho disponible: el panel web va desde teléfono (375 px) hasta escritorio, y la app del posnet funciona en teléfono y tableta, en vertical y horizontal. **Sin scroll horizontal** ni controles que se salgan de la pantalla. En pantallas chicas se reorganiza el diseño, pero **ninguna función desaparece**: lo que se oculta detrás de un menú o un panel sigue disponible. El diseño responsive no es seguridad (regla 3).

### Noche y cambio en efectivo
29. **La noche se inicia y se para** con el botón maestro del panel (`club_nights`; archivo `12_noches_y_cambio.sql`). Hay **una sola noche abierta por club**. Sin noche abierta **el posnet no vende**: lo comprueba él mismo con la noche que le llega por PowerSync, y manda `night_id` en cada venta.
30. **Al iniciar**, la base toma sola la **foto del stock** de cada ubicación (`night_stock_snapshots`, `opening`) y cada caja arranca con su **cambio en efectivo**, cargado a mano y distinto por caja (`cash_register_floats`, `opening`). Durante la noche se pueden sumar **refuerzos** (`top_up`) y **correcciones** (`correction`, pueden ser negativas). Es un libro de solo agregar, y no se carga cambio con la noche cerrada.
31. **Al parar**, la base toma la foto final del stock (`closing`), cierra todos los turnos de caja abiertos y audita. Una noche cerrada **no se reabre**: se inicia otra. El arqueo (contar la plata) es **futuro**.
32. **Efectivo en caja = ventas en efectivo + cambio dado** (`v_night_register_summary.expected_cash`). Así se muestra en el resumen de Ventas.
33. Una venta sin noche o hecha después de parar (un posnet sin conexión) **no se rechaza** (regla 15): se acepta y queda marcada en `v_sales_outside_night` (`outside_night` en `v_sales_list`).

### Promociones (archivo `18_promociones.sql`)
34. Una promoción es sobre **un producto** (no un combo ni una categoría) y **baja el precio cobrado**: `sale_items` guarda el precio de lista (`unit_price`), el descuento (`discount_amount`) y la foto de la promoción (`promotion_id`, `promotion_name`); `line_total = quantity × unit_price − discount_amount`. Los impuestos se calculan sobre lo cobrado y el margen baja. Tipos: porcentaje, monto fijo **por unidad** (con tope en el precio) y NxM (2x1, 3x2). El descuento se calcula sobre el precio que cobra la caja (el de su barra si tiene uno, archivo 16).
35. **Vigencia:** fechas desde/hasta y días de la semana **de la jornada** (regla 27: "viernes de 00:00 a 01:30" es la madrugada del sábado), franja horaria local que puede cruzar la medianoche (fin excluido) e interruptor `active`. **Barras:** sin barras elegidas vale en todas. La regla vive en `private.promotion_in_schedule`; el posnet la repite sin conexión y, si hay varias vigentes para el mismo producto, aplica la de **mayor descuento**.
36. El servidor **no bloquea** una venta por su promoción (regla 15): `v_sale_promotion_issues` lista descuentos que no coinciden con el recálculo o con un producto equivocado. La vigencia no se controla en el servidor (reloj del posnet, regla 19). Las **condiciones** (producto, tipo y valores) no cambian después de crearla: para otro descuento se crea otra. Se activan y desactivan; no se borran.

## 4 bis. Alcance del panel en esta etapa

**Menú lateral, sin club seleccionado** (pantalla de inicio del administrador):

| Opción | Estado | Qué hace |
|---|---|---|
| Dashboard | En desarrollo | Pantalla con el aviso "En desarrollo". Sin datos |
| Clubs | Activa | Lista de clubs. El administrador crea clubs (nombre, slug, zona horaria, `business_day_start_hour`) |
| Logs | En desarrollo | Pantalla con el aviso "En desarrollo". Sin datos |

**Menú lateral al seleccionar un club** (todo filtrado por `club_id`), en este orden:

| Opción | Estado | Qué hace |
|---|---|---|
| Dashboard | En desarrollo | Pantalla con el aviso "En desarrollo". Sin datos |
| Ventas | Activa | Ventas **en tiempo real** (Supabase Realtime sobre `sales`, `sale_payments` y `cash_register_floats`; lee `v_sales_list`): cajero/a, método (Mixto muestra sus métodos), monto, estado Pendiente/Retirado y marca "Fuera de noche". Filtros: noche, desde/hasta, método (incluye Mixto), cajero/a, caja, estado. Al tocar una venta: productos, cantidades, sustituciones y cuánto se pagó con cada método. Resumen de la noche (`v_night_register_summary`): efectivo en caja = ventas + cambio (regla 32), PIX, transferencia, total, y por caja con **Agregar cambio** (refuerzo) mientras la noche está en curso |
| Productos | Activa | Productos del club (no los combos: están en Combos) con **foto** (miniatura en la lista; subir, cambiar o quitar en Editar, u opcional al crear; JPG, PNG o WebP de hasta 2 MB) y **categoría** (`product_categories`, por club; **"Vaso"** existe siempre) y su stock en el **depósito** (ubicación `kind = 'storage'`). Arriba, **filtro por categoría** (Todas, cada categoría, Sin categoría). **Nuevo producto** se abre en un modal. Cada producto tiene **Editar** (en pantalla completa: foto y precios por barra a la izquierda, datos a la derecha; nombre, SKU, categoría, costo, precio y **precio por barra**; no altera ventas pasadas, regla 7), **Cargar depósito** (se abre al tocar cualquier parte de la fila; movimiento de ese producto, **siempre Compra / reposición por defecto**; no hay botón general de "Cargar stock") e **Inhabilitar / Habilitar** (`active`; no se borra). Carga de stock del depósito: stock inicial, compra, ajuste. **Viene por caja** (`units_per_box`, archivo `22`): al crear o editar se marca y se escribe cuántas unidades trae cada caja; la lista muestra "Caja x 6". En la compra de un producto por caja se carga por **Cajas** por defecto (o por Unidades): 2 cajas de 6 entran como 12 unidades y la nota queda "2 cajas x 6"; el libro guarda siempre unidades (regla 10). En la compra se ve el **costo por unidad**, el **por caja** y el **total según costo** (costo × unidades); con el **total de la factura** (opcional) muestra el costo por unidad según la factura y si **subió o bajó** (monto y %), con una casilla para **actualizar el costo** del producto (solo el costo; no altera ventas pasadas, regla 7). Cuentas en centavos (`lib/compra.ts`). Botón **Nueva categoría** arriba (modal) y activar/desactivar en la lista de categorías. **Precio por barra** (`product_location_prices`, archivo `16`): en Editar, una casilla por barra activa; vacía = precio general. Toda caja de esa barra cobra ese precio (`v_register_product_prices`). La lista muestra debajo del precio general el de cada barra. El formulario de producto muestra la vista previa de impuestos (sección 8): **pendiente** |
| Stock en barra | Activa | Se elige una barra y aparecen **todos** los productos activos con lo que hay en depósito y en esa barra. Cargar la barra es una **transferencia** depósito → barra (`transfer_out` + `transfer_in` en una sola inserción) y no puede superar lo que hay en el depósito (si hay 100, se pueden cargar 50). Cada producto tiene **Modificar**: *corregir conteo* (se escribe lo que hay de verdad y se registra un `adjustment` por la diferencia en la barra) o *devolver al depósito* (transferencia barra → depósito, no más de lo que hay en la barra). Sin depósito se ve la barra y se puede corregir el conteo. Nadie escribe el saldo (regla 10) |
| Inicio y cierre | Activa | Arriba, **fecha** (jornada, regla 27) y la **noche** de esa fecha (por defecto la en curso o la última). Se elige una barra y aparece la tabla **Producto · Inicio · Recarga · Cierre**, con **filtro por categoría**. Inicio y cierre son las fotos `night_stock_snapshots`; con la noche en curso el cierre es el saldo actual. Recarga = suma de los `transfer_in` a esa barra dentro del horario de la noche: dos recargas se suman. Al tocar un producto se ve cada recarga con hora, quién (personal por nombre; un administrador de plataforma figura con su nombre de `club_admin_names`, archivo `19`, o "Administrador" si no lo cargó) y cantidad. Solo lectura; botón **Actualizar** (`inventory_movements` no está en Realtime) |
| Combos | Activa | Un combo es un producto con `kind = 'combo'` (archivo `17`): foto, categoría, **Inhabilitar / Habilitar** y **precio por barra** como un producto. Se arma eligiendo productos activos; por cada uno se ve su costo y su precio normal (por la cantidad) y se escribe el **precio individual en el combo**. Abajo: costo total, precio normal total, precio del combo, **margen** ($ y %) y **descuento** ($ y %). El precio del combo es la suma de los precios individuales y el costo la de los costos: **los calcula la base**, el panel nunca los escribe. **No tiene stock propio**: al venderse descuenta el de sus productos (regla 10). Lista con productos, costo, precio (y de barra), margen y estado |
| Promociones | Activa | Promociones del club sobre **un producto** (reglas 34 a 36). Lista con producto, descuento, vigencia, barras y estado (**Aplicándose ahora**, Fuera de horario, Vencida, Inactiva; lee `v_promotions_status`). **Nueva promoción** (pantalla completa: a la izquierda el catálogo de productos activos con filtro por categoría y búsqueda, se elige uno; a la derecha el formulario): nombre, tipo (porcentaje, monto fijo por unidad, NxM) con un ejemplo del descuento, fechas, días, franja horaria (happy hour; avisa si cruza la medianoche) y barras (ninguna = todas). **Editar** (igual, con el catálogo bloqueado): nombre, vigencia y barras; producto y descuento no cambian. Interruptor Activa con aviso al desactivar. Sin borrar |
| Cajas/Barras | Activa | **Cajas**: varias por club; cada una es una fila de `cash_registers` vinculada a una ubicación de stock (regla 12). **Barras**: varias por club; cada una es una fila de `inventory_locations` con `kind = 'bar'` |
| Impuestos | Activa | Impuestos del club (sección 8) |
| Personal | Activa | Solo el personal de **ese** club: nombre, rol y **estado** (activo, bloqueado por intentos, inactivo). Alta con `admin-create-user`: cajero y barra con usuario + PIN; encargado (`club_admin`) con email + contraseña. **Editar** (`admin-update-user`): nombre, rol (solo entre cajero y barra; el de un encargado no cambia) y activo (nadie se desactiva a sí mismo). **Asignar** (`staff_assignments`, archivo `15`): un cajero a **una caja** activa, un bartender a **una barra** activa, o sin asignar; columna "Asignado a". Cambiar el rol quita la asignación vieja. Cambiar PIN (`admin-reset-pin`): **pendiente** |
| Historial | Activa | Todo lo que se hizo desde el panel en el club (archivo `19`, `club_activity`): auditoría (productos, precios, precios por barra, combos, impuestos, categorías, cajas, barras, promociones, personal, noches), movimientos manuales de stock y cambio en efectivo. Cada cambio con **qué** (antes → después), **quién** (personal por nombre; el administrador por su nombre de `club_admin_names`) y **hora** en la zona horaria del club. Filtro **desde/hasta** (por defecto los últimos 7 días; hasta 500 cambios). Arriba, **calendario del mes en curso** con sus días de la semana (lunes a domingo), como la grilla de GitHub (`club_activity_by_day`; más oscuro = más cambios); tocar un día filtra ese día; los días que todavía no llegaron no se tocan. Las fechas son del calendario del club, no la jornada. Solo lectura; botón **Actualizar** |
| Configuración | Activa | Preferencias del club (`club_settings`, archivo `20`). **Paleta de colores** del panel: violeta (la de Onticket), azul, turquesa, esmeralda, ámbar, coral, rosa, grafito y, del archivo `21`, rojo (fuerte; en modo oscuro con fondo negro profundo), naranja, lima, cielo, índigo y fucsia. Una prueba del panel exige que las paletas de `lib/paletas.ts` sean las mismas que acepta la base y que todas tengan sus colores en `index.css`. Cada club guarda la suya; al entrar a un club el panel toma sus colores y al salir vuelven los de Onticket. Elegir una la aplica al momento y la guarda; si no se guarda, vuelve la anterior. La cambia el administrador o el encargado, y queda en el Historial |

**Mi perfil** (pie del menú, solo administradores de plataforma): nombre, apellido y teléfono propios (`platform_admins`, archivo `19`); el email es el de la cuenta y no se cambia. El nombre lo ven los encargados de sus clubs en el historial; el teléfono y el email, solo él.

**Botón maestro de la noche:** con un club seleccionado, la cabecera muestra **Iniciar noche** (pide el cambio de cada caja activa) o **Parar noche** (pide confirmación). Ver reglas 29 a 33.

**Estado del personal (lectura desde el panel):** `users` no expone `failed_attempts` ni `locked_until` (sección 5). Para mostrar "bloqueado" se usa la función `club_staff_status(p_club_id)` (archivo `10_estado_personal.sql`), que devuelve solo `(user_id, is_locked)` del club que gestiona quien llama. Es función y no vista porque una vista con `security_invoker` no puede leer `locked_until`.

## 5. Contratos entre capas

### Panel web → base (directo, con RLS)

| Tabla | Puede leer | Puede insertar | Puede modificar |
|---|---|---|---|
| `platform_admins` | solo la **propia** fila | no | `first_name, last_name, phone` de la propia fila (`full_name` lo arma la base; auditado sin el teléfono) |
| `club_settings` | sí | no (una fila por club, la crea la base) | `palette` |
| `clubs` | sí | `name, slug, timezone, business_day_start_hour, created_by_admin_id` (solo el administrador) | `name, slug, timezone, business_day_start_hour, active` (solo el administrador) |
| `products` | sí | `club_id, name, sku, category, category_id, cost, price, image_url, active, kind, units_per_box` (`category` texto es obsoleto: usar `category_id`; un combo se crea con precio y costo 0) | lo mismo sin `club_id` ni `kind`, más `deleted_at`. En un combo, precio y costo los calcula la base |
| `product_categories` | sí | `club_id, name, sort_order, active` | `name, sort_order, active, deleted_at` |
| `club_nights` | sí | `club_id` (la hora y el autor los pone la base) | `ended_at` (parar; una noche cerrada no cambia más) |
| `cash_register_floats` | sí | `club_id, night_id, cash_register_id, kind, amount, note` (solo con la noche abierta) | no |
| `night_stock_snapshots` | sí | no (la toma un trigger) | no |
| `combo_items` | sí | `club_id, combo_id, product_id, quantity, unit_price` (solo productos en un combo) | `quantity, unit_price`; quitar = **borrar** la fila (auditado) |
| `inventory_locations` | sí | `club_id, name, kind, active` | `name, kind, active, deleted_at` |
| `cash_registers` | sí | `club_id, name, inventory_location_id, active` | `name, inventory_location_id, active, deleted_at` |
| `taxes` | sí | `club_id, name, kind, percentage, fixed_amount, active` | lo mismo sin `club_id`. **Sin borrar** |
| `tax_payment_methods` | sí | `club_id, tax_id, method` | no; se **borran** filas |
| `product_location_prices` | sí | `club_id, product_id, location_id, price` (solo barras; una por producto y barra) | `price`; quitar = **borrar** la fila (auditado; vuelve el precio general) |
| `promotions` | sí | `club_id, product_id, name, kind, percentage, fixed_amount, buy_quantity, pay_quantity, starts_on, ends_on, weekdays, start_time, end_time, active` (solo productos comunes) | `name, starts_on, ends_on, weekdays, start_time, end_time, active`. Las condiciones no cambian. **Sin borrar** |
| `promotion_locations` | sí | `club_id, promotion_id, location_id` (solo barras; una por promoción y barra) | no; quitar = **borrar** la fila (auditado). Sin filas = todas las barras |
| `staff_assignments` | sí | `club_id, user_id, cash_register_id, location_id` (una por persona: caja si es cajero, barra si es bartender) | `cash_register_id, location_id`; quitar = **borrar** la fila (auditado) |
| `inventory_movements` | sí | `club_id, location_id, product_id, movement_type, quantity, note, occurred_at` (solo tipos manuales; el autor lo firma un trigger) | no |
| `sync_errors` | sí | no | `resolved_at, resolved_note` |
| `users` | sí, **sin** `pin_hash`, `failed_attempts`, `locked_until` | no (Edge Function) | no (Edge Function) |
| Ventas, saldos, alertas, auditoría | sí | no | no |

Funciones para `supabase.rpc`: `product_tax_preview(p_club_id, p_price, p_cost)`, `can_manage_club(p_club_id)` y `club_staff_status(p_club_id)` (devuelve `user_id, is_locked`; nunca contadores ni horas), `club_admin_names(p_club_id)` (devuelve `admin_id, full_name` del administrador del club; nunca email ni teléfono), `club_activity(p_club_id, p_from, p_to, p_limit)` y `club_activity_by_day(p_club_id, p_from, p_to)` (historial; fechas del calendario del club, como mucho 400 días).
Vistas: `v_club_daily_stats`, `v_sale_item_financials`, `v_sale_taxes_detail`, las de ventas y noche `v_sales_list`, `v_night_register_summary`, `v_night_stock_summary`, `v_sales_outside_night`, y las de control `v_sales_integrity_issues`, `v_ticket_number_conflicts`, `v_sale_tax_issues`, `v_sale_promotion_issues`, la de promociones `v_promotions_status` y la del historial `v_club_activity`.

### Edge Functions

| Función | Estado | Qué hace |
|---|---|---|
| `pos-login` | Por construir | Usuario + PIN + club → verifica hash y bloqueo → JWT para PowerSync |
| `pos-upload` | Por construir | Aplica la cola del posnet. Solo INSERT en tablas permitidas, con `ON CONFLICT (id) DO NOTHING` |
| `admin-create-user` | **Hecha, con pruebas, publicada** | Verifica `can_manage_club` con el JWT de quien llama, calcula el hash bcrypt del PIN, inserta en `users` y audita `user.created`. Encargado: crea el usuario de Supabase Auth y, si la fila falla, lo borra |
| `admin-update-user` | **Hecha, con pruebas, publicada** | Verifica `can_manage_club`; cambia nombre, rol (cajero ↔ barra) y activo; solo escribe lo que cambia y audita `user.updated` con antes y después. No acepta PIN, usuario ni club. 404 si la persona no es del club |
| `admin-reset-pin` | Por construir | Igual que el alta: verifica, calcula el hash, audita |

- **Publicar** (desde la carpeta raíz del repo, o con `--workdir`): `npx supabase functions deploy <nombre> --project-ref <ref> --no-verify-jwt`. Sin `verify_jwt` porque con las claves nuevas la verificación del gateway no sirve: cada función valida la sesión ella misma (`auth.getUser`) y responde 401/403. Después de publicar, conviene `npx supabase logout` (el token de la CLI administra toda la cuenta). Si el panel no encuentra una función, lo dice ("Falta desplegarla en Supabase").
- **Estructura de cada función:** `validar.ts` (reglas puras), `handler.ts` (flujo con dependencias inyectadas, se prueba sin red) e `index.ts` (conecta Supabase y bcrypt). Lo común va en `supabase/functions/_shared/`.
- **Claves:** `SUPABASE_SECRET_KEYS` y `SUPABASE_PUBLISHABLE_KEYS` (JSON con la clave `default`), con `SUPABASE_SECRET_KEY` y `SUPABASE_PUBLISHABLE_KEY` como respaldo en local. No usar `SUPABASE_SERVICE_ROLE_KEY` ni `SUPABASE_ANON_KEY`.
- **PIN:** de 6 a 8 dígitos y no trivial (ni repetidos como `111111` ni escaleras como `123456`). El hash viaja al posnet para validar sin conexión, así que un PIN corto se adivina rápido fuera de línea. La regla vive en `validar.ts` y el panel la repite como ayuda.
- Las funciones de administración (`admin-*`) **sí** responden 4xx (400 datos, 401 sin sesión, 403 club ajeno, 409 duplicado). La regla de "nunca 4xx" es solo de `pos-upload`.
- Nunca se loguea, se audita ni se devuelve un PIN, su hash o una contraseña: solo códigos de error.

- `club_id` y `user_id` salen **del JWT**, nunca del cuerpo del pedido.
- Clasificación de errores de Postgres en `pos-upload`:

| SQLSTATE | Significado | Qué hacer |
|---|---|---|
| `23503` | Falta el padre (el retiro llegó antes que la venta) | Reintentar. Pasado un límite de tiempo: a `sync_errors` y 2xx |
| Resto de la clase `23` | Regla de negocio (sustituir de más, tocar un libro) | A `sync_errors` y 2xx |
| Red o base caída | Transitorio | 5xx para que el posnet reintente |

### PowerSync

- Se usan **Sync Streams** (las Sync Rules están en retirada). Cada stream filtra con `club_id = auth.parameter('club_id')`.
- La publicación `powersync` lista 24 tablas (`09_powersync.sql`, más `club_nights`, `product_categories`, `staff_assignments`, `product_location_prices`, `combo_items`, `promotions` y `promotion_locations` de los archivos 12, 13, 15, 16, 17 y 18). `sale_item_components` no se publica: la arma el servidor.
- **Combos en el posnet:** se vende el combo como una línea de `sale_items` (`product_id` = el combo, `unit_cost` = la suma de costos). Al sustituir un producto de un combo, `sale_item_substitutions.component_product_id` dice cuál; en un producto común va vacío. No se publican `platform_admins`, `inventory_movements`, `stock_alerts` ni `audit_log`.
- De `users` se envían solo las columnas necesarias. `pin_hash` viaja porque el posnet valida el PIN sin conexión; `failed_attempts` y `locked_until` no viajan.
- `payment_methods` no tiene columna `id`: sincronizar con `SELECT code AS id, ...`. El posnet ofrece solo los de `active = 1`.
- Bajan solo impuestos **activos**, y las ventas y retiros recientes o del turno, no todo el histórico.
- Tipos en SQLite: `numeric`, `uuid` y `timestamptz` llegan como texto; `boolean` como entero 0/1.

## 6. Base de datos

| Archivo | Contenido |
|---|---|
| `01_base_clubs_usuarios.sql` | Esquema `private`, funciones comunes, `payment_methods`, `platform_admins`, `clubs`, `users`, funciones de identidad |
| `02_catalogo_cajas_impuestos.sql` | `products`, `inventory_locations`, `cash_registers`, `cash_shifts`, `taxes`, `tax_payment_methods` |
| `03_ventas.sql` | `sales`, `sale_items`, `sale_payments`, `sale_status_events`, `sale_item_substitutions`, `sale_item_taxes` |
| `04_stock.sql` | `inventory_movements`, `inventory_balances`, `stock_alerts` |
| `05_auditoria_y_errores.sql` | `audit_log`, `sync_errors` |
| `06_reglas_de_negocio.sql` | Todos los triggers |
| `07_reportes.sql` | Vistas y `product_tax_preview` |
| `08_seguridad.sql` | RLS y permisos |
| `09_powersync.sql` | Publicación y plantilla del rol de replicación |
| `10_estado_personal.sql` | `club_staff_status`: estado de bloqueo del personal para el panel |
| `11_metodos_de_pago.sql` | Métodos comunes (PIX, Transferencia, Efectivo), columna `active`, trigger que impide sumar un método inactivo a un impuesto, `product_tax_preview` solo con métodos activos |
| `12_noches_y_cambio.sql` | `club_nights`, `night_stock_snapshots`, `cash_register_floats`, `sales.night_id`, triggers de iniciar/parar, vistas de ventas y resumen, tablas en `supabase_realtime` |
| `13_categorias.sql` | `product_categories` (con "Vaso" en todo club, también los nuevos), `products.category_id` |
| `14_fotos_productos.sql` | Bucket `product-images` (público solo lectura, 2 MB, JPG/PNG/WebP), políticas de Storage por carpeta `<club_id>/` y `CHECK` para que `products.image_url` solo apunte a una foto del mismo club |
| `15_asignaciones_personal.sql` | `staff_assignments`: cajero → una caja, bartender → una barra (activas, del mismo club); una por persona; cambiar el rol la quita; auditoría |
| `16_precios_por_barra.sql` | `product_location_prices`: precio de un producto por barra (sin fila = precio general), auditoría y `v_register_product_prices` (precio que cobra cada caja) |
| `17_combos.sql` | `products.kind`, `combo_items`, precio y costo del combo calculados, `sale_item_components` (foto de la composición al vender), stock de sus productos y sustitución dentro del combo. Reemplaza las funciones de venta y sustitución del `06` |
| `18_promociones.sql` | `promotions` (porcentaje, monto fijo por unidad, NxM; vigencia por fechas, días de la jornada y franja), `promotion_locations`, foto de la promoción y descuento en `sale_items`, `private.promotion_in_schedule`, `v_promotions_status`, `v_sale_promotion_issues`, y `v_sale_item_financials` / `v_club_daily_stats` con `promotion_discount` |
| `19_historial_y_perfil.sql` | `platform_admins` con `first_name`, `last_name`, `phone` (el administrador edita su fila; `full_name` lo arma un trigger; auditoría `platform_admin.updated` sin el teléfono), `club_admin_names` (`SECURITY DEFINER`: solo el nombre, filtrado por `visible_club_ids`), `v_club_activity` (auditoría + stock manual + cambio en efectivo, con nombre de quién y de qué), `club_activity`, `club_activity_by_day` |
| `20_configuracion_club.sql` | `club_settings`: una fila por club (creada por un trigger al crear el club y para los existentes) con `palette` (texto + `CHECK`); el panel solo la modifica; auditoría `club_settings.updated` sobre el club |
| `21_mas_paletas.sql` | Más paletas en el `CHECK` de `club_settings.palette`: rojo, naranja, lima, cielo, índigo y fucsia |
| `22_unidades_por_caja.sql` | `products.units_per_box` (2 a 1000; NULL = no viene por caja; solo productos comunes), permiso del panel para escribirlo al crear y editar |
| `90_datos_demo.sql` | Opcional: club demo |
| `99_reset_desarrollo.sql` | **Destructivo**: borra todo (solo desarrollo) |

- Cada archivo es una transacción y se pega completo en el SQL Editor, en orden.
- Cambios nuevos: archivos `10` a `89`. **Nunca editar un archivo ya ejecutado en un entorno con datos reales.** En desarrollo se puede reiniciar con el 99.

### Convenciones de SQL (las verifica la prueba `040_calidad_esquema`)

- Nombres siempre calificados: `public.tabla`, `private.funcion`.
- Funciones internas en `private`; en `public` solo lo que el panel llama por RPC.
- Toda función lleva `SET search_path = ''`. `SECURITY DEFINER` solo en dos casos: un trigger que debe escribir lo que quien dispara no puede, o una función de lectura que entrega un **dato derivado** de una columna secreta sin exponerla (`club_staff_status`). En el segundo caso la función filtra ella misma por `private.visible_club_ids()` y lleva su mutación.
- A toda función nueva se le quita `EXECUTE` a `PUBLIC` y `anon`, y se otorga solo a quien corresponde.
- Toda tabla nueva: `id uuid`, `club_id` con clave foránea a `clubs`, claves compuestas, **un índice por cada clave foránea**, `COMMENT ON TABLE`, RLS, políticas y permisos explícitos **incluido `service_role`** (Supabase ya no expone las tablas nuevas por su cuenta).
- Permisos de escritura del panel **por columna**.
- Vistas con `security_invoker = true`.
- Texto + `CHECK` (o tabla de referencia) en lugar de `ENUM`, `DOMAIN` o columnas `GENERATED`: viajan sin sorpresas a SQLite.
- `timestamptz` siempre; `numeric` para dinero; nunca `real`, `double precision` ni `money`.
- Nombres: `idx_<tabla>_<columnas>`, `uq_<tabla>_<columnas>`, `trg_<tabla>_<qué hace>`, `<tabla>_<regla>` para constraints, `v_<nombre>` para vistas.
- Errores de reglas de negocio con `ERRCODE = 'check_violation'`; "todavía no llegó el padre" con `'foreign_key_violation'`.
- Identificadores en inglés; comentarios en español y en ASCII (sin tildes) para copiar y pegar sin problemas de codificación.
- Las políticas de lectura se prueban también con `INSERT ... RETURNING`: es lo que envía `supabase-js` con `.insert().select()`, y una fila recién creada todavía no figura en `visible_club_ids()` dentro de la misma sentencia (por eso `clubs_select` tiene una segunda condición).
- Al agregar una tabla, vista o función: sumarla a `08_seguridad.sql` (o repetir su patrón), a `99_reset_desarrollo.sql` y, si el posnet la necesita, a `09_powersync.sql`.

## 7. Pruebas: siempre

**Nada está hecho sin pruebas pasando.** Antes de cerrar cualquier tarea:

1. Escribir o actualizar las pruebas de la capa que se tocó.
2. Correr **toda** la suite de esa capa y mostrar la salida.
3. Un bug se corrige escribiendo **primero** la prueba que lo reproduce y viéndola fallar.
4. Una regla nueva de seguridad, stock, impuestos o reportes agrega también su **mutación**.

| Capa | Herramienta | Comando |
|---|---|---|
| Base de datos | SQL con `ASSERT`, en transacción con `ROLLBACK` | `bash supabase/tests/run.sh` |
| Las propias pruebas | Mutación: rompe una regla y exige que la suite lo note. Distingue "no detectada" (falta una prueba) de "error de entorno" (la base no respondió) | `bash supabase/tests/mutaciones.sh` |
| Edge Functions | `deno test` | `deno test --allow-env supabase/functions` (sin Deno instalado: `npx --yes deno@2.5.6 test --allow-env supabase/functions`) |
| Panel web | Vitest + React Testing Library; integración contra Supabase local; diseño responsive probado en 375, 768 y 1280 px sin scroll horizontal (regla 28) | `npm test` en `admin/` |
| App Kotlin | JUnit y pruebas instrumentadas | `./gradlew test connectedAndroidTest` |
| Sincronización | Dos posnets sin conexión, de extremo a extremo | por definir con `sync-engineer` |

Las pruebas SQL usan las variables `PG*` (con Supabase local: `PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres PGPASSWORD=postgres`). Sin `psql` en la máquina, sirve un Postgres 15 descartable en Docker: copiar `supabase/` al contenedor (`docker cp`) y correr `run.sh` adentro. Para `mutaciones.sh` hace falta además `python3` en el contenedor. `run.sh` crea bases temporales y corre todo **dos veces**: con los permisos por defecto cerrados (Supabase actual) y abiertos (Supabase anterior). También verifica que el reinicio y la recarga funcionen.

| Prueba | Cubre |
|---|---|
| `010_stock_sobreventa_sustitucion` | Sobreventa, sustitución, finanzas, retiro duplicado, ventas inmutables, códigos de error, ubicación de la reversa |
| `020_impuestos` | Vista previa, pago mixto, activar y desactivar, historial intacto, jornada, estadísticas |
| `030_seguridad` | Cada rol: qué ve, qué puede y qué no; secretos; permisos por columna; auditoría; altas con `RETURNING` |
| `040_calidad_esquema` | Revisa el catálogo de Postgres: RLS, índices, `search_path`, permisos, tipos, publicación |
| `050_estado_personal` | `club_staff_status`: bloqueado, bloqueo vencido, aislamiento entre clubs y administradores, encargado, `anon`, sin columnas de más |
| `060_noches` | Iniciar y parar, una sola noche abierta, foto de stock, cambio inicial, refuerzo y corrección, efectivo esperado, cajas cerradas al parar, no reabrir, venta fuera de noche, aislamiento |
| `070_categorias` | "Vaso" por defecto (también en clubs nuevos), nombres únicos, categoría de otro club rechazada, auditoría, aislamiento |
| `080_fotos_productos` | Bucket público con límites, subir/mover/borrar solo en la carpeta del club propio, aislamiento entre administradores, `anon` sin listar ni subir, `image_url` solo del bucket y del club |
| `090_asignaciones` | Cajero solo a caja y bartender solo a barra activas, encargado sin asignación, una por persona, otro club rechazado, cambio de rol la quita, auditoría, aislamiento, `anon` |
| `100_precios_por_barra` | Caja de la barra VIP cobra su precio y las demás el general, solo barras, uno por producto y barra, no cambia de producto/barra/club, auditoría con precio anterior y nuevo, aislamiento, encargado, `anon` |
| `110_combos` | Precio y costo = suma (nadie los escribe), costo que llega al combo, sin combos dentro de combos, sin stock propio, venta que descuenta sus productos y guarda la foto, reintento sin duplicar, sustitución dentro del combo con límites y reversa, auditoría, aislamiento, encargado, `anon` |
| `120_promociones` | Límites de cada tipo, solo productos y solo barras, condiciones fijas (también para `service_role`), vigencia con horas fijas (jornada, franja que cruza la medianoche, fechas) y ahora, venta con descuento y reintento, impuesto sobre lo cobrado, reportes con el descuento aparte de la sustitución, control de descuentos mal calculados, auditoría, aislamiento, encargado, `anon` |
| `130_historial_y_perfil` | Perfil propio (solo nombre, apellido y teléfono; ni email, ni activo, ni ficha ajena), `full_name` armado, teléfono con formato, auditoría sin teléfono; `club_admin_names` solo para el club propio y sin datos de contacto; historial con cambio de precio, compra de stock, noche y cambio en efectivo con quién y qué; sin movimientos del posnet; días en la zona del club (23:30 del 14 es del 14); límite, orden y tope de 400 días; encargado, aislamiento, `anon` |
| `140_configuracion_club` | Fila por club (también en clubs nuevos), paleta por defecto y válida, solo se cambia la paleta (ni club, ni insertar, ni borrar), auditoría con antes y después y en el historial, encargado, aislamiento, `anon` |
| `150_unidades_por_caja` | Alta y edición con unidades por caja, límites 2 a 1000, combos sin caja, auditoría, la compra por cajas entra en unidades, otro club, encargado, `anon` |

Escenarios que siempre deben tener prueba: dos cajas venden la última unidad; sustitución con sus números; reintento sin duplicar; impuestos con pago mixto y desactivación; aislamiento entre clubs y entre administradores; retiro duplicado; evento que llega antes que su venta; el posnet no puede modificar ni borrar.

## 8. Panel web: especificación

**Configuración.** Variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`. Las claves `anon` y `service_role` antiguas están en retirada: no usarlas. La clave secreta nunca va al navegador.

**Impuestos** (por club seleccionado)
- Lista con nombre, tipo (`3 %` o `$50 por unidad`), métodos de pago e **interruptor Activo**.
- Crear y editar: nombre, tipo, valor y casillas de métodos de pago (al menos una; leer las opciones **activas** de `payment_methods`; un método inactivo que el impuesto ya usa aparece como "(ya no se usa)" solo para poder quitarlo).
- Al desactivar, avisar: *"Las ventas anteriores conservan este impuesto. Desde ahora no se aplicará a ventas nuevas."*
- Sin botón de borrar.

**Formulario de producto.** Al escribir precio y costo (con espera de unos 300 ms), llamar a `product_tax_preview` y mostrar por método de pago: cada impuesto con su **nombre** y monto, total de impuestos, neto y **margen después de impuestos** en monto y porcentaje. No recalcular en el navegador.

**Reportes.** `v_club_daily_stats` (por club y jornada), `v_sale_item_financials`, `v_sale_taxes_detail`.

**Alertas para el encargado.** `stock_alerts` abiertas, `sync_errors` sin resolver, `v_sale_tax_issues`, `v_sale_promotion_issues`, `v_sales_integrity_issues`, `v_ticket_number_conflicts`.

**Diseño responsive.** Regla 28 aplicada al panel: en teléfono, la navegación pasa a un menú desplegable, las tablas de reportes y de productos se muestran como listas o con scroll horizontal dentro de su propio contenedor (nunca en la página entera), y los formularios de una columna. Las casillas y botones tienen un área táctil de al menos 44 px. Los componentes de shadcn/ui se adaptan con clases de Tailwind por breakpoint, y el tema claro y oscuro funciona en todos los anchos.

**Sin autocompletado.** Los campos (`components/ui/input.tsx`) llevan `autoComplete="off"` por defecto: el navegador no sugiere lo escrito antes. El login lo pide explícito (email y contraseña) para los gestores de contraseñas.

**Navegación.** El club y la sección quedan en la dirección (`#/club/<id>/<sección>`, `lib/ruta.ts`): recargar vuelve al mismo lugar y Atrás/Adelante funcionan. No es seguridad: el club se vuelve a leer con RLS y, si no se ve, el panel vuelve a la lista de clubs. Cerrar sesión borra la dirección.

**Caché y velocidad.** Cada pedido a Supabase es un viaje por internet (100 a 300 ms) aunque la base conteste en 1 o 2 ms. `lib/datos.ts` guarda 60 s lo que cambia poco (clubs, productos, categorías, barras, cajas, métodos de pago, impuestos, personal, asignaciones, combos, precios por barra, promociones, nombres de administradores, paleta del club). Toda función que escribe llama a `invalidarCache`, y cambiar de sesión lo vacía. **No** se guardan ventas, stock, noches, el estado de las promociones ni el historial. Cada pantalla lanza sus pedidos en paralelo. Una lectura nueva que se agregue al caché, o una escritura nueva, lleva su prueba en `lib/cache.test.ts`.

**Sin sesión no hay datos**: tratar bien las listas vacías y los errores de permiso.

## 9. Agentes (`.claude/agents/`)

La sesión principal es el **orquestador**: aclara el pedido, reparte, verifica y actualiza la documentación.

```
1. Orquestador       aclara el requisito y las reglas que toca (secciones 4 y 5)
2. db-architect      migración + RLS + permisos + triggers
3. qa-test-engineer  pruebas de la base (antes o junto con el paso 2)
4. edge-functions-dev / admin-panel-dev / pos-android-dev   su capa, con pruebas
5. sync-engineer     Sync Streams y escenarios sin conexión
6. qa-test-engineer  corre todo; puede vetar el cierre
7. security-reviewer revisa antes de cerrar
8. Orquestador       actualiza CLAUDE.md, 00_LEEME.md y el reset
```

| Agente | Trabajo | Dueño de |
|---|---|---|
| `db-architect` | Esquema, migraciones, RLS, permisos, triggers, vistas | `supabase/sql/` |
| `qa-test-engineer` | Pruebas de todas las capas y mutaciones. **Puede vetar** | `supabase/tests/` y las pruebas de cada capa |
| `edge-functions-dev` | `pos-login`, `pos-upload`, `admin-create-user`, `admin-reset-pin` | `supabase/functions/` |
| `admin-panel-dev` | Panel React | `admin/` |
| `pos-android-dev` | App Kotlin | `app-pos/` |
| `sync-engineer` | Sync Streams, esquema del cliente, escenarios sin conexión | `powersync/` |
| `security-reviewer` | Revisión rápida de las reglas de `CLAUDE.md` (solo lectura) | nada: informa |
| `cybersecurity-auditor` | Auditoría completa de seguridad de todo el proyecto: secretos, SQL, Edge Functions, panel, app, sincronización, dependencias (solo lectura) | nada: informa, con severidad y corrección |
| `project-architect` | Estructura de directorios, configuración compartida y marco de pruebas de cada capa | configuración común del repo |
| `shadcn-ui-specialist` | shadcn/ui en `admin/`: componentes, tema claro y oscuro, accesibilidad, diseño responsive | `admin/components.json`, `admin/src/components/ui/` |
| `supabase-platform` | Supabase CLI, `config.toml`, migraciones, claves, cliente `supabase-js`, Auth y Data API | `supabase/config.toml`, cliente del panel |

**Regla común a todos:** toda funcionalidad nueva lleva sus pruebas, y no se da por cerrada sin correrlas y mostrar la salida (sección 7).

## 10. Estado y hoja de ruta

**Hecho y probado:** esquema completo (archivos 01 a 22, con noche, cambio en efectivo, categorías, fotos, asignaciones, precio por barra, combos, promociones, historial, perfil del administrador y configuración del club), datos demo, reinicio, la suite SQL con sus mutaciones, las definiciones de los 12 agentes en `.claude/agents/`, las Edge Functions `admin-create-user` y `admin-update-user`, y en el panel: login, menús, clubs, ventas en tiempo real con filtros y detalle, botón Iniciar/Parar noche con cambio por caja, inicio y cierre de cada barra por noche, productos con categorías, stock de depósito y precio por barra, combos, promociones, stock en barra, cajas y barras, impuestos, personal (alta, estado, edición y asignación a caja o barra), historial de cambios con calendario de actividad del mes, Mi perfil, configuración con paleta de colores por club y navegación que sobrevive a recargar.

**Aplicado en el proyecto de Supabase de desarrollo** (verificado el 2026-11-14): archivos 01 a 08 y 10 a 22, y las Edge Functions `admin-create-user` y `admin-update-user` publicadas (sin `verify_jwt`). El `09` (PowerSync) todavía no.

**Siguiente, en orden:**
1. Edge Functions: `admin-reset-pin`, `pos-login`, `pos-upload`.
2. Panel: vista previa de impuestos en el formulario de producto, cambiar PIN (con `admin-reset-pin`), editar y dar de baja cajas y barras, reportes, alertas para el encargado.
3. `powersync/`: Sync Streams y esquema del cliente.
4. App Kotlin: login con PIN, venta, impresión, QR firmado, barra y sustitución, modo sin conexión.
5. Pruebas de extremo a extremo con dos posnets sin conexión.

**Pendiente de verificar contra servicios reales** (las pruebas usan un Postgres con los roles de Supabase simulados):
- Las políticas RLS a través de la Data API con sesiones reales del panel.
- La replicación a PowerSync: tipos, lista de tablas y Sync Streams.
- El paso exacto para crear `powersync_role` según la guía vigente de PowerSync.

**Preguntas abiertas para el dueño del proyecto:** ninguna por ahora.

**Futuro acordado (no implementar todavía):**
- Arqueos de caja (contar la plata al parar la noche y compararla con el efectivo esperado), configurables por caja como individuales por cajero o compartidos. El cambio en efectivo ya está hecho (reglas 30 y 32).
- Posnet: bloquear la venta sin noche abierta (regla 29) cuando se construya la app.
- Reembolsos (cuando el reemplazo es más barato hoy solo queda marcado con descuento negativo).
- Impuestos por producto o categoría; cargo fijo por venta.
- Venta de estadísticas entre clubs.
- Registro opcional de posnets; límite de intentos de PIN por IP.

## 11. Decisiones tomadas

| Decisión | Motivo |
|---|---|
| Todo en Supabase desde el día 0, sin servidor por club | Menos piezas que instalar y mantener en cada club |
| Posnet con usuario + PIN, sin registrar aparatos | Simplicidad para el cajero |
| Impuestos incluidos en el precio, fijo por unidad, por método de pago | Así se cobran las comisiones reales |
| Stock negativo permitido con alerta | Una venta cobrada no se puede deshacer |
| Sustitución: se cobra lo vendido, cuesta lo entregado | No se le cobra la diferencia al cliente y el reporte muestra el costo real |
| Jornada desde las 12:00 | Una noche cruza la medianoche |
| Métodos de pago en una tabla global | Agregar uno no obliga a tocar constraints |
| Métodos: PIX, Transferencia y Efectivo, iguales en todos los clubs; Mixto = varios pagos en una venta | Un método "mixto" no diría qué parte se pagó con qué, y los impuestos se calculan por esa parte (regla 23) |
| Noche con botón maestro; venta fuera de noche se acepta y se marca | El posnet sin conexión puede vender después de parar: rechazarla perdería una venta cobrada (regla 15) |
| Foto de stock automática al iniciar y parar | Nadie tiene que contar a mano para saber qué se vendió por barra |
| Cambio en efectivo: inicial + refuerzos, en libro de solo agregar | En la noche se agrega cambio; corregir es agregar una línea |
| Stock de "producto" = depósito; la barra se carga por transferencia | Una barra no puede recibir más de lo que hay en depósito |
| Categorías en tabla por club, con "Vaso" siempre | Cada club tiene las suyas; los vasos se distinguen del resto |
| Fotos de productos en un bucket público de solo lectura | El posnet las baja sin sesión de Supabase y las guarda para usarlas sin conexión; escribir solo puede quien gestiona el club |
| Precio especial **por barra** (no por caja ni listas de precios): sin precio de barra se cobra el general | Lo pidió el dueño del proyecto; toda caja de la barra VIP cobra lo mismo |
| Combo = producto con `kind = 'combo'`, vendido como una línea; el servidor descuenta sus productos y guarda la foto de la composición | Reutiliza foto, categoría, activo y precio por barra; el posnet vende igual que un producto. Un impuesto **fijo por unidad** cuenta 1 por combo (no por cada producto adentro): confirmado por el dueño del proyecto |
| Impuestos sobre lo que se cobra: el porcentaje sobre lo cobrado de cada línea (ya con promoción) y el fijo por cada unidad vendida de la línea, **también las que regala un 2x1**; un combo es una unidad | Confirmado por el dueño del proyecto (2026-11-14) |
| Combos y promociones por etapas: 1) precio por barra, 2) combos, 3) promociones | Cada etapa con su SQL, pruebas y pantalla, revisada antes de seguir |
| Promoción sobre un producto, que baja el precio cobrado, con vigencia por fechas, días y franja, y barras opcionales | Lo eligió el dueño del proyecto. Los impuestos se calculan sobre lo que se cobró de verdad |
| Condiciones de una promoción fijas; días y fechas de la jornada | El recálculo de ventas pasadas sigue valiendo; "viernes" incluye la madrugada del sábado, como la noche |
| Publicación de PowerSync con lista de tablas | PowerSync procesa todo lo publicado; publicar de más cuesta |

Verificado contra la documentación de Supabase y PowerSync en noviembre de 2026: permisos explícitos para la Data API, claves publicable y secreta, Sync Streams, mapeo de tipos. Volver a verificar antes de salir a producción.
