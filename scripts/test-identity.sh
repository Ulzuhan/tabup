#!/usr/bin/env bash
#
# Drives test-identity.mjs: the same database served by three different configurations,
# because the bugs this suite pins only exist in one of them.
#
# The other suites all run with the identity provider switched off — run-suites.sh unsets
# those variables on purpose, so that the accounts they create can exist at all. That is
# exactly why nothing caught a join page that only worked without a provider. Here the
# provider is the point, so it gets its own runner.
#
#   npm run test:identity        # needs a build first (npm run build)
#
# Nothing talks to the provider: no sign-in is ever completed. The URLs only have to be
# well-formed for `oidcConfig()` to consider itself configured, which is what changes the
# shape of the pages under test.
set -uo pipefail
set -m

cd "$(dirname "$0")/.."

PORT="${PORT:-3117}"
export BASE="http://127.0.0.1:$PORT"
WORK="$(mktemp -d)"
DB="$WORK/join.db"
export STATE="$WORK/state.json"
LOG="$WORK/server.log"

# Un proveedor que no existe y no hace falta que exista.
IDP="https://idp.example.invalid"
ENROLL="$IDP/if/flow/enroll-tabup/"

server_pid=""

stop() {
  [ -n "$server_pid" ] || return 0
  # El grupo entero: el servidor standalone deja un trabajador que se queda con el
  # puerto si solo se mata al padre. Es la misma lección que run-suites.sh.
  kill -- -"$server_pid" 2>/dev/null || kill "$server_pid" 2>/dev/null
  wait "$server_pid" 2>/dev/null
  server_pid=""
  for _ in $(seq 1 40); do
    curl -sf -o /dev/null "$BASE/login" || return 0
    sleep 0.25
  done
  echo "aviso: el puerto $PORT sigue ocupado"
}

cleanup() {
  stop
  rm -rf "$WORK"
}
trap 'cleanup; exit 130' INT TERM
trap cleanup EXIT

# $1: "local" | "provider" | "noenroll"
start() {
  local oidc_id="" oidc_secret="" oidc_issuer="" oidc_redirect="" enroll=""
  if [ "$1" != local ]; then
    oidc_id=tabup-pruebas
    oidc_secret=secreto-de-pruebas
    # El EMISOR, no la base: desde el paso a discovery es lo único que se
    # configura del proveedor (lib/oidc.ts).
    oidc_issuer="$IDP/application/o/tabup/"
    oidc_redirect="https://tabup.example.invalid/api/auth/callback"
    [ "$1" = provider ] && enroll="$ENROLL"
  fi

  # El artefacto standalone, que es el que corre en producción — no `next start`, que
  # sirve `.next` y es otro programa. Toma HOSTNAME y PORT del entorno.
  TABUP_DB="$DB" TABUP_DATA_DIR="$WORK" TABUP_REGISTRATION=open \
    TABUP_OIDC_CLIENT_ID="$oidc_id" TABUP_OIDC_CLIENT_SECRET="$oidc_secret" \
    TABUP_OIDC_ISSUER="$oidc_issuer" TABUP_OIDC_REDIRECT_URI="$oidc_redirect" \
    TABUP_ENROLL_URL="$enroll" \
    HOSTNAME=127.0.0.1 PORT="$PORT" \
    node .next/standalone/server.js >>"$LOG" 2>&1 &
  server_pid=$!

  for _ in $(seq 1 90); do
    curl -sf -o /dev/null "$BASE/login" && return 0
    sleep 0.5
  done
  echo "el servidor no arrancó en modo $1:"
  tail -20 "$LOG"
  return 1
}

if [ ! -f .next/standalone/server.js ]; then
  echo "falta el artefacto: ejecuta 'npm run build' antes"
  exit 1
fi

failed=0

echo "Con cuentas propias"
start local || exit 1
PHASE=setup node scripts/test-identity.mjs || failed=1
stop

echo
echo "Con proveedor de identidad"
start provider || exit 1
PHASE=provider node scripts/test-identity.mjs || failed=1
stop

echo
echo "Con proveedor y sin alta publicada"
start noenroll || exit 1
PHASE=noenroll node scripts/test-identity.mjs || failed=1
stop

echo
if [ $failed -ne 0 ]; then
  echo "HAY FALLOS"
  exit 1
fi
echo "todo verde"
