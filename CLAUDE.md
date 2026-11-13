# Onticket: reglas, arquitectura y plan de trabajo

Este archivo es la fuente de verdad del proyecto. **Leelo completo antes de tocar código.** Si un pedido contradice una regla de acá, frená y preguntá antes de seguir.

## 1. Qué es Onticket

Sistema de gestión de **barra, stock y caja** para clubes nocturnos. Es multi-club: una sola plataforma administra varios clubs y los datos de cada uno nunca se mezclan.

- **No incluye venta de entradas.** Solo consumos en barra.
- El cajero vende en un **posnet Android** e imprime un ticket con **QR**. La barra escanea el QR para registrar el retiro.
- Tiene que **seguir funcionando sin internet** (vender, imprimir, retirar) y sincronizar al reconectar.
- Un **administrador** crea clubs y gestiona los que creó. Cada club tiene sus usuarios, productos, impuestos y estadísticas.

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
2. Dos candados obligatorios en cada tabla: **GRANT** (qué operaciones y columnas) y **RLS** (qué filas). `anon` no tiene nada.
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
20. Si falta un producto, la barra entrega otro. `sale_items` conserva **lo vendido**; `sale_item_substitutions` registra **lo entregado**. Ingreso = lo cobrado; costo = el del producto entregado; la diferencia de precio de lista es un **descuento que absorbe el club** (no se le cobra al cliente). El stock devuelve el producto vendido a la ubicación donde se había descontado y descuenta el entregado en la barra que lo entrega.

### Impuestos
21. Cada club define los suyos: nombre, porcentaje **o** monto fijo **por unidad**, y los métodos de pago que los disparan.
22. Están **incluidos en el precio**: se descuentan de lo que el club se queda. Margen neto = precio − impuestos − costo.
23. Pago mixto: proporcional a la parte del ticket pagada con los métodos del impuesto. Fórmulas en `02_catalogo_cajas_impuestos.sql`, sección E.
24. Se **activan y desactivan; no se borran**. Desactivar no toca ventas anteriores; las nuevas ya no lo aplican.
25. El posnet calcula y guarda la foto del impuesto. El servidor no bloquea: `v_sale_tax_issues` lista lo que no coincide.

### Reportes
26. Las estadísticas son **siempre por club**. El administrador ve las de cada club suyo; un total de todos sus clubs se arma sumando esas filas. Comprar estadísticas de clubs ajenos es **futuro** y requerirá su propio diseño con consentimiento: no agregar consultas que crucen clubs.
27. La **jornada** de un club empieza a `business_day_start_hour` (12 por defecto): la venta de las 03:00 del sábado pertenece al viernes.

## 5. Contratos entre capas

### Panel web → base (directo, con RLS)

| Tabla | Puede leer | Puede insertar | Puede modificar |
|---|---|---|---|
| `clubs` | sí | `name, slug, timezone, business_day_start_hour, created_by_admin_id` (solo el administrador) | `name, slug, timezone, business_day_start_hour, active` (solo el administrador) |
| `products` | sí | `club_id, name, sku, category, cost, price, image_url, active` | lo mismo sin `club_id`, más `deleted_at` |
| `inventory_locations` | sí | `club_id, name, kind, active` | `name, kind, active, deleted_at` |
| `cash_registers` | sí | `club_id, name, inventory_location_id, active` | `name, inventory_location_id, active, deleted_at` |
| `taxes` | sí | `club_id, name, kind, percentage, fixed_amount, active` | lo mismo sin `club_id`. **Sin borrar** |
| `tax_payment_methods` | sí | `club_id, tax_id, method` | no; se **borran** filas |
| `inventory_movements` | sí | `club_id, location_id, product_id, movement_type, quantity, note, occurred_at` (solo tipos manuales; el autor lo firma un trigger) | no |
| `sync_errors` | sí | no | `resolved_at, resolved_note` |
| `users` | sí, **sin** `pin_hash`, `failed_attempts`, `locked_until` | no (Edge Function) | no (Edge Function) |
| Ventas, saldos, alertas, auditoría | sí | no | no |

Funciones para `supabase.rpc`: `product_tax_preview(p_club_id, p_price, p_cost)` y `can_manage_club(p_club_id)`.
Vistas: `v_club_daily_stats`, `v_sale_item_financials`, `v_sale_taxes_detail`, y las de control `v_sales_integrity_issues`, `v_ticket_number_conflicts`, `v_sale_tax_issues`.

### Edge Functions (por construir)

| Función | Qué hace |
|---|---|
| `pos-login` | Usuario + PIN + club → verifica hash y bloqueo → JWT para PowerSync |
| `pos-upload` | Aplica la cola del posnet. Solo INSERT en tablas permitidas, con `ON CONFLICT (id) DO NOTHING` |
| `admin-create-user`, `admin-reset-pin` | Verifican `can_manage_club` con el JWT de quien llama, calculan el hash, auditan |

- `club_id` y `user_id` salen **del JWT**, nunca del cuerpo del pedido.
- Clasificación de errores de Postgres en `pos-upload`:

| SQLSTATE | Significado | Qué hacer |
|---|---|---|
| `23503` | Falta el padre (el retiro llegó antes que la venta) | Reintentar. Pasado un límite de tiempo: a `sync_errors` y 2xx |
| Resto de la clase `23` | Regla de negocio (sustituir de más, tocar un libro) | A `sync_errors` y 2xx |
| Red o base caída | Transitorio | 5xx para que el posnet reintente |

### PowerSync

- Se usan **Sync Streams** (las Sync Rules están en retirada). Cada stream filtra con `club_id = auth.parameter('club_id')`.
- La publicación `powersync` lista 17 tablas (`09_powersync.sql`). No se publican `platform_admins`, `inventory_movements`, `stock_alerts` ni `audit_log`.
- De `users` se envían solo las columnas necesarias. `pin_hash` viaja porque el posnet valida el PIN sin conexión; `failed_attempts` y `locked_until` no viajan.
- `payment_methods` no tiene columna `id`: sincronizar con `SELECT code AS id, ...`.
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
| `90_datos_demo.sql` | Opcional: club demo |
| `99_reset_desarrollo.sql` | **Destructivo**: borra todo (solo desarrollo) |

- Cada archivo es una transacción y se pega completo en el SQL Editor, en orden.
- Cambios nuevos: archivos `10` a `89`. **Nunca editar un archivo ya ejecutado en un entorno con datos reales.** En desarrollo se puede reiniciar con el 99.

### Convenciones de SQL (las verifica la prueba `040_calidad_esquema`)

- Nombres siempre calificados: `public.tabla`, `private.funcion`.
- Funciones internas en `private`; en `public` solo lo que el panel llama por RPC.
- Toda función lleva `SET search_path = ''`. `SECURITY DEFINER` solo cuando un trigger debe escribir lo que quien dispara no puede.
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
| Edge Functions | `deno test` | `deno test --allow-env supabase/functions` |
| Panel web | Vitest + React Testing Library; integración contra Supabase local | `npm test` en `admin/` |
| App Kotlin | JUnit y pruebas instrumentadas | `./gradlew test connectedAndroidTest` |
| Sincronización | Dos posnets sin conexión, de extremo a extremo | por definir con `sync-engineer` |

Las pruebas SQL usan las variables `PG*` (con Supabase local: `PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres PGPASSWORD=postgres`). `run.sh` crea bases temporales y corre todo **dos veces**: con los permisos por defecto cerrados (Supabase actual) y abiertos (Supabase anterior). También verifica que el reinicio y la recarga funcionen.

| Prueba | Cubre |
|---|---|
| `010_stock_sobreventa_sustitucion` | Sobreventa, sustitución, finanzas, retiro duplicado, ventas inmutables, códigos de error, ubicación de la reversa |
| `020_impuestos` | Vista previa, pago mixto, activar y desactivar, historial intacto, jornada, estadísticas |
| `030_seguridad` | Cada rol: qué ve, qué puede y qué no; secretos; permisos por columna; auditoría; altas con `RETURNING` |
| `040_calidad_esquema` | Revisa el catálogo de Postgres: RLS, índices, `search_path`, permisos, tipos, publicación |

Escenarios que siempre deben tener prueba: dos cajas venden la última unidad; sustitución con sus números; reintento sin duplicar; impuestos con pago mixto y desactivación; aislamiento entre clubs y entre administradores; retiro duplicado; evento que llega antes que su venta; el posnet no puede modificar ni borrar.

## 8. Panel web: especificación

**Configuración.** Variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`. Las claves `anon` y `service_role` antiguas están en retirada: no usarlas. La clave secreta nunca va al navegador.

**Impuestos** (por club seleccionado)
- Lista con nombre, tipo (`3 %` o `$50 por unidad`), métodos de pago e **interruptor Activo**.
- Crear y editar: nombre, tipo, valor y casillas de métodos de pago (al menos una; leer las opciones de `payment_methods`).
- Al desactivar, avisar: *"Las ventas anteriores conservan este impuesto. Desde ahora no se aplicará a ventas nuevas."*
- Sin botón de borrar.

**Formulario de producto.** Al escribir precio y costo (con espera de unos 300 ms), llamar a `product_tax_preview` y mostrar por método de pago: cada impuesto con su **nombre** y monto, total de impuestos, neto y **margen después de impuestos** en monto y porcentaje. No recalcular en el navegador.

**Reportes.** `v_club_daily_stats` (por club y jornada), `v_sale_item_financials`, `v_sale_taxes_detail`.

**Alertas para el encargado.** `stock_alerts` abiertas, `sync_errors` sin resolver, `v_sale_tax_issues`, `v_sales_integrity_issues`, `v_ticket_number_conflicts`.

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

**Hecho y probado:** esquema completo (archivos 01 a 09), datos demo, reinicio, la suite SQL con sus mutaciones, y las definiciones de los 12 agentes en `.claude/agents/`.

**Siguiente, en orden:**
1. Edge Functions con pruebas.
2. Panel: login, selector de club, productos con vista previa de impuestos, impuestos, stock, reportes, usuarios.
3. `powersync/`: Sync Streams y esquema del cliente.
4. App Kotlin: login con PIN, venta, impresión, QR firmado, barra y sustitución, modo sin conexión.
5. Pruebas de extremo a extremo con dos posnets sin conexión.

**Pendiente de verificar contra servicios reales** (las pruebas usan un Postgres con los roles de Supabase simulados):
- Las políticas RLS a través de la Data API con sesiones reales del panel.
- La replicación a PowerSync: tipos, lista de tablas y Sync Streams.
- El paso exacto para crear `powersync_role` según la guía vigente de PowerSync.

**Futuro acordado (no implementar todavía):**
- Arqueos de caja, configurables por caja como individuales por cajero o compartidos.
- Combos y promociones. Los combos **no tienen stock propio**: descuentan el de sus productos.
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
| Publicación de PowerSync con lista de tablas | PowerSync procesa todo lo publicado; publicar de más cuesta |

Verificado contra la documentación de Supabase y PowerSync en noviembre de 2026: permisos explícitos para la Data API, claves publicable y secreta, Sync Streams, mapeo de tipos. Volver a verificar antes de salir a producción.
