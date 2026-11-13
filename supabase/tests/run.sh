#!/usr/bin/env bash
# Corre TODAS las pruebas SQL de Onticket en bases descartables.
#
# Uso con Supabase local (despues de "supabase start"):
#   PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres PGPASSWORD=postgres bash supabase/tests/run.sh
# Sirve cualquier PostgreSQL 15 o superior (usa las variables PG* habituales).
#
# Que hace, DOS veces (permisos por defecto cerrados y abiertos, ver
# 00_stub_supabase.sql):
#   1) crea una base temporal y carga el esquema (todos los NN_*.sql,
#      salvo 90 demo y 99 reset);
#   2) ejecuta cada *.test.sql (cada una hace ROLLBACK: no deja datos);
#   3) comprueba que 99_reset + recarga del esquema funcionan;
#   4) borra la base temporal.
# Termina con codigo distinto de 0 si algo falla.
set -euo pipefail
cd "$(dirname "$0")"

export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
ERR="$(mktemp)"
FAILED=0
DB=""

cleanup() {
    [ -n "$DB" ] && "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null 2>&1 || true
    rm -f "$ERR"
}
trap cleanup EXIT

load_schema() {
    local f
    for f in ../sql/[0-9][0-9]_*.sql; do
        case "$(basename "$f")" in 90_*|99_*) continue ;; esac
        if ! "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null 2>"$ERR"; then
            echo "   FALLO al cargar $(basename "$f")"; sed 's/^/      /' "$ERR" | head -8
            return 1
        fi
    done
}

run_mode() {
    local open_defaults="$1" label="$2" t
    DB="onticket_test_$$_${open_defaults}"
    echo "== Permisos por defecto ${label} =="
    "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" -c "CREATE DATABASE \"$DB\"" >/dev/null
    "${PSQL[@]}" -d "$DB" -v open_defaults="$open_defaults" -f 00_stub_supabase.sql >/dev/null

    load_schema || { FAILED=$((FAILED + 1)); return; }
    echo "   OK    esquema cargado"

    for t in *.test.sql; do
        if "${PSQL[@]}" -d "$DB" -f "$t" >/dev/null 2>"$ERR"; then
            echo "   OK    $t"
        else
            echo "   FALLO $t"; sed 's/^/      /' "$ERR" | head -8
            FAILED=$((FAILED + 1))
        fi
    done

    if "${PSQL[@]}" -d "$DB" -f ../sql/99_reset_desarrollo.sql >/dev/null 2>"$ERR" && load_schema; then
        echo "   OK    reset + recarga del esquema"
    else
        echo "   FALLO reset + recarga del esquema"; sed 's/^/      /' "$ERR" | head -8
        FAILED=$((FAILED + 1))
    fi

    "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null
    DB=""
}

run_mode 0 "CERRADOS (Supabase actual)"
run_mode 1 "ABIERTOS (Supabase anterior)"

if [ "$FAILED" -ne 0 ]; then
    echo "== $FAILED fallo(s) =="
    exit 1
fi
echo "== Todas las pruebas pasaron =="
