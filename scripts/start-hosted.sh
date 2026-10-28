#!/usr/bin/env sh
set -eu

APP_ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
DATABASE_FILE="/data/prisma/dev.db"
PUBLIC_UPLOADS_DIR="$APP_ROOT/public/uploads"
PERSISTENT_UPLOADS_DIR="/data/uploads"
PUBLIC_APP_URL=${APP_URL:-}

if [ -z "$PUBLIC_APP_URL" ] && [ -n "${NEXT_PUBLIC_APP_URL:-}" ]; then
  PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
fi

if [ -z "$PUBLIC_APP_URL" ] && [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
  PUBLIC_APP_URL="https://${RAILWAY_PUBLIC_DOMAIN}"
fi

if [ -z "$PUBLIC_APP_URL" ] && [ -n "${FLY_APP_NAME:-}" ]; then
  PUBLIC_APP_URL="https://${FLY_APP_NAME}.fly.dev"
fi

export DATABASE_URL="${DATABASE_URL:-file:${DATABASE_FILE}}"
STORAGE_IDENTITY=$(node "$APP_ROOT/scripts/validate-hosted-storage.mjs")

if [ -n "$PUBLIC_APP_URL" ]; then
  export APP_URL="${APP_URL:-$PUBLIC_APP_URL}"
  export NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-$PUBLIC_APP_URL}"
  export AUTH_URL="${AUTH_URL:-$PUBLIC_APP_URL}"
  export NEXTAUTH_URL="${NEXTAUTH_URL:-$PUBLIC_APP_URL}"
fi

if [ ! -L "$PUBLIC_UPLOADS_DIR" ]; then
  ln -s "$PERSISTENT_UPLOADS_DIR" "$PUBLIC_UPLOADS_DIR"
fi

"$APP_ROOT/node_modules/.bin/prisma" migrate deploy

if [ "$(node "$APP_ROOT/scripts/validate-hosted-storage.mjs")" != "$STORAGE_IDENTITY" ]; then
  echo "Hosted storage preflight failed [DB_REPLACED]: database identity changed during startup" >&2
  exit 1
fi

exec "$APP_ROOT/node_modules/.bin/next" start -H 0.0.0.0 -p "${PORT:-3000}"
