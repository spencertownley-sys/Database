#!/bin/sh
set -e

echo "[start] applying migrations..."
npx drizzle-kit migrate

echo "[start] seeding (no-op if data already exists)..."
npx tsx src/db/seed.ts

echo "[start] starting Next.js..."
exec npx next start -p "${PORT:-3000}"
