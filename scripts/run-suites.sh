#!/usr/bin/env bash
#
# Every suite, each against its own server and its own empty database.
#
# Not one server for all of them, for two reasons that both look like bugs when you hit
# them. The login throttle lives in the process, and these suites create a dozen accounts
# between them, so the fourth one starts getting 429s that read as broken auth. And
# `test:admin` is about "whoever registers first is the admin" — run it against a database
# somebody else has already registered in and every assertion is about the wrong person.
#
#   ./scripts/run-suites.sh              # all of them
#   ./scripts/run-suites.sh money races  # just these
#
# Needs a build first (`npm run build`). Exits non-zero if anything failed, which is what
# CI reads.
set -uo pipefail
set -m

cd "$(dirname "$0")/.."

PORT="${PORT:-3910}"
export BASE="http://127.0.0.1:$PORT"
DB="$(mktemp -d)/ci.db"
# Su propio directorio de datos, no el del repositorio: sin esto la suite de
# recibos siembra fotos en data/receipts/ de verdad — la misma avería que ya
# tuvieron las suites de DocDrop y SecretDrop con sus almacenes.
DATA_DIR="$(mktemp -d)"
LOG="$(mktemp)"

ALL=(api money auth members social races admin recurring receipts account profile)
SUITES=("${@:-${ALL[@]}}")
[ $# -gt 0 ] && SUITES=("$@")

server_pid=""

# The binary is invoked directly — not through `npm run start`, not even through `npx` —
# and that is not a detail: both of those spawn `next` as a child, so killing them leaves it alive and holding the port, so
# the next suite's `curl` finds a server, decides it has started, and runs against the
# previous suite's database. It looks exactly like a bug in the app — the admin suite
# reporting that the first account was not made an admin, because it was not the first.
stop() {
  [ -n "$server_pid" ] || return 0
  # The whole group, not the process: `next start` spawns a `next-server` worker, and
  # killing only the parent leaves the worker holding the port. Bash job control is what
  # makes the group exist to be killed.
  kill -- -"$server_pid" 2>/dev/null || kill "$server_pid" 2>/dev/null
  wait "$server_pid" 2>/dev/null
  server_pid=""
  # And wait for the port to go quiet before anything else claims it. Without this the
  # next suite's `curl` can find the dying server, decide it has started, and run against
  # the previous suite's database and throttle counter — which from the outside looks
  # exactly like the app being broken.
  for _ in $(seq 1 40); do
    curl -sf -o /dev/null "$BASE/login" || return 0
    sleep 0.25
  done
  echo "aviso: el puerto $PORT sigue ocupado"
}
trap 'stop; exit 130' INT TERM

start() {
  rm -f "$DB" "$DB"-wal "$DB"-shm
  # `test:admin` is the only one that wants the approval queue; the rest want registration
  # out of the way so they can make the accounts they need.
  local mode=open
  [ "$1" = admin ] && mode=approval

  # Las variables OIDC se desactivan A PROPÓSITO para el servidor de pruebas.
  #
  # Con un proveedor configurado, /api/auth/register y /api/auth/login devuelven
  # 404 —es deliberado: la identidad la lleva el proveedor y una contraseña
  # antigua no debe poder esquivar su MFA—. Pero las suites crean sus cuentas por
  # ahí, así que heredar el entorno de producción las hace fallar todas con 404
  # sin explicar por qué. Pasó, y costó un rato entenderlo.
  #
  # Las pruebas ejercitan la lógica de la aplicación, no el flujo del proveedor.
  # El artefacto standalone, que es el que ejecuta producción y el que irá en la
  # imagen — no `next start`, que sirve `.next` y es otro programa. Toma HOSTNAME
  # y PORT del entorno; sin HOSTNAME escucharía en 0.0.0.0.
  TABUP_DB="$DB" TABUP_DATA_DIR="$DATA_DIR" TABUP_REGISTRATION="$mode" \
    TABUP_OIDC_CLIENT_ID= TABUP_OIDC_CLIENT_SECRET= TABUP_OIDC_REDIRECT_URI= \
    TABUP_OIDC_PUBLIC_BASE= TABUP_OIDC_INTERNAL_BASE= \
    TABUP_OLLAMA_URL="http://127.0.0.1:11500" \
    HOSTNAME=127.0.0.1 PORT="$PORT" \
    node .next/standalone/server.js >"$LOG" 2>&1 &
  server_pid=$!

  for _ in $(seq 1 90); do
    curl -sf -o /dev/null "$BASE/login" && return 0
    sleep 0.5
  done
  echo "el servidor no arrancó para $1:"
  tail -20 "$LOG"
  return 1
}

failed=0
for suite in "${SUITES[@]}"; do
  # These need no server at all: pure functions over a fixed set of dates.
  if [ "$suite" = recurring ]; then
    printf "%-10s " "$suite"
    npm run --silent test:recurring | tail -1
    continue
  fi

  start "$suite" || { failed=1; continue; }
  printf "%-10s " "$suite"
  out=$(npm run --silent "test:$suite" 2>&1)
  status=$?
  echo "$out" | tail -1
  [ $status -ne 0 ] && { echo "$out" | grep -E "✗" | head -10; failed=1; }
  stop
done

rm -f "$DB" "$DB"-wal "$DB"-shm "$LOG"
rm -rf "$DATA_DIR"
if [ $failed -ne 0 ]; then
  echo
  echo "HAY FALLOS"
  exit 1
fi
echo
echo "todo verde"
