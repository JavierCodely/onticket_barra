# Onticket: base de datos en Supabase

## Orden de ejecución

Pegá cada archivo **completo** en Supabase → **SQL Editor** → **Run**, uno por uno y en este orden. Cada archivo es una transacción: si falla, no queda nada a medias. Corregí el error y volvé a ejecutar ese mismo archivo antes de seguir.

| # | Archivo | Qué crea |
|---|---|---|
| 01 | `01_base_clubs_usuarios.sql` | Funciones internas, métodos de pago, administradores, clubs y usuarios |
| 02 | `02_catalogo_cajas_impuestos.sql` | Productos, ubicaciones de stock, cajas, turnos e impuestos |
| 03 | `03_ventas.sql` | Ventas, pagos, retiro por QR, sustituciones e impuestos aplicados |
| 04 | `04_stock.sql` | Libro de stock, saldos y alertas de sobreventa |
| 05 | `05_auditoria_y_errores.sql` | Auditoría y errores de sincronización |
| 06 | `06_reglas_de_negocio.sql` | Reglas automáticas (triggers) |
| 07 | `07_reportes.sql` | Vistas de reportes y vista previa de impuestos |
| 08 | `08_seguridad.sql` | Seguridad por filas y permisos |
| 09 | `09_powersync.sql` | Publicación para PowerSync |
| 90 | `90_datos_demo.sql` | **Opcional.** Club demo con productos, stock, impuestos y usuarios de posnet |
| 99 | `99_reset_desarrollo.sql` | **Destructivo.** Borra todo. Solo desarrollo |

Los cambios futuros van en archivos nuevos numerados del 10 al 89.

## Si ya habías ejecutado la versión anterior (archivos 01 a 10)

Esta versión reorganiza el esquema y no se aplica encima de la anterior. En un proyecto de **desarrollo**:

1. Ejecutá el `99_reset_desarrollo.sql` **nuevo** (limpia también los objetos de la versión anterior). Borra todos los datos de Onticket; no toca los usuarios de Authentication.
2. Ejecutá del 01 al 09.
3. Si querés, el 90.

Si ya tenés datos reales que conservar, no ejecutes el 99: hace falta una migración que los preserve.

## Primeros pasos

1. Ejecutá los archivos **01 a 09**.
2. En **Authentication → Users → Add user**, creá tu usuario administrador.
3. En `90_datos_demo.sql`, cambiá el email de la línea `<<< CAMBIAR` por el de ese usuario y ejecutalo.
4. Iniciá sesión en el panel: vas a ver el Club Demo.

Usuarios de posnet de prueba: `cajero1`, `cajero2` y `barra1`, con PIN `123456`. Solo para desarrollo.

Para el rol de replicación de PowerSync, seguí las instrucciones al final de `09_powersync.sql`.

## Pruebas automáticas

```bash
# Con Supabase local (supabase start):
export PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres PGPASSWORD=postgres
bash supabase/tests/run.sh          # toda la suite (segundos)
bash supabase/tests/mutaciones.sh   # comprueba que las pruebas detectan roturas (minutos)
```

Sirve cualquier PostgreSQL 15 o superior. `run.sh` crea bases temporales, carga el esquema, corre las pruebas y las borra: no deja datos ni toca tu proyecto.

| Prueba | Qué verifica |
|---|---|
| `010_stock_sobreventa_sustitucion` | Dos cajas venden la última unidad, sustitución en barra, retiro duplicado, ventas inmutables |
| `020_impuestos` | Vista previa por método de pago, pago mixto, activar y desactivar sin perder historial, jornada y estadísticas |
| `030_seguridad` | Qué ve y qué puede hacer cada rol; secretos; auditoría; crear un club y recibir la fila creada |
| `040_calidad_esquema` | Que ninguna tabla, vista o función se escape de las convenciones |

`mutaciones.sh` termina con uno de tres resultados: todas detectadas; alguna **no detectada** (falta una prueba); o **error de entorno** (la base no respondió y hay que volver a correrlo).

## Panel de administración (React + TypeScript + shadcn)

```bash
npm create vite@latest admin -- --template react-ts
cd admin
npm install @supabase/supabase-js
npx shadcn@latest init
```

`.env.local` (valores en Project Settings → API Keys):

```
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Usá la clave **publicable**. La clave secreta nunca va al navegador. Las claves `anon` y `service_role` antiguas están en retirada.

```ts
// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export const supabase = createClient<Database>(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
)
```

Tipos de las tablas, generados desde tu proyecto:

```bash
npx supabase gen types typescript --project-id TU_PROJECT_ID --schema public > src/types/database.ts
```

**Sin iniciar sesión no se ve ningún dato.** Si una lista sale vacía, lo primero es revisar la sesión.

### Qué puede hacer el panel directamente

| Acción | ¿Directo desde React? |
|---|---|
| Ver clubs, ventas, retiros, sustituciones, stock, alertas y auditoría | Sí, solo de los clubs que gestiona |
| Crear y editar productos, precios, ubicaciones y cajas | Sí |
| Crear y editar impuestos; activarlos y desactivarlos | Sí. No se pueden borrar |
| Cambiar los métodos de pago de un impuesto | Sí: insertar y borrar filas de `tax_payment_methods` |
| Vista previa de margen al cargar un producto | `supabase.rpc('product_tax_preview', { p_club_id, p_price, p_cost })` |
| Ajustes manuales de stock | Sí: insertar en `inventory_movements` (queda firmado con quien lo hizo) |
| Marcar un error de sincronización como resuelto | Sí |
| Crear clubs y editar sus datos | Solo el administrador |
| **Crear usuarios, asignar roles y cambiar PIN** | **No: necesita una Edge Function** |

Al insertar o modificar, enviá **solo** las columnas permitidas (la lista está en `CLAUDE.md`, sección 5). Si mandás otra, por ejemplo `id` o `created_at`, la base responde "permission denied".

Reportes: `v_club_daily_stats`, `v_sale_item_financials`, `v_sale_taxes_detail`. Controles: `v_sales_integrity_issues`, `v_ticket_number_conflicts`, `v_sale_tax_issues`.

Reglas, arquitectura y agentes: `CLAUDE.md` en la raíz del repositorio.
