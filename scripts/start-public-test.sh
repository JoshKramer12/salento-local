#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${SALENTO_RUNTIME_DIR:-$HOME/.codex/runtime/salento-local-live}"
STATE_DIR="$SOURCE_DIR/work/live-test"
SERVER_LOG="$STATE_DIR/server.log"
TUNNEL_LOG="$STATE_DIR/tunnel.log"
SERVER_PID_FILE="$STATE_DIR/server.pid"
TUNNEL_PID_FILE="$STATE_DIR/tunnel.pid"
PUBLIC_URL_FILE="$STATE_DIR/public-url.txt"
NODE_BIN_DIR="/opt/homebrew/opt/node@20/bin"
CLOUDFLARED_BIN="$(command -v cloudflared)"

mkdir -p "$STATE_DIR" "$RUNTIME_DIR"
: >"$SERVER_LOG"
: >"$TUNNEL_LOG"
rm -f "$PUBLIC_URL_FILE"

rsync -a \
  --exclude '.git/' \
  --exclude '.next/' \
  --exclude 'node_modules/' \
  --exclude 'outputs/' \
  --exclude 'reports/' \
  --exclude 'work/' \
  "$SOURCE_DIR"/ "$RUNTIME_DIR"/

if [ ! -x "$RUNTIME_DIR/node_modules/.bin/next" ]; then
  (cd "$RUNTIME_DIR" && PATH="$NODE_BIN_DIR:$PATH" npm install)
fi

stop_pid_file() {
  local pid_file="$1"

  if [ -f "$pid_file" ]; then
    kill "$(cat "$pid_file")" >/dev/null 2>&1 || true
    rm -f "$pid_file"
  fi
}

start_server() {
  local public_url="$1"

  nohup bash -lc "
    cd '$RUNTIME_DIR'
    export PATH='$NODE_BIN_DIR':\$PATH
    export APP_URL='$public_url'
    export AUTH_URL='$public_url'
    export NEXTAUTH_URL='$public_url'
    export NEXT_PUBLIC_APP_URL='$public_url'
    exec '$RUNTIME_DIR/node_modules/.bin/next' dev --turbopack -H 0.0.0.0 -p 3000
  " >"$SERVER_LOG" 2>&1 &
  echo $! >"$SERVER_PID_FILE"
}

wait_for_local_health() {
  for _ in $(seq 1 90); do
    if curl -fsS "http://127.0.0.1:3000/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  return 1
}

stop_pid_file "$SERVER_PID_FILE"
stop_pid_file "$TUNNEL_PID_FILE"

pkill -f "$RUNTIME_DIR/node_modules/.bin/next dev --turbopack -H 0.0.0.0 -p 3000" >/dev/null 2>&1 || true
pkill -f "cloudflared tunnel --url http://127.0.0.1:3000" >/dev/null 2>&1 || true

sleep 1

start_server "http://127.0.0.1:3000"

wait_for_local_health
curl -fsS "http://127.0.0.1:3000/api/health" >/dev/null

nohup python3 "$SOURCE_DIR/scripts/run-with-pty.py" "$TUNNEL_LOG" \
  "$CLOUDFLARED_BIN" tunnel --url "http://127.0.0.1:3000" --no-autoupdate &
echo $! >"$TUNNEL_PID_FILE"

PUBLIC_URL=""
for _ in $(seq 1 60); do
  if [ -f "$TUNNEL_LOG" ]; then
    PUBLIC_URL="$(grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' "$TUNNEL_LOG" | tail -n 1 || true)"
  fi

  if [ -n "$PUBLIC_URL" ]; then
    break
  fi

  sleep 1
done

[ -n "$PUBLIC_URL" ]
printf '%s\n' "$PUBLIC_URL" >"$PUBLIC_URL_FILE"

stop_pid_file "$SERVER_PID_FILE"
start_server "$PUBLIC_URL"
wait_for_local_health

PUBLIC_HEALTH_CHECK_PASSED="false"
for _ in $(seq 1 30); do
  if curl -fsS "${PUBLIC_URL}/api/health" >/dev/null 2>&1; then
    PUBLIC_HEALTH_CHECK_PASSED="true"
    break
  fi
  sleep 2
done

printf 'Public URL: %s\n' "$PUBLIC_URL"
if [ "$PUBLIC_HEALTH_CHECK_PASSED" != "true" ]; then
  printf 'Public URL check is still waiting on Cloudflare DNS propagation. If the link does not open yet, wait 30-60 seconds and try again.\n'
fi
printf 'Server log: %s\n' "$SERVER_LOG"
printf 'Tunnel log: %s\n' "$TUNNEL_LOG"
