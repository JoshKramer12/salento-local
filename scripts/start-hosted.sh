#!/usr/bin/env sh
set -eu

APP_ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
PERSISTENT_ROOT=${PERSISTENT_ROOT:-${RAILWAY_VOLUME_MOUNT_PATH:-"$APP_ROOT/.persistent"}}
DATA_ROOT=${APP_DATA_ROOT:-"$PERSISTENT_ROOT"}
DATABASE_DIR="$DATA_ROOT/prisma"
DATABASE_FILE="$DATABASE_DIR/dev.db"
SOURCE_DATABASE="$APP_ROOT/prisma/dev.db"
BUNDLED_UPLOADS_DIR="$APP_ROOT/public/uploads"
PERSISTENT_UPLOADS_DIR="$DATA_ROOT/uploads"
UPLOAD_BOOTSTRAP_MARKER="$PERSISTENT_UPLOADS_DIR/.bootstrap-complete"
PUBLIC_APP_URL=${APP_URL:-}
BOOTSTRAP_BUNDLED_DATA=${BOOTSTRAP_BUNDLED_DATA:-true}

if [ -z "$PUBLIC_APP_URL" ] && [ -n "${NEXT_PUBLIC_APP_URL:-}" ]; then
  PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
fi

if [ -z "$PUBLIC_APP_URL" ] && [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
  PUBLIC_APP_URL="https://${RAILWAY_PUBLIC_DOMAIN}"
fi

if [ -z "$PUBLIC_APP_URL" ] && [ -n "${FLY_APP_NAME:-}" ]; then
  PUBLIC_APP_URL="https://${FLY_APP_NAME}.fly.dev"
fi

mkdir -p "$DATABASE_DIR" "$PERSISTENT_UPLOADS_DIR/submissions"

if [ "$BOOTSTRAP_BUNDLED_DATA" = "true" ] && [ ! -s "$DATABASE_FILE" ] && [ -s "$SOURCE_DATABASE" ]; then
  cp "$SOURCE_DATABASE" "$DATABASE_FILE"
fi

if [ "$BOOTSTRAP_BUNDLED_DATA" = "true" ] && [ -d "$BUNDLED_UPLOADS_DIR" ] && [ ! -e "$UPLOAD_BOOTSTRAP_MARKER" ]; then
  cp -R "$BUNDLED_UPLOADS_DIR"/. "$PERSISTENT_UPLOADS_DIR"/ 2>/dev/null || true
  : >"$UPLOAD_BOOTSTRAP_MARKER"
fi

if [ -L "$BUNDLED_UPLOADS_DIR" ]; then
  :
else
  if [ -d "$BUNDLED_UPLOADS_DIR" ]; then
    rm -rf "$BUNDLED_UPLOADS_DIR"
  fi
  ln -s "$PERSISTENT_UPLOADS_DIR" "$BUNDLED_UPLOADS_DIR"
fi

export DATABASE_URL="${DATABASE_URL:-file:${DATABASE_FILE}}"

if [ -n "$PUBLIC_APP_URL" ]; then
  export APP_URL="${APP_URL:-$PUBLIC_APP_URL}"
  export NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-$PUBLIC_APP_URL}"
  export AUTH_URL="${AUTH_URL:-$PUBLIC_APP_URL}"
  export NEXTAUTH_URL="${NEXTAUTH_URL:-$PUBLIC_APP_URL}"
fi

if [ -x "$APP_ROOT/node_modules/.bin/prisma" ] && [ "${DATABASE_SCHEMA_SYNC:-migrate}" = "push" ]; then
  "$APP_ROOT/node_modules/.bin/prisma" db push --skip-generate
elif [ -x "$APP_ROOT/node_modules/.bin/prisma" ]; then
  PRISMA_LOG=$(mktemp)

  if ! "$APP_ROOT/node_modules/.bin/prisma" migrate deploy >"$PRISMA_LOG" 2>&1; then
    cat "$PRISMA_LOG" >&2

    if grep -q "Error: P3009" "$PRISMA_LOG" &&
      grep -q "20260714171000_add_legal_acceptances" "$PRISMA_LOG"; then
      "$APP_ROOT/node_modules/.bin/prisma" migrate resolve \
        --applied 20260714171000_add_legal_acceptances
      "$APP_ROOT/node_modules/.bin/prisma" migrate deploy
    else
      rm -f "$PRISMA_LOG"
      exit 1
    fi
  fi

  rm -f "$PRISMA_LOG"
fi

exec "$APP_ROOT/node_modules/.bin/next" start -H 0.0.0.0 -p "${PORT:-3000}"
