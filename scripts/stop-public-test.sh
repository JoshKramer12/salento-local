#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${SALENTO_RUNTIME_DIR:-$HOME/.codex/runtime/salento-local-live}"
STATE_DIR="$SOURCE_DIR/work/live-test"
SERVER_PID_FILE="$STATE_DIR/server.pid"
TUNNEL_PID_FILE="$STATE_DIR/tunnel.pid"
PUBLIC_URL_FILE="$STATE_DIR/public-url.txt"

if [ -f "$SERVER_PID_FILE" ]; then
  kill "$(cat "$SERVER_PID_FILE")" >/dev/null 2>&1 || true
  rm -f "$SERVER_PID_FILE"
fi

if [ -f "$TUNNEL_PID_FILE" ]; then
  kill "$(cat "$TUNNEL_PID_FILE")" >/dev/null 2>&1 || true
  rm -f "$TUNNEL_PID_FILE"
fi

pkill -f "cloudflared tunnel --url http://127.0.0.1:3000" >/dev/null 2>&1 || true
pkill -f "$RUNTIME_DIR/node_modules/.bin/next dev --turbopack -H 0.0.0.0 -p 3000" >/dev/null 2>&1 || true
rm -f "$PUBLIC_URL_FILE"

printf 'Public test processes stopped.\n'
