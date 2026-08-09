#!/usr/bin/env bash
#
# BANHAO — execute the profiles RLS verification.
#
#   ./supabase/tests/run-rls-tests.sh
#
# Spins up a throwaway PostgreSQL 16 + PostGIS container, applies the auth shim
# and every migration in order, then runs the assertions. Exits non-zero if any
# assertion fails.
#
# Why a plain Postgres container rather than `supabase start`: RLS, column
# privileges, and policy recursion are core PostgreSQL behaviours. The shim
# (supabase/tests/00_shim_supabase_auth.sql) provides the only Supabase pieces
# the policies touch — auth.uid() and the anon/authenticated/service_role roles.
# This runs in seconds and needs no Supabase login.
#
# LIMITATION: this does NOT exercise Supabase's own GoTrue auth service, real
# JWT verification, or PostgREST. It verifies the database-level authorization
# rules only. End-to-end auth against a live Supabase project is still unverified.

set -euo pipefail

CONTAINER="${CONTAINER:-banhao-rls-test}"
IMAGE="${IMAGE:-postgis/postgis:16-3.4}"
DB="${DB:-banhao_test}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cleanup() {
  if [[ "${KEEP_CONTAINER:-0}" != "1" ]]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "==> Starting $IMAGE as $CONTAINER"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB="$DB" \
  "$IMAGE" >/dev/null

echo "==> Waiting for PostgreSQL"
# pg_isready goes true during the image's own init phase, while its PostGIS
# bootstrap is still running — starting migrations then races that script.
# Wait for the entrypoint's completion marker first, then for readiness.
for _ in $(seq 1 90); do
  if docker logs "$CONTAINER" 2>&1 | grep -q "init process complete"; then break; fi
  sleep 1
done
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U postgres >/dev/null

run_sql() {
  docker cp "$1" "$CONTAINER:/tmp/$(basename "$1")" >/dev/null
  docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q \
    -f "/tmp/$(basename "$1")"
}

echo "==> Applying Supabase auth shim"
run_sql "$REPO_ROOT/supabase/tests/00_shim_supabase_auth.sql"

echo "==> Applying migrations"
for migration in "$REPO_ROOT"/supabase/migrations/*.sql; do
  echo "    - $(basename "$migration")"
  run_sql "$migration"
done

echo "==> Running RLS assertions"
docker cp "$REPO_ROOT/supabase/tests/rls_profiles_test.sql" "$CONTAINER:/tmp/" >/dev/null
if docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 \
     -f /tmp/rls_profiles_test.sql 2>&1 | grep -E "PASS|FAIL|ERROR|assertions"; then
  echo ""
  echo "==> RLS verification PASSED"
else
  echo ""
  echo "==> RLS verification FAILED"
  exit 1
fi
