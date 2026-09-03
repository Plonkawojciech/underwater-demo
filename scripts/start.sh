#!/bin/sh
# Migracje schematu, seed przy pustej bazie, start serwera.
set -e
cd /app
pnpm exec payload migrate
pnpm exec tsx scripts/seed.ts || echo "[start] seed pominięty"
exec pnpm exec next start -p 3000
