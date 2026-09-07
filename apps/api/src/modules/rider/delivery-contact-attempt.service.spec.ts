import { DeliveryContactAttemptService } from './delivery-contact-attempt.service';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * `POST /api/v1/rider/deliveries/:id/contact-attempt` — BQ-017 Slice #2,
 * DEC-053 § 3's evidence.
 *
 * The stub models the two shapes this service uses: a `maybeSingle()` read or
 * insert, and a `select(..., { count: 'exact', head: true })` count. Both are
 * queued from the same result list, in call order, so a test states exactly
 * what the database answers at each step.
 */

type Result = {
  data?: unknown;
  count?: number | null;
  error: { message: string; code?: string } | null;
};

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update' | 'count';
  eq: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

function supabaseStub(results: Result[]) {
  const calls: Recorded[] = [];
  let index = 0;
  const nextResult = (): Result => results[index++] ?? { data: null, count: 0, error: null };

  const admin = {
    from(table: string) {
      const call: Recorded = { table, op: 'select', eq: {} };
      calls.push(call);

      const builder: Record<string, unknown> = {
        select(_columns?: string, options?: { count?: string; head?: boolean }) {
          if (options?.count) {
            call.op = 'count';
          }
          return builder;
        },
        insert(payload: Record<string, unknown>) {
          call.op = 'insert';
          call.payload = payload;
          return builder;
        },
        update(payload: Record<string, unknown>) {
          call.op = 'update';
          call.payload = payload;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.eq[column] = value;
          // A head-count resolves on the terminal `.eq()`, since nothing
          // further is chained onto it.
          if (call.op === 'count') {
            return Promise.resolve(nextResult());
          }
          return builder;
        },
        maybeSingle: () => Promise.resolve(nextResult()),
        then: (resolve: (r: Result) => unknown) => Promise.resolve(nextResult()).then(resolve),
      };

      return builder;
    },
  };

  return { supabase: { admin } as unknown as SupabaseService, calls };
}

const RIDER_ID = 'rider-1';
const OTHER_RIDER_ID = 'rider-2';
const DELIVERY_ID = 'delivery-1';

function riderUser(riderId: string | null = RIDER_ID): AuthenticatedUser {
  return {
    id: 'user-1',
    phone: '+66812345678',
    capabilities: {
      customer: true,
      merchant: [],
      rider: riderId ? { riderId } : null,
      platformStaff: null,
    },
  };
}

/** The eligibility read: a delivery at the customer's door, owned by this rider. */
function arrivedDelivery(riderId: string | null = RIDER_ID): Result {
  return { data: { id: DELIVERY_ID, state: 'ARRIVED', rider_id: riderId }, error: null };
}

function delivery(state: string, riderId: string | null = RIDER_ID): Result {
  return { data: { id: DELIVERY_ID, state, rider_id: riderId }, error: null };
}

/** How many attempts the delivery already holds. */
function attemptCount(count: number): Result {
  return { data: null, count, error: null };
}

/** A successful insert, echoing the row back. */
function inserted(attemptNo: number): Result {
  return {
    data: {
      id: `attempt-${attemptNo}`,
      attempt_no: attemptNo,
      attempted_at: `2026-09-07T10:0${attemptNo}:00.000Z`,
    },
    error: null,
  };
}

/** What the `(delivery_id, attempt_no)` unique constraint raises on a concurrent tie. */
const UNIQUE_VIOLATION: Result = {
  data: null,
  error: { message: 'duplicate key value violates unique constraint', code: '23505' },
};

async function expectDomainError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await promise.catch((error: DomainError) => expect(error.code).toBe(code));
}

describe('DeliveryContactAttemptService — recording attempts', () => {
  it('records the first attempt as attempt_no 1', async () => {
    const { supabase, calls } = supabaseStub([arrivedDelivery(), attemptCount(0), inserted(1)]);

    const result = await new DeliveryContactAttemptService(supabase).recordContactAttempt(
      riderUser(),
      DELIVERY_ID,
    );

    expect(result).toEqual({
      deliveryId: DELIVERY_ID,
      attemptNo: 1,
      attemptedAt: '2026-09-07T10:01:00.000Z',
      attemptsRecorded: 1,
      attemptsRequired: 2,
      riderId: RIDER_ID,
    });

    const insert = calls.find((c) => c.op === 'insert');
    expect(insert?.table).toBe('delivery_contact_attempts');
    expect(insert?.payload).toEqual({
      delivery_id: DELIVERY_ID,
      rider_id: RIDER_ID,
      attempt_no: 1,
    });
  });

  it('records the second attempt as attempt_no 2, and reports the requirement met', async () => {
    const { supabase, calls } = supabaseStub([arrivedDelivery(), attemptCount(1), inserted(2)]);

    const result = await new DeliveryContactAttemptService(supabase).recordContactAttempt(
      riderUser(),
      DELIVERY_ID,
    );

    expect(result.attemptNo).toBe(2);
    expect(result.attemptsRecorded).toBe(2);
    expect(result.attemptsRequired).toBe(2);
    expect(calls.find((c) => c.op === 'insert')?.payload).toMatchObject({ attempt_no: 2 });
  });

  it('never supplies attempted_at — the server clock is the evidence, not the client’s', async () => {
    const { supabase, calls } = supabaseStub([arrivedDelivery(), attemptCount(0), inserted(1)]);

    await new DeliveryContactAttemptService(supabase).recordContactAttempt(riderUser(), DELIVERY_ID);

    expect(calls.find((c) => c.op === 'insert')?.payload).not.toHaveProperty('attempted_at');
  });

  it('records the attempt and nothing else — no state, order, or financial write', async () => {
    const { supabase, calls } = supabaseStub([arrivedDelivery(), attemptCount(0), inserted(1)]);

    await new DeliveryContactAttemptService(supabase).recordContactAttempt(riderUser(), DELIVERY_ID);

    // The delivery is read, never written.
    expect(calls.filter((c) => c.table === 'deliveries' && c.op !== 'select')).toHaveLength(0);

    for (const forbidden of [
      'orders',
      'order_status_history',
      'delivery_status_history',
      'rider_assignments',
      'rider_availability',
      'payments',
      'refunds',
      'ledger_entries',
      'ledger_entry_groups',
      'outbox',
      'notifications',
      'audit_logs',
    ]) {
      expect(calls.find((c) => c.table === forbidden)).toBeUndefined();
    }
  });

  /**
   * Two genuine attempts are two rows. Nothing deduplicates them, because
   * DEC-053 counts attempts and two calls a minute apart are two pieces of
   * evidence an operator will read.
   */
  it('treats a repeated request as a second genuine attempt, not a duplicate to swallow', async () => {
    const first = supabaseStub([arrivedDelivery(), attemptCount(0), inserted(1)]);
    const second = supabaseStub([arrivedDelivery(), attemptCount(1), inserted(2)]);

    const one = await new DeliveryContactAttemptService(first.supabase).recordContactAttempt(
      riderUser(),
      DELIVERY_ID,
    );
    const two = await new DeliveryContactAttemptService(second.supabase).recordContactAttempt(
      riderUser(),
      DELIVERY_ID,
    );

    expect(one.attemptNo).toBe(1);
    expect(two.attemptNo).toBe(2);
    expect(first.calls.filter((c) => c.op === 'insert')).toHaveLength(1);
    expect(second.calls.filter((c) => c.op === 'insert')).toHaveLength(1);
  });
});

describe('DeliveryContactAttemptService — the cap of two', () => {
  it('refuses a third attempt with CONFLICT, and issues no insert', async () => {
    const { supabase, calls } = supabaseStub([arrivedDelivery(), attemptCount(2)]);

    await expectDomainError(
      new DeliveryContactAttemptService(supabase).recordContactAttempt(riderUser(), DELIVERY_ID),
      'CONFLICT',
    );

    expect(calls.find((c) => c.op === 'insert')).toBeUndefined();
  });

  it('reports how many attempts exist and how many are required, so the app need not guess', async () => {
    const { supabase } = supabaseStub([arrivedDelivery(), attemptCount(2)]);

    await new DeliveryContactAttemptService(supabase)
      .recordContactAttempt(riderUser(), DELIVERY_ID)
      .catch((error: DomainError) => {
        expect(error.details).toMatchObject({ attemptsRecorded: 2, attemptsRequired: 2 });
      });
  });

  /**
   * The concurrency requirement, stated precisely.
   *
   * Two simultaneous requests on a delivery with one attempt both derive `2`.
   * The database's `(delivery_id, attempt_no)` unique constraint lets exactly
   * one INSERT through; the loser sees 23505 and re-derives against the row
   * the winner committed, which now yields 3 — refused. A
   * `count` + `if (< 2)` + `insert` with no constraint behind it would leave
   * three attempts on the delivery.
   */
  it('turns a lost concurrent insert into a refusal, never a third attempt', async () => {
    const { supabase, calls } = supabaseStub([
      arrivedDelivery(),
      attemptCount(1), // both requests see one existing attempt
      UNIQUE_VIOLATION, // this one lost the race for attempt_no 2
      attemptCount(2), // re-derived against the winner's committed row
    ]);

    await expectDomainError(
      new DeliveryContactAttemptService(supabase).recordContactAttempt(riderUser(), DELIVERY_ID),
      'CONFLICT',
    );

    // Exactly one insert was attempted, and it did not succeed.
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(1);
  });

  it('recovers when the collision was for an ordinal that is still available', async () => {
    // A rarer interleaving: the loser re-derives and finds room for attempt 2.
    const { supabase, calls } = supabaseStub([
      arrivedDelivery(),
      attemptCount(0),
      UNIQUE_VIOLATION, // lost the race for attempt_no 1
      attemptCount(1), // the winner's row is now visible
      inserted(2),
    ]);

    const result = await new DeliveryContactAttemptService(supabase).recordContactAttempt(
      riderUser(),
      DELIVERY_ID,
    );

    expect(result.attemptNo).toBe(2);
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(2);
  });

  it('refuses rather than looping if a second collision somehow occurs', async () => {
    const { supabase, calls } = supabaseStub([
      arrivedDelivery(),
      attemptCount(0),
      UNIQUE_VIOLATION,
      attemptCount(0), // pathological: the count did not advance
      UNIQUE_VIOLATION,
    ]);

    await expectDomainError(
      new DeliveryContactAttemptService(supabase).recordContactAttempt(riderUser(), DELIVERY_ID),
      'CONFLICT',
    );

    // Bounded: two inserts, then a refusal. Never a spin.
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(2);
  });
});

describe('DeliveryContactAttemptService — ownership and state', () => {
  it('refuses a delivery assigned to another rider, and issues no insert', async () => {
    const { supabase, calls } = supabaseStub([arrivedDelivery(OTHER_RIDER_ID)]);

    await expectDomainError(
      new DeliveryContactAttemptService(supabase).recordContactAttempt(riderUser(), DELIVERY_ID),
      'NOT_ASSIGNED_RIDER',
    );

    expect(calls.find((c) => c.op === 'insert')).toBeUndefined();
  });

  it('gives a missing delivery the SAME error as a foreign one', async () => {
    const { supabase } = supabaseStub([{ data: null, error: null }]);

    await expectDomainError(
      new DeliveryContactAttemptService(supabase).recordContactAttempt(riderUser(), DELIVERY_ID),
      'NOT_ASSIGNED_RIDER',
    );
  });

  it.each(['RIDER_ASSIGNED', 'AT_MERCHANT', 'PICKED_UP', 'EN_ROUTE', 'DELIVERED', 'FAILED'])(
    'refuses a delivery in %s — an attempt is only evidence once the rider is at the customer',
    async (state) => {
      const { supabase, calls } = supabaseStub([delivery(state)]);

      await expectDomainError(
        new DeliveryContactAttemptService(supabase).recordContactAttempt(riderUser(), DELIVERY_ID),
        'INVALID_TRANSITION',
      );

      expect(calls.find((c) => c.op === 'insert')).toBeUndefined();
    },
  );

  it("fails closed if the route is ever wired without @Roles('RIDER')", async () => {
    const { supabase, calls } = supabaseStub([]);

    await expectDomainError(
      new DeliveryContactAttemptService(supabase).recordContactAttempt(riderUser(null), DELIVERY_ID),
      'FORBIDDEN',
    );

    expect(calls).toHaveLength(0);
  });
});

describe('DeliveryContactAttemptService — transport failures', () => {
  it('surfaces a delivery read failure as INTERNAL_ERROR, not as a refusal', async () => {
    const { supabase } = supabaseStub([{ data: null, error: { message: 'connection reset' } }]);

    await expectDomainError(
      new DeliveryContactAttemptService(supabase).recordContactAttempt(riderUser(), DELIVERY_ID),
      'INTERNAL_ERROR',
    );
  });

  it('surfaces a count failure as INTERNAL_ERROR rather than assuming zero attempts', async () => {
    const { supabase, calls } = supabaseStub([
      arrivedDelivery(),
      { data: null, count: null, error: { message: 'connection reset' } },
    ]);

    await expectDomainError(
      new DeliveryContactAttemptService(supabase).recordContactAttempt(riderUser(), DELIVERY_ID),
      'INTERNAL_ERROR',
    );

    // Assuming zero would have inserted a first attempt over an existing one.
    expect(calls.find((c) => c.op === 'insert')).toBeUndefined();
  });

  it('surfaces a non-unique insert failure as INTERNAL_ERROR', async () => {
    const { supabase } = supabaseStub([
      arrivedDelivery(),
      attemptCount(0),
      { data: null, error: { message: 'connection reset' } },
    ]);

    await expectDomainError(
      new DeliveryContactAttemptService(supabase).recordContactAttempt(riderUser(), DELIVERY_ID),
      'INTERNAL_ERROR',
    );
  });
});
