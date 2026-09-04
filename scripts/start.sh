#!/bin/sh
# Start kontenera: migracje, seed przy pustej bazie, serwer.
# Demo trzyma dane na wolumenie /data. Gdy schemat rozjedzie się ze zbiorem migracji
# (a przy demie zmieniamy go swobodnie), odtwarzamy bazę od zera zamiast wywalać aplikację.
set -e
cd /app

DB_PATH=$(printf '%s' "${DATABASE_URI:-file:/data/payload.db}" | sed 's|^file:||')
MEDIA_PATH="${MEDIA_DIR:-/data/media}"

if ! pnpm exec payload migrate; then
  echo "[start] Migracja nie przeszła na istniejącej bazie demo — odtwarzam ją od zera."
  rm -f "$DB_PATH" "$DB_PATH-shm" "$DB_PATH-wal"
  rm -rf "$MEDIA_PATH"
  pnpm exec payload migrate
fi

pnpm exec tsx scripts/seed.ts || echo "[start] seed pominięty"
exec pnpm exec next start -p 3000
