import { DeliveryArrivalService } from './delivery-arrival.service';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * `POST /api/v1/rider/deliveries/:id/arrived` — Phase G-4.
 *
 * Same stub shape as `delivery-release.service.spec.ts`: it records the
 * filters/payload each statement was built with, so the guarded-UPDATE
 * discipline can be asserted directly (ownership + pre-state both inside the
 * `WHERE`, never a prior `SELECT` deciding the transition).
 */

type Result = { data: unknown; error: { message: string; code?: string } | null };

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update';
  eq: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

function supabaseStub(results: Result[]) {
  const calls: Recorded[] = [];
  let index = 0;
  const nextResult = (): Result => results[index++] ?? { data: null, error: null };

  const admin = {
    from(table: string) {
      const call: Recorded = { table, op: 'select', eq: {} };
      calls.push(call);

      const builder: Record<string, unknown> = {
        select: () => builder,
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

const CLAIM_OK: Result = {
  data: { id: DELIVERY_ID, state: 'AT_MERCHANT', rider_id: RIDER_ID },
  error: null,
};
const CLAIM_NO_MATCH: Result = { data: null, error: null };
const OK: Result = { data: null, error: null };

async function expectDomainError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await promise.catch((error: DomainError) => expect(error.code).toBe(code));
}

describe('DeliveryArrivalService — successful arrival', () => {
  it('transitions RIDER_ASSIGNED -> AT_MERCHANT via a single guarded UPDATE, then appends exactly one history row', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_OK, OK]);

    const result = await new DeliveryArrivalService(supabase).arrive(riderUser(), DELIVERY_ID);

    expect(result).toEqual({ deliveryId: DELIVERY_ID, state: 'AT_MERCHANT', riderId: RIDER_ID });

    const update = calls.find((c) => c.op === 'update');
    expect(update?.table).toBe('deliveries');
    expect(update?.payload).toEqual({ state: 'AT_MERCHANT' });
    expect(update?.eq).toEqual({ id: DELIVERY_ID, state: 'RIDER_ASSIGNED', rider_id: RIDER_ID });

    const historyInserts = calls.filter((c) => c.table === 'delivery_status_history');
    expect(historyInserts).toHaveLength(1);
    expect(historyInserts[0]?.op).toBe('insert');
    expect(historyInserts[0]?.payload).toMatchObject({
      delivery_id: DELIVERY_ID,
      from_state: 'RIDER_ASSIGNED',
      to_state: 'AT_MERCHANT',
      actor_type: 'RIDER',
      actor_id: RIDER_ID,
    });

    // No diagnostic SELECT ran — the guarded UPDATE alone decided the transition.
    expect(calls.filter((c) => c.table === 'deliveries')).toHaveLength(1);
  });
});

describe('DeliveryArrivalService — ownership and state failures (diagnosed, never decided, by a SELECT)', () => {
  it('a nonexistent delivery is NOT_FOUND', async () => {
    const { supabase, calls } = supabaseStub([
      CLAIM_NO_MATCH,
      { data: null, error: null }, // diagnostic read: no row
    ]);

    await expectDomainError(new DeliveryArrivalService(supabase).arrive(riderUser(), DELIVERY_ID), 'NOT_FOUND');

    expect(calls.find((c) => c.table === 'delivery_status_history')).toBeUndefined();
  });

  it('a delivery assigned to another rider is NOT_ASSIGNED_RIDER (403), not NOT_FOUND', async () => {
    const { supabase, calls } = supabaseStub([
      CLAIM_NO_MATCH,
      { data: { id: DELIVERY_ID, state: 'RIDER_ASSIGNED', rider_id: OTHER_RIDER_ID }, error: null },
    ]);

    await expectDomainError(
      new DeliveryArrivalService(supabase).arrive(riderUser(RIDER_ID), DELIVERY_ID),
      'NOT_ASSIGNED_RIDER',
    );

    expect(calls.find((c) => c.table === 'delivery_status_history')).toBeUndefined();
  });

  it('a delivery with no rider assigned at all is also NOT_ASSIGNED_RIDER, not a crash', async () => {
    const { supabase } = supabaseStub([
      CLAIM_NO_MATCH,
      { data: { id: DELIVERY_ID, state: 'RIDER_SEARCHING', rider_id: null }, error: null },
    ]);

    await expectDomainError(
      new DeliveryArrivalService(supabase).arrive(riderUser(), DELIVERY_ID),
      'NOT_ASSIGNED_RIDER',
    );
  });

  it('already AT_MERCHANT (owned by this rider) is INVALID_TRANSITION, not a silent success', async () => {
    const { supabase, calls } = supabaseStub([
      CLAIM_NO_MATCH,
      { data: { id: DELIVERY_ID, state: 'AT_MERCHANT', rider_id: RIDER_ID }, error: null },
    ]);

    await expectDomainError(
      new DeliveryArrivalService(supabase).arrive(riderUser(), DELIVERY_ID),
      'INVALID_TRANSITION',
    );

    expect(calls.find((c) => c.table === 'delivery_status_history')).toBeUndefined();
  });

  it('a later state owned by this rider (e.g. PICKED_UP) is also INVALID_TRANSITION', async () => {
    const { supabase } = supabaseStub([
      CLAIM_NO_MATCH,
      { data: { id: DELIVERY_ID, state: 'PICKED_UP', rider_id: RIDER_ID }, error: null },
    ]);

    await expectDomainError(
      new DeliveryArrivalService(supabase).arrive(riderUser(), DELIVERY_ID),
      'INVALID_TRANSITION',
    );
  });
});

describe('DeliveryArrivalService — concurrency', () => {
  it('a concurrent retry after the winning request sees state already AT_MERCHANT and fails cleanly with no second history row', async () => {
    const { supabase, calls } = supabaseStub([
      CLAIM_NO_MATCH, // this request's guarded UPDATE lost the race
      { data: { id: DELIVERY_ID, state: 'AT_MERCHANT', rider_id: RIDER_ID }, error: null }, // the winner already committed
    ]);

    await expectDomainError(
      new DeliveryArrivalService(supabase).arrive(riderUser(), DELIVERY_ID),
      'INVALID_TRANSITION',
    );

    expect(calls.filter((c) => c.op === 'update')).toHaveLength(1);
    expect(calls.find((c) => c.table === 'delivery_status_history')).toBeUndefined();
  });
});

describe('DeliveryArrivalService — history write failure', () => {
  it('a delivery_status_history insert failure surfaces as INTERNAL_ERROR', async () => {
    const { supabase } = supabaseStub([CLAIM_OK, { data: null, error: { message: 'connection reset' } }]);

    await expectDomainError(
      new DeliveryArrivalService(supabase).arrive(riderUser(), DELIVERY_ID),
      'INTERNAL_ERROR',
    );
  });
});

describe('DeliveryArrivalService — rider identity', () => {
  it('fails closed if the route is ever wired without @Roles(\'RIDER\'), and never reads the request body/URL for identity', async () => {
    const { supabase, calls } = supabaseStub([]);

    await expectDomainError(new DeliveryArrivalService(supabase).arrive(riderUser(null), DELIVERY_ID), 'FORBIDDEN');

    expect(calls).toHaveLength(0);
  });

  it('the guarded UPDATE is filtered on the authenticated capability\'s riderId, never a value supplied elsewhere', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_OK, OK]);

    await new DeliveryArrivalService(supabase).arrive(riderUser(RIDER_ID), DELIVERY_ID);

    const update = calls.find((c) => c.op === 'update');
    expect(update?.eq.rider_id).toBe(RIDER_ID);
  });
});

describe('DeliveryArrivalService — table isolation', () => {
  it('touches only deliveries and delivery_status_history — no order, payment, ledger, reconciliation, or assignment-authority table', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_OK, OK]);

    await new DeliveryArrivalService(supabase).arrive(riderUser(), DELIVERY_ID);

    const tables = [...new Set(calls.map((c) => c.table))].sort();
    expect(tables).toEqual(['deliveries', 'delivery_status_history']);

    for (const call of calls) {
      const keys = Object.keys(call.payload ?? {});
      expect(keys.filter((k) => k.includes('satang'))).toEqual([]);
    }
  });
});
