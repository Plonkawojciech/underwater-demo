#!/bin/sh
# Preserve the database and media when a migration fails.
set -eu
cd /app

if ! pnpm exec payload migrate; then
  echo "[start] Migration failed. Database and media were preserved; refusing to start." >&2
  exit 1
fi

# Demo seeding is an explicit operator action, never part of application startup.
exec pnpm exec next start -p 3000
