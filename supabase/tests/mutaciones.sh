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
# (las vistas de finanzas las reemplaza el archivo 18: se mutan ahi)
mutate "vista que saltea RLS" sql/18_promociones.sql \
    "CREATE OR REPLACE VIEW public.v_club_daily_stats\nWITH (security_invoker = true) AS" \
    "CREATE OR REPLACE VIEW public.v_club_daily_stats AS"
mutate "funcion sin search_path" sql/01_base_clubs_usuarios.sql \
    "RETURNS boolean\nLANGUAGE sql\nSTABLE\nSET search_path = ''\n" "RETURNS boolean\nLANGUAGE sql\nSTABLE\n"
mutate "producto que cambia de club" sql/06_reglas_de_negocio.sql \
    "CREATE TRIGGER trg_products_club_fixed\n    BEFORE UPDATE OF club_id ON public.products\n    FOR EACH ROW EXECUTE FUNCTION private.forbid_club_change();" ""
mutate "ajuste de stock sin firma de autor" sql/06_reglas_de_negocio.sql \
    "        NEW.actor_id   := v_actor_id;\n" "        NEW.actor_id   := NULL; NEW.actor_type := NULL;\n"

mutate "crear un club y leerlo en la misma sentencia" sql/08_seguridad.sql \
    "        OR (created_by_admin_id = (SELECT private.current_admin_id()) AND deleted_at IS NULL)\n" ""
mutate "estado del personal de otro club visible" sql/10_estado_personal.sql \
    "       AND p_club_id IN (SELECT private.visible_club_ids());" ";"
mutate "estado del personal abierto a anon" sql/10_estado_personal.sql \
    "REVOKE EXECUTE ON FUNCTION public.club_staff_status(uuid) FROM PUBLIC, anon;" ""
mutate "bloqueo vencido sigue contando" sql/10_estado_personal.sql \
    "COALESCE(u.locked_until > now(), false)" "u.locked_until IS NOT NULL"

# ---- Stock, ventas y retiro ------------------------------------------
mutate "alerta de stock que no se cierra" sql/06_reglas_de_negocio.sql \
    "AND a.status      = 'open';" "AND a.status      = 'nunca';"
# (la venta y la sustitucion las reemplaza el archivo 17: se mutan ahi)
mutate "reversa de stock a la ubicacion actual de la caja" sql/17_combos.sql \
    "SELECT m.location_id INTO v_sale_location\n      FROM public.inventory_movements m\n     WHERE m.sale_item_id = NEW.sale_item_id\n       AND m.product_id = NEW.original_product_id\n       AND m.movement_type = 'sale';" \
    "SELECT cr.inventory_location_id INTO v_sale_location FROM public.sales s JOIN public.cash_registers cr ON cr.id = s.cash_register_id WHERE s.id = NEW.sale_id;"
mutate "se puede sustituir mas de lo vendido" sql/17_combos.sql \
    "IF v_replaced + NEW.quantity > v_limit THEN" "IF false THEN"
mutate "retiro duplicado cuenta como valido" sql/06_reglas_de_negocio.sql \
    "           AND NOT e.is_duplicate\n    );" "           AND false\n    );"
mutate "ventas modificables" sql/06_reglas_de_negocio.sql \
    "    BEFORE UPDATE OR DELETE ON public.sales\n" "    BEFORE DELETE ON public.sales\n"
mutate "falta un indice de clave foranea" sql/03_ventas.sql \
    "CREATE INDEX idx_sale_items_product ON public.sale_items (product_id, club_id);" ""

# ---- Impuestos y reportes --------------------------------------------
mutate "impuesto inactivo cuenta en la vista previa" sql/11_metodos_de_pago.sql \
    "           AND t.active\n" ""
mutate "metodo de pago inactivo en la vista previa" sql/11_metodos_de_pago.sql \
    "         WHERE pm.active\n           AND p_club_id" "         WHERE p_club_id"
mutate "impuesto con un metodo de pago inactivo" sql/11_metodos_de_pago.sql \
    "                WHERE pm.code = NEW.method AND NOT pm.active) THEN" "                WHERE false) THEN"
mutate "margen neto sin restar impuestos" sql/18_promociones.sql \
    "si.line_total - calc.cost_effective - calc.tax_total         AS net_margin" \
    "si.line_total - calc.cost_effective                          AS net_margin"
mutate "impuesto mal calculado no se detecta" sql/07_reportes.sql \
    "WHERE ABS(t.amount - expected.amount) > 0.01" "WHERE false"
mutate "jornada = dia calendario" sql/18_promociones.sql \
    "make_interval(hours => c.business_day_start_hour)" "make_interval(hours => 0)"

# ---- Noche, cambio y ventas ------------------------------------------
mutate "dos noches abiertas en un club" sql/12_noches_y_cambio.sql \
    "CREATE UNIQUE INDEX uq_club_nights_one_open ON public.club_nights (club_id) WHERE ended_at IS NULL;" ""
mutate "una noche cerrada se reabre" sql/12_noches_y_cambio.sql \
    "    IF OLD.ended_at IS NOT NULL THEN\n        RAISE EXCEPTION 'La noche ya esta cerrada" \
    "    IF false THEN\n        RAISE EXCEPTION 'La noche ya esta cerrada"
mutate "parar no cierra las cajas" sql/12_noches_y_cambio.sql \
    "         WHERE s.club_id = NEW.club_id\n           AND s.closed_at IS NULL;" \
    "         WHERE false;"
mutate "cambio cargado con la noche cerrada" sql/12_noches_y_cambio.sql \
    "                      AND n.ended_at IS NULL) THEN" "                      ) THEN"
mutate "efectivo esperado sin el cambio" sql/12_noches_y_cambio.sql \
    "COALESCE(f.opening_float, 0) + COALESCE(f.added_float, 0) + COALESCE(pay.cash_sales, 0) AS expected_cash" \
    "COALESCE(pay.cash_sales, 0) AS expected_cash"
mutate "venta despues de parar no se marca" sql/12_noches_y_cambio.sql \
    "COALESCE(s.created_at_device > n.ended_at, false)" "false"
mutate "ventas sin tiempo real" sql/12_noches_y_cambio.sql \
    "ARRAY['sales', 'sale_payments', 'club_nights', 'cash_register_floats'] LOOP" \
    "ARRAY['sale_payments', 'club_nights', 'cash_register_floats'] LOOP"

# ---- Categorias ------------------------------------------------------
mutate "club nuevo sin categoria Vaso" sql/13_categorias.sql \
    "    INSERT INTO public.product_categories (club_id, name, sort_order)\n    VALUES (NEW.id, 'Vaso', 0);" ""
mutate "producto con categoria de otro club" sql/13_categorias.sql \
    "    FOREIGN KEY (category_id, club_id) REFERENCES public.product_categories (id, club_id);" \
    "    FOREIGN KEY (category_id) REFERENCES public.product_categories (id);"

# ---- Fotos de productos ----------------------------------------------
mutate "foto subida en la carpeta de otro club" sql/14_fotos_productos.sql \
    "    WITH CHECK (bucket_id = 'product-images'\n                AND (storage.foldername(name))[1] IN (SELECT v::text FROM private.visible_club_ids() AS v));\n\nCREATE POLICY product_images_update" \
    "    WITH CHECK (bucket_id = 'product-images');\n\nCREATE POLICY product_images_update"
mutate "fotos de otro club visibles" sql/14_fotos_productos.sql \
    "    FOR SELECT TO authenticated\n    USING (bucket_id = 'product-images'\n           AND (storage.foldername(name))[1] IN (SELECT v::text FROM private.visible_club_ids() AS v));" \
    "    FOR SELECT TO authenticated\n    USING (bucket_id = 'product-images');"
mutate "image_url a cualquier sitio" sql/14_fotos_productos.sql \
    "    OR image_url ~ ('^https?://[^/?#]+/storage/v1/object/public/product-images/'\n                    || club_id::text || '/[^/?#]+\$')" \
    "    OR true"

# ---- Asignacion de personal ------------------------------------------
mutate "cajero asignado a una barra" sql/15_asignaciones_personal.sql \
    "        IF NEW.cash_register_id IS NULL THEN\n            RAISE EXCEPTION 'A un cajero se le asigna una caja' USING ERRCODE = 'check_violation';\n        END IF;" ""
mutate "asignaciones de otro club visibles" sql/15_asignaciones_personal.sql \
    "    FOR SELECT TO authenticated USING (club_id IN (SELECT private.visible_club_ids()));" \
    "    FOR SELECT TO authenticated USING (true);"
mutate "cambio de rol mantiene la asignacion" sql/15_asignaciones_personal.sql \
    "        DELETE FROM public.staff_assignments a WHERE a.user_id = NEW.id AND a.club_id = NEW.club_id;" ""

# ---- Precio por barra ------------------------------------------------
mutate "precio de barra en un deposito" sql/16_precios_por_barra.sql     "                      AND l.kind = 'bar' AND l.deleted_at IS NULL) THEN"     "                      AND l.deleted_at IS NULL) THEN"
mutate "precios de barra de otro club visibles" sql/16_precios_por_barra.sql     "CREATE POLICY product_location_prices_select ON public.product_location_prices
    FOR SELECT TO authenticated USING (club_id IN (SELECT private.visible_club_ids()));"     "CREATE POLICY product_location_prices_select ON public.product_location_prices
    FOR SELECT TO authenticated USING (true);"
mutate "caja de la barra VIP cobra el precio general" sql/16_precios_por_barra.sql     "       COALESCE(plp.price, p.price)  AS effective_price"     "       p.price                       AS effective_price"
mutate "precio de barra sin auditoria" sql/16_precios_por_barra.sql     "        CASE TG_OP WHEN 'INSERT' THEN 'product_price.bar_set'"     "        CASE TG_OP WHEN 'INSERT' THEN 'product_price.set'"

# ---- Combos ---------------------------------------------------------
mutate "combo con precio escrito a mano" sql/17_combos.sql \
    "    IF NEW.price <> v_price OR NEW.cost <> v_cost THEN" "    IF false THEN"
mutate "combo que no se recalcula" sql/17_combos.sql \
    "CREATE TRIGGER trg_combo_items_recalc\n    AFTER INSERT OR UPDATE OR DELETE ON public.combo_items\n    FOR EACH ROW EXECUTE FUNCTION private.combo_items_after_change();" ""
mutate "costo de un producto no llega al combo" sql/17_combos.sql \
    "CREATE TRIGGER trg_products_cost_to_combos\n    AFTER UPDATE OF cost ON public.products\n    FOR EACH ROW EXECUTE FUNCTION private.product_cost_to_combos();" ""
mutate "combo dentro de un combo" sql/17_combos.sql \
    "                      AND p.kind = 'product' AND p.deleted_at IS NULL) THEN" \
    "                      AND p.deleted_at IS NULL) THEN"
mutate "combo con stock propio" sql/17_combos.sql \
    "CREATE TRIGGER trg_inventory_movements_not_combo\n    BEFORE INSERT ON public.inventory_movements\n    FOR EACH ROW EXECUTE FUNCTION private.movement_not_on_combo();" ""
mutate "combo vendido no descuenta sus productos" sql/17_combos.sql \
    "        SELECT NEW.club_id, v_location, c.product_id, 'sale', -(NEW.quantity * c.quantity), NEW.id, v_at" \
    "        SELECT NEW.club_id, v_location, c.product_id, 'sale', -c.quantity, NEW.id, v_at"
mutate "sustituir en un combo sin decir que producto" sql/17_combos.sql \
    "        IF NEW.component_product_id IS NULL THEN\n            RAISE EXCEPTION 'En un combo hay que indicar que producto se sustituye'\n                USING ERRCODE = 'check_violation';\n        END IF;" ""
mutate "productos de combos de otro club visibles" sql/17_combos.sql \
    "CREATE POLICY combo_items_select ON public.combo_items\n    FOR SELECT TO authenticated USING (club_id IN (SELECT private.visible_club_ids()));" \
    "CREATE POLICY combo_items_select ON public.combo_items\n    FOR SELECT TO authenticated USING (true);"

# ---- Promociones -----------------------------------------------------
mutate "promocion sobre un combo" sql/18_promociones.sql \
    "           AND p.kind = 'product' AND p.deleted_at IS NULL) THEN" \
    "           AND p.deleted_at IS NULL) THEN"
mutate "condiciones de una promocion modificables" sql/18_promociones.sql \
    "         OR NEW.percentage   IS DISTINCT FROM OLD.percentage\n" ""
mutate "promocion limitada a un deposito" sql/18_promociones.sql \
    "                      AND l.kind = 'bar' AND l.deleted_at IS NULL) THEN\n        RAISE EXCEPTION 'Una promocion solo" \
    "                      AND l.deleted_at IS NULL) THEN\n        RAISE EXCEPTION 'Una promocion solo"
mutate "descuento mayor que la linea" sql/18_promociones.sql \
    "        AND discount_amount <= quantity * unit_price\n" ""
mutate "linea cobrada sin restar el descuento" sql/18_promociones.sql \
    "CHECK (line_total = quantity * unit_price - discount_amount)" "CHECK (line_total = quantity * unit_price - discount_amount OR true)"
mutate "descuento de promocion contado como sustitucion" sql/18_promociones.sql \
    "calc.list_value_delivered - si.quantity * si.unit_price      AS substitution_discount" \
    "calc.list_value_delivered - si.line_total                    AS substitution_discount"
mutate "2x1 que regala de mas" sql/18_promociones.sql \
    "ELSE (si.quantity / p.buy_quantity) * (p.buy_quantity - p.pay_quantity) * si.unit_price" \
    "ELSE (si.quantity::numeric / p.buy_quantity) * (p.buy_quantity - p.pay_quantity) * si.unit_price"
mutate "monto fijo sin tope en el precio" sql/18_promociones.sql \
    "si.quantity * LEAST(p.fixed_amount, si.unit_price)" "si.quantity * p.fixed_amount"
mutate "franja que no cruza la medianoche" sql/18_promociones.sql \
    "               ELSE p_local_ts::time >= p_start_time OR p_local_ts::time < p_end_time" \
    "               ELSE p_local_ts::time >= p_start_time AND p_local_ts::time < p_end_time"
mutate "fechas de la promocion por reloj y no por jornada" sql/18_promociones.sql \
    "       AND (p_ends_on   IS NULL OR d.business_day <= p_ends_on)" \
    "       AND (p_ends_on   IS NULL OR p_local_ts::date <= p_ends_on)"
mutate "dias de la promocion por reloj y no por jornada" sql/18_promociones.sql \
    "       AND (p_weekdays & (1 << (extract(isodow FROM d.business_day)::int - 1))) <> 0" \
    "       AND (p_weekdays & (1 << (extract(isodow FROM p_local_ts)::int - 1))) <> 0"
mutate "promociones de otro club visibles" sql/18_promociones.sql \
    "CREATE POLICY promotions_select ON public.promotions\n    FOR SELECT TO authenticated USING (club_id IN (SELECT private.visible_club_ids()));" \
    "CREATE POLICY promotions_select ON public.promotions\n    FOR SELECT TO authenticated USING (true);"
mutate "panel cambia las condiciones de una promocion" sql/18_promociones.sql \
    "GRANT UPDATE (name, starts_on, ends_on, weekdays, start_time, end_time, active)" \
    "GRANT UPDATE (name, starts_on, ends_on, weekdays, start_time, end_time, active, percentage)"

# ---- Perfil e historial (19) ------------------------------------------
mutate "nombre del administrador visible a cualquier club" sql/19_historial_y_perfil.sql \
    "       AND p_club_id IN (SELECT private.visible_club_ids());" ";"
mutate "telefono sin control de formato" sql/19_historial_y_perfil.sql \
    "CHECK (phone IS NULL OR phone ~" "CHECK (true OR phone ~"
mutate "administrador cambia su email desde el panel" sql/19_historial_y_perfil.sql \
    "GRANT UPDATE (first_name, last_name, phone)" "GRANT UPDATE (first_name, last_name, phone, email)"
mutate "auditoria guarda el telefono" sql/19_historial_y_perfil.sql \
    "jsonb_build_object('phone_changed', true)" "jsonb_build_object('phone_changed', true, 'phone', NEW.phone)"
mutate "historial con dias en UTC" sql/19_historial_y_perfil.sql \
    "(x.occurred_at AT TIME ZONE c.timezone)::date" "(x.occurred_at AT TIME ZONE 'UTC')::date"
mutate "historial corta un dia antes" sql/19_historial_y_perfil.sql \
    "AND a.occurred_at <  ((p_to + 1)::timestamp" "AND a.occurred_at <  ((p_to)::timestamp"
mutate "historial sin los movimientos de stock" sql/19_historial_y_perfil.sql \
    "     WHERE m.actor_id IS NOT NULL" "     WHERE false"
mutate "historial con movimientos del posnet" sql/19_historial_y_perfil.sql \
    "     WHERE m.actor_id IS NOT NULL" "     WHERE true"
mutate "historial sin tope de dias" sql/19_historial_y_perfil.sql     "BETWEEN 0 AND 400" "BETWEEN 0 AND 4000"

# ---- Configuracion del club (20) ----------------------------------------
mutate "paleta de otro club visible" sql/20_configuracion_club.sql     "FOR SELECT TO authenticated USING (club_id IN (SELECT private.visible_club_ids()));"     "FOR SELECT TO authenticated USING (true);"
mutate "panel cambia el club de la configuracion" sql/20_configuracion_club.sql     "GRANT UPDATE (palette) ON public.club_settings" "GRANT UPDATE (palette, club_id) ON public.club_settings"
mutate "club nuevo sin configuracion" sql/20_configuracion_club.sql     "    INSERT INTO public.club_settings (club_id) VALUES (NEW.id)
    ON CONFLICT (club_id) DO NOTHING;" "    NULL;"
mutate "cambio de paleta sin auditar" sql/20_configuracion_club.sql     "    IF NEW.palette IS NOT DISTINCT FROM OLD.palette THEN" "    IF true THEN"
mutate "paletas nuevas rechazadas" sql/21_mas_paletas.sql     "     'rojo', 'naranja'," "     'naranja',"
mutate "paleta sin control de valores" sql/21_mas_paletas.sql     "CHECK (palette IN" "CHECK (true OR palette IN"

# ---- Unidades por caja (22) ---------------------------------------------
mutate "caja con una sola unidad" sql/22_unidades_por_caja.sql     "BETWEEN 2 AND 1000" "BETWEEN 1 AND 1000"
mutate "combo que viene por caja" sql/22_unidades_por_caja.sql     "CHECK (units_per_box IS NULL OR kind = 'product')" "CHECK (true)"
mutate "panel no puede editar unidades por caja" sql/22_unidades_por_caja.sql     "GRANT UPDATE (units_per_box) ON public.products TO authenticated;" ""

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
