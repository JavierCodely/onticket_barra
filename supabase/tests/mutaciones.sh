#!/usr/bin/env bash
# PRUEBAS DE MUTACION: las pruebas tambien se prueban.
#
# Rompe UNA regla por vez en una copia temporal del esquema y exige que
# la suite (run.sh) lo detecte. Si una rotura pasa inadvertida, falta
# una prueba. Tarda unos minutos: correrlo al tocar reglas de seguridad,
# stock, impuestos o reportes, y antes de salir a produccion.
#
# Uso (mismas variables PG* que run.sh):
#   PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres PGPASSWORD=postgres bash supabase/tests/mutaciones.sh
#
# Cada mutacion reemplaza un texto exacto de un archivo SQL. Si ese
# texto cambio, avisa "MUTACION INVALIDA": hay que actualizarla aca.
# Al agregar una regla nueva, agregar su mutacion al final.
set -uo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
MISSED=0
ENV_ERRORS=0

run_suite() { (cd "$WORK/supabase/tests" && bash run.sh 2>&1); }
fresh_copy() { rm -rf "$WORK/supabase"; cp -r "$SRC" "$WORK/supabase"; }

fresh_copy
if ! run_suite | grep -q "Todas las pruebas pasaron"; then
    echo "La suite falla SIN mutar: arreglar eso primero (bash supabase/tests/run.sh)."
    exit 1
fi
echo "Base: la suite pasa sin mutar."

# mutate <descripcion> <archivo> <texto exacto> <reemplazo>   (\n = salto de linea)
mutate() {
    local out
    fresh_copy
    if ! python3 - "$WORK/supabase/$2" "$3" "$4" <<'PY'
import sys
path, old, new = sys.argv[1], sys.argv[2].replace('\\n', '\n'), sys.argv[3].replace('\\n', '\n')
text = open(path, encoding='utf-8').read()
if old not in text:
    sys.exit(1)
open(path, 'w', encoding='utf-8').write(text.replace(old, new, 1))
PY
    then
        echo "MUTACION INVALIDA  $1  (el texto ya no existe en $2)"; MISSED=$((MISSED + 1)); return
    fi
    out="$(run_suite)"
    # La suite debe TERMINAR (con o sin fallos). Si se corto (base caida,
    # sin conexion) no se puede afirmar nada sobre la mutacion.
    if ! grep -Eq "fallo\(s\) ==|Todas las pruebas pasaron" <<<"$out"; then
        echo "ERROR DE ENTORNO  $1  (la suite no termino: revisar la conexion a Postgres)"
        ENV_ERRORS=$((ENV_ERRORS + 1)); return
    fi
    if grep -q "== Permisos" <<<"$out" && grep -q "FALLO" <<<"$out"; then
        echo "detectada      $1  [$(grep -m1 FALLO <<<"$out" | sed 's/ *FALLO *//')]"
    else
        echo "NO DETECTADA   $1"; MISSED=$((MISSED + 1))
    fi
}

# ---- Seguridad -------------------------------------------------------
mutate "una tabla sin RLS" sql/08_seguridad.sql \
    "'audit_log', 'sync_errors']\n    LOOP\n        EXECUTE format('ALTER TABLE" \
    "'audit_log']\n    LOOP\n        EXECUTE format('ALTER TABLE"
mutate "pin_hash visible desde el panel" sql/08_seguridad.sql \
    "username, pin_changed_at, created_at" "username, pin_hash, pin_changed_at, created_at"
mutate "funcion publica abierta a anon" sql/08_seguridad.sql \
    "public.product_tax_preview(uuid, numeric, numeric)\nFROM PUBLIC, anon;" \
    "public.product_tax_preview(uuid, numeric, numeric)\nFROM authenticated;"
mutate "service_role sin permisos (Edge Functions)" sql/08_seguridad.sql \
    "EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', r);" ""
mutate "el panel puede borrar impuestos" sql/08_seguridad.sql \
    "GRANT UPDATE (name, kind, percentage, fixed_amount, active)\n    ON public.taxes TO authenticated;" \
    "GRANT UPDATE (name, kind, percentage, fixed_amount, active)\n    ON public.taxes TO authenticated;\nGRANT DELETE ON public.taxes TO authenticated;\nCREATE POLICY taxes_delete ON public.taxes FOR DELETE TO authenticated USING (true);"
mutate "vista que saltea RLS" sql/07_reportes.sql \
    "CREATE VIEW public.v_club_daily_stats\nWITH (security_invoker = true) AS" \
    "CREATE VIEW public.v_club_daily_stats AS"
mutate "funcion sin search_path" sql/01_base_clubs_usuarios.sql \
    "RETURNS boolean\nLANGUAGE sql\nSTABLE\nSET search_path = ''\n" "RETURNS boolean\nLANGUAGE sql\nSTABLE\n"
mutate "producto que cambia de club" sql/06_reglas_de_negocio.sql \
    "CREATE TRIGGER trg_products_club_fixed\n    BEFORE UPDATE OF club_id ON public.products\n    FOR EACH ROW EXECUTE FUNCTION private.forbid_club_change();" ""
mutate "ajuste de stock sin firma de autor" sql/06_reglas_de_negocio.sql \
    "        NEW.actor_id   := v_actor_id;\n" "        NEW.actor_id   := NULL; NEW.actor_type := NULL;\n"

mutate "crear un club y leerlo en la misma sentencia" sql/08_seguridad.sql \
    "        OR (created_by_admin_id = (SELECT private.current_admin_id()) AND deleted_at IS NULL)\n" ""

# ---- Stock, ventas y retiro ------------------------------------------
mutate "alerta de stock que no se cierra" sql/06_reglas_de_negocio.sql \
    "AND a.status      = 'open';" "AND a.status      = 'nunca';"
mutate "reversa de stock a la ubicacion actual de la caja" sql/06_reglas_de_negocio.sql \
    "SELECT m.location_id INTO v_sale_location\n      FROM public.inventory_movements m\n     WHERE m.sale_item_id = NEW.sale_item_id\n       AND m.movement_type = 'sale';" \
    "SELECT cr.inventory_location_id INTO v_sale_location FROM public.sales s JOIN public.cash_registers cr ON cr.id = s.cash_register_id WHERE s.id = NEW.sale_id;"
mutate "se puede sustituir mas de lo vendido" sql/06_reglas_de_negocio.sql \
    "IF v_replaced + NEW.quantity > v_item.quantity THEN" "IF false THEN"
mutate "retiro duplicado cuenta como valido" sql/06_reglas_de_negocio.sql \
    "           AND NOT e.is_duplicate\n    );" "           AND false\n    );"
mutate "ventas modificables" sql/06_reglas_de_negocio.sql \
    "    BEFORE UPDATE OR DELETE ON public.sales\n" "    BEFORE DELETE ON public.sales\n"
mutate "falta un indice de clave foranea" sql/03_ventas.sql \
    "CREATE INDEX idx_sale_items_product ON public.sale_items (product_id, club_id);" ""

# ---- Impuestos y reportes --------------------------------------------
mutate "impuesto inactivo cuenta en la vista previa" sql/07_reportes.sql \
    "           AND t.active\n" ""
mutate "margen neto sin restar impuestos" sql/07_reportes.sql \
    "si.line_total - calc.cost_effective - calc.tax_total         AS net_margin" \
    "si.line_total - calc.cost_effective                          AS net_margin"
mutate "impuesto mal calculado no se detecta" sql/07_reportes.sql \
    "WHERE ABS(t.amount - expected.amount) > 0.01" "WHERE false"
mutate "jornada = dia calendario" sql/07_reportes.sql \
    "make_interval(hours => c.business_day_start_hour)" "make_interval(hours => 0)"

# ---- PowerSync -------------------------------------------------------
mutate "publicacion con tablas internas" sql/09_powersync.sql \
    "    public.sync_errors;" "    public.sync_errors,\n    public.audit_log;"

if [ "$ENV_ERRORS" -ne 0 ]; then
    echo "== $ENV_ERRORS mutacion(es) sin evaluar por un problema de entorno: volver a correr =="
    exit 2
fi
if [ "$MISSED" -ne 0 ]; then
    echo "== $MISSED mutacion(es) sin detectar o invalidas: faltan pruebas =="
    exit 1
fi
echo "== Todas las mutaciones fueron detectadas =="
