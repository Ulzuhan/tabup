#!/usr/bin/env bash
#
# Drives test-restart.mjs: set something up, restart the server against the same
# database, and check that the restart changed nothing.
#
# The other suites all talk to one long-lived server, so none of them can see a bug that
# only happens at boot — and the boot code is where the repairs live, which are the most
# dangerous thing in the app: they rewrite everybody's data with nobody watching.
#
#   npm run test:restart
set -u

PORT="${PORT:-3114}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
DB="$WORK/restart.db"
STATE="$WORK/state.json"
LOG="$WORK/server.log"

cleanup() {
  stop_server
  rm -rf "$WORK"
}
trap cleanup EXIT

SERVER_PID=""

# Killed by who is holding the port, plus the process that was started here.
#
# Not by name and not by working directory: `npx next dev` becomes several processes and
# renames itself to "next-server" along the way, so there is nothing stable to match on —
# and any pattern loose enough to catch it also catches the node process running this
# very test, which kills the suite instead of the server. The listener on the port is
# unambiguous, and it is never this script.
listening_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
  elif command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null | sed -n "s/.*:$PORT .*pid=\([0-9][0-9]*\).*/\1/p" | sort -u
  fi
}

port_busy() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
  else
    ss -ltn 2>/dev/null | grep -q ":$PORT "
  fi
}

stop_server() {
  local pids
  pids="$(listening_pids)"
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  [ -n "$pids" ] && kill $pids 2>/dev/null
  SERVER_PID=""
  for _ in $(seq 1 20); do
    port_busy || return 0
    sleep 1
  done
  [ -n "$pids" ] && kill -9 $pids 2>/dev/null
  sleep 1
}

start_server() {
  cd "$ROOT" || return 1
  TABUP_DB="$DB" TABUP_DATA_DIR="$WORK" TABUP_REGISTRATION=open \
    npx next dev -p "$PORT" >> "$LOG" 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 60); do
    curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORT/api/auth/me" && return 0
    sleep 1
  done
  echo "the server did not come up; last lines of its log:"
  tail -20 "$LOG"
  return 1
}

if port_busy; then
  echo "port $PORT is already in use; set PORT to a free one"
  exit 1
fi

start_server || exit 1

echo "Before the restart"
BASE="http://127.0.0.1:$PORT" STATE="$STATE" PHASE=setup node "$ROOT/scripts/test-restart.mjs" || exit 1

stop_server
start_server || exit 1

echo
echo "After it"
BASE="http://127.0.0.1:$PORT" STATE="$STATE" PHASE=verify node "$ROOT/scripts/test-restart.mjs"
