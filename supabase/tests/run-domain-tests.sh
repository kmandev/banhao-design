#!/usr/bin/env bash
#
# BANHAO — execute the Supabase Migration v1 domain verification.
#
#   ./supabase/tests/run-domain-tests.sh
#
# Spins up a throwaway PostgreSQL 16 + PostGIS container (independent of
# run-rls-tests.sh's container — different name, no interaction), applies
# the auth shim and EVERY migration in supabase/migrations/ in order,
# then runs:
#
#   1. domain_invariants_test.sql — identity, cart, order snapshot,
#      payment idempotency, ledger, and representative RLS checks.
#   2. rider_race_setup.sql — fixtures and helper functions.
#   3. TWO REAL, CONCURRENT psql client processes, both attempting to claim
#      the SAME delivery at the same time — this is what proves the rider
#      race protection by execution (TQ-012), not by reading the SQL.
#   4. rider_race_assertions.sql — checks the outcome, including a
#      deliberate reproduction of the architecture review's HIGH finding
#      (incomplete release makes a delivery permanently unassignable) and
#      its fix, both proven by execution.
#   5. rider_reassignment_atomicity_test.sql — HIGH-2 fix (Architect Review,
#      Step 7.2): proves public.release_rider_assignment() makes the release
#      invariant atomic, cases A-E.
#
# This does NOT touch the live/remote Supabase project. It never runs
# `supabase db push` or `supabase link`.

set -euo pipefail

CONTAINER="${CONTAINER:-banhao-domain-test}"
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

echo "==> Applying every migration in supabase/migrations/, in order"
for migration in "$REPO_ROOT"/supabase/migrations/*.sql; do
  echo "    - $(basename "$migration")"
  run_sql "$migration"
done

echo "==> Running domain invariant assertions"
docker cp "$REPO_ROOT/supabase/tests/domain_invariants_test.sql" "$CONTAINER:/tmp/" >/dev/null
if ! docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 \
       -f /tmp/domain_invariants_test.sql 2>&1 | tee /tmp/banhao-domain-out.log \
     | grep -E "PASS|FAIL|ERROR|assertions"; then
  echo "==> Domain invariant verification FAILED"
  exit 1
fi
if grep -q "FAIL" /tmp/banhao-domain-out.log; then
  echo "==> Domain invariant verification FAILED"
  exit 1
fi

echo ""
echo "==> Seeding rider race condition fixtures"
run_sql "$REPO_ROOT/supabase/tests/rider_race_setup.sql"

echo "==> Launching TWO CONCURRENT client connections claiming the same delivery"
echo "    (Rider A and Rider B both attempt delivery f1000000-...-0001)"
docker exec "$CONTAINER" psql -U postgres -d "$DB" -tAc \
  "select test_attempt_claim('f1000000-0000-0000-0000-000000000001'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid)" \
  > /tmp/banhao-claim-a.out 2>&1 &
CLAIM_A_PID=$!
docker exec "$CONTAINER" psql -U postgres -d "$DB" -tAc \
  "select test_attempt_claim('f1000000-0000-0000-0000-000000000001'::uuid, 'c1000000-0000-0000-0000-000000000002'::uuid)" \
  > /tmp/banhao-claim-b.out 2>&1 &
CLAIM_B_PID=$!
wait "$CLAIM_A_PID" "$CLAIM_B_PID"

echo "    Rider A result: $(cat /tmp/banhao-claim-a.out | tr -d '[:space:]')"
echo "    Rider B result: $(cat /tmp/banhao-claim-b.out | tr -d '[:space:]')"

A_RESULT="$(cat /tmp/banhao-claim-a.out | tr -d '[:space:]')"
B_RESULT="$(cat /tmp/banhao-claim-b.out | tr -d '[:space:]')"
if [[ "$A_RESULT" == "t" && "$B_RESULT" == "t" ]]; then
  echo "==> CRITICAL FAILURE: both concurrent claims report success. Rider race protection did NOT hold."
  exit 1
fi
if [[ "$A_RESULT" != "t" && "$B_RESULT" != "t" ]]; then
  echo "==> FAILURE: neither concurrent claim succeeded — something else is wrong."
  exit 1
fi
echo "    Exactly one concurrent claim won, as required."

echo ""
echo "==> Running rider race condition assertions (outcome + backstop + reassignment + the review's found bug and its fix)"
docker cp "$REPO_ROOT/supabase/tests/rider_race_assertions.sql" "$CONTAINER:/tmp/" >/dev/null
if ! docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 \
       -f /tmp/rider_race_assertions.sql 2>&1 | tee /tmp/banhao-race-out.log \
     | grep -E "PASS|FAIL|ERROR|assertions"; then
  echo "==> Rider race condition verification FAILED"
  exit 1
fi
if grep -q "FAIL" /tmp/banhao-race-out.log; then
  echo "==> Rider race condition verification FAILED"
  exit 1
fi

echo ""
echo "==> Running rider reassignment atomicity assertions (HIGH-2 fix, Architect Review Step 7.2)"
docker cp "$REPO_ROOT/supabase/tests/rider_reassignment_atomicity_test.sql" "$CONTAINER:/tmp/" >/dev/null
if ! docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 \
       -f /tmp/rider_reassignment_atomicity_test.sql 2>&1 | tee /tmp/banhao-reassign-out.log \
     | grep -E "PASS|FAIL|ERROR|assertions"; then
  echo "==> Rider reassignment atomicity verification FAILED"
  exit 1
fi
if grep -q "FAIL" /tmp/banhao-reassign-out.log; then
  echo "==> Rider reassignment atomicity verification FAILED"
  exit 1
fi

echo ""
echo "==> ALL DOMAIN + RIDER RACE + REASSIGNMENT ATOMICITY VERIFICATION PASSED"
