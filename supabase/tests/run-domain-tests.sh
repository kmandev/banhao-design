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
echo "==> Running M-13 restaurant availability assertions (20260904000001)"
docker cp "$REPO_ROOT/supabase/tests/restaurant_availability_test.sql" "$CONTAINER:/tmp/" >/dev/null
if ! docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 \
       -f /tmp/restaurant_availability_test.sql 2>&1 | tee /tmp/banhao-availability-out.log \
     | grep -E "PASS|FAIL|ERROR|assertions"; then
  echo "==> M-13 restaurant availability verification FAILED"
  exit 1
fi
if grep -q "FAIL" /tmp/banhao-availability-out.log; then
  echo "==> M-13 restaurant availability verification FAILED"
  exit 1
fi

echo ""
echo "==> Running AC-04 / DEC-042 customer-quoted prep estimate assertions (20260904000002)"
docker cp "$REPO_ROOT/supabase/tests/order_customer_quoted_prep_test.sql" "$CONTAINER:/tmp/" >/dev/null
if ! docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 \
       -f /tmp/order_customer_quoted_prep_test.sql 2>&1 | tee /tmp/banhao-quoted-prep-out.log \
     | grep -E "PASS|FAIL|ERROR|assertions"; then
  echo "==> AC-04 customer-quoted prep estimate verification FAILED"
  exit 1
fi
if grep -q "FAIL" /tmp/banhao-quoted-prep-out.log; then
  echo "==> AC-04 customer-quoted prep estimate verification FAILED"
  exit 1
fi

echo ""
echo "==> Running BQ-017 Slice #1 customer-arrival assertions (20260907000001)"
docker cp "$REPO_ROOT/supabase/tests/delivery_customer_arrival_test.sql" "$CONTAINER:/tmp/" >/dev/null
if ! docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 \
       -f /tmp/delivery_customer_arrival_test.sql 2>&1 | tee /tmp/banhao-arrival-out.log \
     | grep -E "PASS|FAIL|ERROR|assertions"; then
  echo "==> BQ-017 customer-arrival verification FAILED"
  exit 1
fi
if grep -q "FAIL" /tmp/banhao-arrival-out.log; then
  echo "==> BQ-017 customer-arrival verification FAILED"
  exit 1
fi

echo ""
echo "==> Running BQ-017 Slice #2 contact-attempt assertions (20260907000002)"
docker cp "$REPO_ROOT/supabase/tests/delivery_contact_attempts_test.sql" "$CONTAINER:/tmp/" >/dev/null
if ! docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 \
       -f /tmp/delivery_contact_attempts_test.sql 2>&1 | tee /tmp/banhao-contact-out.log \
     | grep -E "PASS|FAIL|ERROR|assertions"; then
  echo "==> BQ-017 contact-attempt verification FAILED"
  exit 1
fi
if grep -q "FAIL" /tmp/banhao-contact-out.log; then
  echo "==> BQ-017 contact-attempt verification FAILED"
  exit 1
fi

echo ""
echo "==> Running BQ-017 Slice #3 arrival-timeout escalation assertions (no migration; query semantics)"
docker cp "$REPO_ROOT/supabase/tests/delivery_arrival_timeout_test.sql" "$CONTAINER:/tmp/" >/dev/null
if ! docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 \
       -f /tmp/delivery_arrival_timeout_test.sql 2>&1 | tee /tmp/banhao-timeout-out.log \
     | grep -E "PASS|FAIL|ERROR|assertions"; then
  echo "==> BQ-017 arrival-timeout verification FAILED"
  exit 1
fi
if grep -q "FAIL" /tmp/banhao-timeout-out.log; then
  echo "==> BQ-017 arrival-timeout verification FAILED"
  exit 1
fi

echo ""
echo "==> Running DEC-060 reconciliation_cases refund-kind assertions (20260909000001)"
docker cp "$REPO_ROOT/supabase/tests/reconciliation_cases_refund_kinds_test.sql" "$CONTAINER:/tmp/" >/dev/null
if ! docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 \
       -f /tmp/reconciliation_cases_refund_kinds_test.sql 2>&1 | tee /tmp/banhao-reconciliation-refund-out.log \
     | grep -E "PASS|FAIL|ERROR|assertions"; then
  echo "==> DEC-060 reconciliation_cases refund-kind verification FAILED"
  exit 1
fi
if grep -q "FAIL" /tmp/banhao-reconciliation-refund-out.log; then
  echo "==> DEC-060 reconciliation_cases refund-kind verification FAILED"
  exit 1
fi

echo ""
echo "==> Seeding Q-020 Slice 4B reconciliation-case concurrency fixtures"
run_sql "$REPO_ROOT/supabase/tests/refund_reconciliation_concurrency_setup.sql"

echo "==> Launching TWO CONCURRENT reconciliation_cases inserts for the SAME (kind, payment_id)"
echo "    (both racing for PROVIDER_SUCCEEDED_LOCAL_NOT_REFUNDED / a1900000-...-0000a2)"
docker exec "$CONTAINER" psql -U postgres -d "$DB" -tAc \
  "select test_attempt_reconciliation_case_insert('PROVIDER_SUCCEEDED_LOCAL_NOT_REFUNDED', 'a1900000-0000-0000-0000-0000000000a2'::uuid, 'a1900000-0000-0000-0000-000000000002'::uuid)" \
  > /tmp/banhao-reconciliation-case-a.out 2>&1 &
CASE_A_PID=$!
docker exec "$CONTAINER" psql -U postgres -d "$DB" -tAc \
  "select test_attempt_reconciliation_case_insert('PROVIDER_SUCCEEDED_LOCAL_NOT_REFUNDED', 'a1900000-0000-0000-0000-0000000000a2'::uuid, 'a1900000-0000-0000-0000-000000000002'::uuid)" \
  > /tmp/banhao-reconciliation-case-b.out 2>&1 &
CASE_B_PID=$!
wait "$CASE_A_PID" "$CASE_B_PID"

echo "    Attempt A result: $(cat /tmp/banhao-reconciliation-case-a.out | tr -d '[:space:]')"
echo "    Attempt B result: $(cat /tmp/banhao-reconciliation-case-b.out | tr -d '[:space:]')"

CASE_A_RESULT="$(cat /tmp/banhao-reconciliation-case-a.out | tr -d '[:space:]')"
CASE_B_RESULT="$(cat /tmp/banhao-reconciliation-case-b.out | tr -d '[:space:]')"
if [[ "$CASE_A_RESULT" == "t" && "$CASE_B_RESULT" == "t" ]]; then
  echo "==> CRITICAL FAILURE: both concurrent reconciliation_cases inserts report success. reconciliation_cases_refund_open_key did NOT hold."
  exit 1
fi
if [[ "$CASE_A_RESULT" != "t" && "$CASE_B_RESULT" != "t" ]]; then
  echo "==> FAILURE: neither concurrent insert succeeded — something else is wrong."
  exit 1
fi
echo "    Exactly one concurrent insert won, as required (DEC-060 §4)."

echo ""
echo "==> Running Q-020 Slice 4B reconciliation-case concurrency assertions"
docker cp "$REPO_ROOT/supabase/tests/refund_reconciliation_concurrency_assertions.sql" "$CONTAINER:/tmp/" >/dev/null
if ! docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 \
       -f /tmp/refund_reconciliation_concurrency_assertions.sql 2>&1 | tee /tmp/banhao-reconciliation-concurrency-out.log \
     | grep -E "PASS|FAIL|ERROR|assertions"; then
  echo "==> Q-020 Slice 4B reconciliation-case concurrency verification FAILED"
  exit 1
fi
if grep -q "FAIL" /tmp/banhao-reconciliation-concurrency-out.log; then
  echo "==> Q-020 Slice 4B reconciliation-case concurrency verification FAILED"
  exit 1
fi

echo ""
echo "==> Running D-01 order-time commission snapshot assertions (20260915000001)"
docker cp "$REPO_ROOT/supabase/tests/d01_commission_snapshot_test.sql" "$CONTAINER:/tmp/" >/dev/null
if ! docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 \
       -f /tmp/d01_commission_snapshot_test.sql 2>&1 | tee /tmp/banhao-d01-out.log \
     | grep -E "PASS|FAIL|ERROR|assertions"; then
  echo "==> D-01 commission snapshot verification FAILED"
  exit 1
fi
if grep -q "FAIL" /tmp/banhao-d01-out.log; then
  echo "==> D-01 commission snapshot verification FAILED"
  exit 1
fi

# D-01 freeze vs the PAID transition — proven with two REAL concurrent
# connections, the same standard the rider race (TQ-012) is held to.
d01_sql() {
  docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -tAc "$1" | tr -d '[:space:]'
}

echo ""
echo "==> D-01 race 1: the PAID transition holds the order's row lock first"
RACE1_ORDER="$(d01_sql "select d01_legacy_order()")"
d01_sql "update public.orders set state = 'PENDING_PAYMENT' where id = '$RACE1_ORDER'" >/dev/null
docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -tAc \
  "begin; update public.orders set state = 'PAID', paid_at = now() where id = '$RACE1_ORDER' and state = 'PENDING_PAYMENT'; select pg_sleep(6); commit;" \
  > /tmp/banhao-d01-race1-a.out 2>&1 &
RACE1_A_PID=$!
sleep 1.5
RACE1_START="$(date +%s)"
RACE1_FROZEN="$(d01_sql "select count(*) from public.expire_legacy_unpaid_orders(1000) where order_id = '$RACE1_ORDER'")"
RACE1_ELAPSED=$(( $(date +%s) - RACE1_START ))
wait "$RACE1_A_PID"
RACE1_FINAL="$(d01_sql "select state from public.orders where id = '$RACE1_ORDER'")"
echo "    freeze froze it: $RACE1_FROZEN · freeze took ~${RACE1_ELAPSED}s · final state: $RACE1_FINAL"
if [[ "$RACE1_FROZEN" != "0" || "$RACE1_FINAL" != "PAID" ]]; then
  echo "==> D-01 race 1 FAILED: the freeze must skip a row the PAID transition holds, and that order must end PAID"
  exit 1
fi
if (( RACE1_ELAPSED > 3 )); then
  echo "==> D-01 race 1 FAILED: the freeze blocked on the locked row instead of skipping it (FOR UPDATE SKIP LOCKED)"
  exit 1
fi
echo "    PASS  the freeze skipped the locked row without waiting; the order is PAID (COMMISSION_SNAPSHOT_MISSING territory)."

echo ""
echo "==> D-01 race 2: the freeze holds the order's row lock first"
RACE2_ORDER="$(d01_sql "select d01_legacy_order()")"
d01_sql "update public.orders set state = 'PENDING_PAYMENT' where id = '$RACE2_ORDER'" >/dev/null
docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -tAc \
  "begin; select count(*) from public.expire_legacy_unpaid_orders(1000); select pg_sleep(4); commit;" \
  > /tmp/banhao-d01-race2-a.out 2>&1 &
RACE2_A_PID=$!
sleep 1.5
RACE2_PAID_ROWS="$(d01_sql "with paid as (update public.orders set state = 'PAID', paid_at = now() where id = '$RACE2_ORDER' and state = 'PENDING_PAYMENT' returning id) select count(*) from paid")"
wait "$RACE2_A_PID"
RACE2_FINAL="$(d01_sql "select state from public.orders where id = '$RACE2_ORDER'")"
echo "    PAID transition matched: $RACE2_PAID_ROWS row(s) · final state: $RACE2_FINAL"
if [[ "$RACE2_PAID_ROWS" != "0" || "$RACE2_FINAL" != "PAYMENT_EXPIRED" ]]; then
  echo "==> D-01 race 2 FAILED: a PAID transition racing a committed freeze must match 0 rows (LATE_PAYMENT, no money)"
  exit 1
fi
echo "    PASS  the PAID transition waited, re-checked, and matched 0 rows; the order stayed PAYMENT_EXPIRED."

echo ""
echo "==> Running DEC-065 §1 AI-operations audit dedup assertions (20260921000001)"
docker cp "$REPO_ROOT/supabase/tests/ai_ops_audit_dedup_test.sql" "$CONTAINER:/tmp/" >/dev/null
if ! docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 \
       -f /tmp/ai_ops_audit_dedup_test.sql 2>&1 | tee /tmp/banhao-ai-dedup-out.log \
     | grep -E "PASS|FAIL|ERROR|assertions"; then
  echo "==> DEC-065 AI audit dedup verification FAILED"
  exit 1
fi
if grep -q "FAIL" /tmp/banhao-ai-dedup-out.log; then
  echo "==> DEC-065 AI audit dedup verification FAILED"
  exit 1
fi

# The case AiAuditService's prior SELECT can never win: two genuinely
# concurrent connections, both reading "not handled", both inserting. Held to
# the same two-real-connections standard as the rider race (TQ-012) and the
# Q-020 Slice 4B reconciliation-case race.
echo ""
echo "==> Launching TWO CONCURRENT AI audit inserts for the SAME (action, entity_id)"
echo "    (both racing for AI_OPS_DEDUP_RACE / b5000000-...-000000ff)"
docker exec "$CONTAINER" psql -U postgres -d "$DB" -tAc \
  "select test_attempt_ai_audit_insert('AI_OPS_DEDUP_RACE', 'b5000000-0000-4000-8000-0000000000ff'::uuid)" \
  > /tmp/banhao-ai-dedup-race-a.out 2>&1 &
AI_RACE_A_PID=$!
docker exec "$CONTAINER" psql -U postgres -d "$DB" -tAc \
  "select test_attempt_ai_audit_insert('AI_OPS_DEDUP_RACE', 'b5000000-0000-4000-8000-0000000000ff'::uuid)" \
  > /tmp/banhao-ai-dedup-race-b.out 2>&1 &
AI_RACE_B_PID=$!
wait "$AI_RACE_A_PID" "$AI_RACE_B_PID"

AI_RACE_A_RESULT="$(cat /tmp/banhao-ai-dedup-race-a.out | tr -d '[:space:]')"
AI_RACE_B_RESULT="$(cat /tmp/banhao-ai-dedup-race-b.out | tr -d '[:space:]')"
echo "    Attempt A result: $AI_RACE_A_RESULT"
echo "    Attempt B result: $AI_RACE_B_RESULT"

if [[ "$AI_RACE_A_RESULT" == "t" && "$AI_RACE_B_RESULT" == "t" ]]; then
  echo "==> CRITICAL FAILURE: both concurrent AI audit inserts report success. audit_logs_ai_action_entity_key did NOT hold."
  exit 1
fi
if [[ "$AI_RACE_A_RESULT" != "t" && "$AI_RACE_B_RESULT" != "t" ]]; then
  echo "==> FAILURE: neither concurrent AI audit insert succeeded — something else is wrong."
  exit 1
fi
echo "    Exactly one concurrent insert won, as required (DEC-065 §1)."

echo ""
echo "==> Running DEC-065 §1 AI audit dedup concurrency assertions"
docker cp "$REPO_ROOT/supabase/tests/ai_ops_audit_dedup_concurrency_assertions.sql" "$CONTAINER:/tmp/" >/dev/null
if ! docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 \
       -f /tmp/ai_ops_audit_dedup_concurrency_assertions.sql 2>&1 | tee /tmp/banhao-ai-dedup-concurrency-out.log \
     | grep -E "PASS|FAIL|ERROR|assertions"; then
  echo "==> DEC-065 AI audit dedup concurrency verification FAILED"
  exit 1
fi
if grep -q "FAIL" /tmp/banhao-ai-dedup-concurrency-out.log; then
  echo "==> DEC-065 AI audit dedup concurrency verification FAILED"
  exit 1
fi

echo ""
echo "==> ALL DOMAIN + VIEW ROW-ISOLATION + RIDER RACE + REASSIGNMENT ATOMICITY + ORDER CREATION + MERCHANT CATALOG WRITE + AI-01 AUDIT ACTOR + M-AV AVAILABILITY + AC-04 CUSTOMER QUOTE + BQ-017 CUSTOMER ARRIVAL + CONTACT ATTEMPTS + ARRIVAL TIMEOUT + DEC-060 RECONCILIATION REFUND-KIND + Q-020 SLICE 4B RECONCILIATION-CASE CONCURRENCY + D-01 COMMISSION SNAPSHOT + D-01 FREEZE RACE + DEC-065 AI AUDIT DEDUP VERIFICATION PASSED"
