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
#      payment idempotency, ledger, and representative RLS checks
#      (including §G, the HIGH-1 rider column/row checks).
#   2. rider_view_row_isolation_security_test.sql — HIGH-1 fix (Architect
#      Review, Step 7.3, finding H-1): reproduces the error-oracle probe
#      that showed a rider-supplied predicate could be evaluated ahead of
#      the view's row-security predicate, and asserts it no longer can be,
#      now that the rider views are security_barrier.
#   3. rider_race_setup.sql — fixtures and helper functions.
#   4. TWO REAL, CONCURRENT psql client processes, both attempting to claim
#      the SAME delivery at the same time — this is what proves the rider
#      race protection by execution (TQ-012), not by reading the SQL.
#   5. rider_race_assertions.sql — checks the outcome, including a
#      deliberate reproduction of the architecture review's HIGH finding
#      (incomplete release makes a delivery permanently unassignable) and
#      its fix, both proven by execution.
#   6. rider_reassignment_atomicity_test.sql — HIGH-2 fix (Architect Review,
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
echo "==> Running rider view row-isolation security test (H-1 fix, Architect Review Step 7.3)"
docker cp "$REPO_ROOT/supabase/tests/rider_view_row_isolation_security_test.sql" "$CONTAINER:/tmp/" >/dev/null
if ! docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 \
       -f /tmp/rider_view_row_isolation_security_test.sql 2>&1 | tee /tmp/banhao-oracle-out.log \
     | grep -E "PASS|FAIL|ERROR|assertions"; then
  echo "==> Rider view row-isolation security verification FAILED"
  exit 1
fi
if grep -q "FAIL" /tmp/banhao-oracle-out.log; then
  echo "==> Rider view row-isolation security verification FAILED"
  exit 1
fi

echo ""
echo "==> Running catalog availability assertions (PC-Q-001 Option A)"
docker cp "$REPO_ROOT/supabase/tests/catalog_availability_test.sql" "$CONTAINER:/tmp/" >/dev/null
if ! docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 \
       -f /tmp/catalog_availability_test.sql 2>&1 | tee /tmp/banhao-catalog-out.log \
     | grep -E "PASS|FAIL|ERROR|assertions"; then
  echo "==> Catalog availability verification FAILED"
  exit 1
fi
if grep -q "FAIL" /tmp/banhao-catalog-out.log; then
  echo "==> Catalog availability verification FAILED"
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
echo "==> Seeding Phase E-1 order-creation fixtures"
run_sql "$REPO_ROOT/supabase/tests/order_creation_setup.sql"

echo "==> Launching TWO CONCURRENT create_order() calls (DEC-E-03 order_number race proof)"
echo "    (CUST_C1 and CUST_C2 both create an order on the same business day at once)"
docker exec "$CONTAINER" psql -U postgres -d "$DB" -tAc \
  "select set_config('role','service_role',true); select order_number from public.create_order('a9000000-0000-0000-0000-000000000010'::uuid, 'a9500000-0000-0000-0000-000000000010'::uuid, 'ONLINE', 1500::bigint, 500::bigint)" \
  > /tmp/banhao-order-conc-1.out 2>&1 &
ORDER_CONC1_PID=$!
docker exec "$CONTAINER" psql -U postgres -d "$DB" -tAc \
  "select set_config('role','service_role',true); select order_number from public.create_order('a9000000-0000-0000-0000-000000000011'::uuid, 'a9500000-0000-0000-0000-000000000011'::uuid, 'ONLINE', 1500::bigint, 500::bigint)" \
  > /tmp/banhao-order-conc-2.out 2>&1 &
ORDER_CONC2_PID=$!
wait "$ORDER_CONC1_PID" "$ORDER_CONC2_PID"

echo "    CUST_C1 result: $(cat /tmp/banhao-order-conc-1.out | tr -d '[:space:]')"
echo "    CUST_C2 result: $(cat /tmp/banhao-order-conc-2.out | tr -d '[:space:]')"

echo ""
echo "==> Running Phase E-1 order-creation assertions (DEC-E-01..05, create_order())"
docker cp "$REPO_ROOT/supabase/tests/order_creation_test.sql" "$CONTAINER:/tmp/" >/dev/null
if ! docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 \
       -f /tmp/order_creation_test.sql 2>&1 | tee /tmp/banhao-order-creation-out.log \
     | grep -E "PASS|FAIL|ERROR|assertions"; then
  echo "==> Phase E-1 order-creation verification FAILED"
  exit 1
fi
if grep -q "FAIL" /tmp/banhao-order-creation-out.log; then
  echo "==> Phase E-1 order-creation verification FAILED"
  exit 1
fi

echo ""
echo "==> Running M-11/M-12 merchant catalog write assertions (20260901000002)"
docker cp "$REPO_ROOT/supabase/tests/merchant_catalog_write_test.sql" "$CONTAINER:/tmp/" >/dev/null
if ! docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 \
       -f /tmp/merchant_catalog_write_test.sql 2>&1 | tee /tmp/banhao-merchant-catalog-out.log \
     | grep -E "PASS|FAIL|ERROR|assertions"; then
  echo "==> M-11/M-12 merchant catalog write verification FAILED"
  exit 1
fi
if grep -q "FAIL" /tmp/banhao-merchant-catalog-out.log; then
  echo "==> M-11/M-12 merchant catalog write verification FAILED"
  exit 1
fi

echo ""
echo "==> Running AI-01 audit_logs actor_type assertions (20260903000001)"
docker cp "$REPO_ROOT/supabase/tests/audit_logs_ai_actor_test.sql" "$CONTAINER:/tmp/" >/dev/null
if ! docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 \
       -f /tmp/audit_logs_ai_actor_test.sql 2>&1 | tee /tmp/banhao-audit-ai-out.log \
     | grep -E "PASS|FAIL|ERROR|assertions"; then
  echo "==> AI-01 audit_logs actor_type verification FAILED"
  exit 1
fi
if grep -q "FAIL" /tmp/banhao-audit-ai-out.log; then
  echo "==> AI-01 audit_logs actor_type verification FAILED"
  exit 1
fi

echo ""
echo "==> ALL DOMAIN + VIEW ROW-ISOLATION + RIDER RACE + REASSIGNMENT ATOMICITY + ORDER CREATION + MERCHANT CATALOG WRITE + AI-01 AUDIT ACTOR VERIFICATION PASSED"
