import { DeliveryReleaseService } from './delivery-release.service';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * `POST /api/v1/rider/deliveries/:id/cancel` — DEC-021's release wiring.
 *
 * Same stub shape as `offer-acceptance.service.spec.ts`: it records the
 * filters/payload each statement was built with, so the CAS discipline can be
 * asserted directly rather than inferred from the thrown error alone. Extends
 * that stub with `rpc()`, since this service's first write is a direct RPC
 * call rather than a chained `.from()` builder.
 */

type Result = { data: unknown; error: { message: string; code?: string } | null };

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update' | 'rpc';
  eq: Record<string, unknown>;
  in: Record<string, unknown[]>;
  is: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

function supabaseStub(results: Result[]) {
  const calls: Recorded[] = [];
  let index = 0;
  const nextResult = (): Result => results[index++] ?? { data: null, error: null };

  const admin = {
    from(table: string) {
      const call: Recorded = { table, op: 'select', eq: {}, in: {}, is: {} };
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
        in(column: string, values: unknown[]) {
          call.in[column] = values;
          return builder;
        },
        maybeSingle: () => Promise.resolve(nextResult()),
        returns: () => Promise.resolve(nextResult()),
        then: (resolve: (r: Result) => unknown) => Promise.resolve(nextResult()).then(resolve),
      };

      return builder;
    },
    rpc(name: string, payload: Record<string, unknown>) {
      calls.push({ table: name, op: 'rpc', eq: {}, in: {}, is: {}, payload });
      return Promise.resolve(nextResult());
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

const ASSIGNED_DELIVERY = { data: { id: DELIVERY_ID, state: 'RIDER_ASSIGNED', rider_id: RIDER_ID }, error: null };
const RPC_OK: Result = { data: RIDER_ID, error: null };
const AVAILABILITY_REPAIRED: Result = {
  data: { rider_id: RIDER_ID, active_delivery_count: 0 },
  error: null,
};
const AVAILABILITY_NOT_MATCHED: Result = { data: null, error: null };
const OK: Result = { data: null, error: null };

const NOT_RELEASABLE_ERROR: Result = {
  data: null,
  error: {
    message:
      'delivery delivery-1 is not in a releasable state (must be RIDER_ASSIGNED or RIDER_REASSIGNING with a rider currently assigned)',
    code: 'P0001',
  },
};
const PERMISSION_ERROR: Result = {
  data: null,
  error: { message: 'release_rider_assignment may only be called by the service role', code: '42501' },
};
const INVARIANT_VIOLATED_ERROR: Result = {
  data: null,
  error: {
    message:
      'release invariant violated for delivery delivery-1: expected exactly one ACCEPTED rider_assignments row for rider rider-1, found 0',
    code: 'P0001',
  },
};

async function expectDomainError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await promise.catch((error: DomainError) => expect(error.code).toBe(code));
}

describe('DeliveryReleaseService — ownership', () => {
  it('a rider who is not deliveries.rider_id gets NOT_ASSIGNED_RIDER (403), and nothing is written', async () => {
    const { supabase, calls } = supabaseStub([
      { data: { id: DELIVERY_ID, state: 'RIDER_ASSIGNED', rider_id: OTHER_RIDER_ID }, error: null },
    ]);
    const service = new DeliveryReleaseService(supabase);

    await expectDomainError(
      service.cancelDelivery(riderUser(RIDER_ID), DELIVERY_ID, undefined),
      'NOT_ASSIGNED_RIDER',
    );

    expect(calls.find((c) => c.op === 'rpc')).toBeUndefined();
    expect(calls.find((c) => c.table === 'rider_availability')).toBeUndefined();
    expect(calls.find((c) => c.table === 'delivery_status_history')).toBeUndefined();
  });

  it('a delivery with no rider assigned at all is also NOT_ASSIGNED_RIDER, not a crash', async () => {
    const { supabase } = supabaseStub([
      { data: { id: DELIVERY_ID, state: 'RIDER_SEARCHING', rider_id: null }, error: null },
    ]);
    const service = new DeliveryReleaseService(supabase);

    await expectDomainError(
      service.cancelDelivery(riderUser(RIDER_ID), DELIVERY_ID, undefined),
      'NOT_ASSIGNED_RIDER',
    );
  });

  it('a nonexistent delivery is NOT_FOUND, not NOT_ASSIGNED_RIDER', async () => {
    const { supabase } = supabaseStub([{ data: null, error: null }]);
    const service = new DeliveryReleaseService(supabase);

    await expectDomainError(service.cancelDelivery(riderUser(), DELIVERY_ID, undefined), 'NOT_FOUND');
  });
});

describe('DeliveryReleaseService — successful release', () => {
  it('releases the delivery: RPC called with RELEASED, availability CAS 1 -> 0, history appended, order untouched', async () => {
    const { supabase, calls } = supabaseStub([
      ASSIGNED_DELIVERY,
      RPC_OK,
      AVAILABILITY_REPAIRED,
      OK, // history insert
    ]);

    const result = await new DeliveryReleaseService(supabase).cancelDelivery(riderUser(), DELIVERY_ID, 'too far');

    expect(result).toEqual({ deliveryId: DELIVERY_ID, state: 'RIDER_SEARCHING', riderId: RIDER_ID });

    const rpc = calls.find((c) => c.op === 'rpc');
    expect(rpc?.table).toBe('release_rider_assignment');
    expect(rpc?.payload).toEqual({ p_delivery_id: DELIVERY_ID, p_status: 'RELEASED', p_reason: 'too far' });

    const availability = calls.find((c) => c.table === 'rider_availability');
    expect(availability?.op).toBe('update');
    expect(availability?.payload).toEqual({ active_delivery_count: 0 });
    expect(availability?.eq).toMatchObject({ rider_id: RIDER_ID, active_delivery_count: 1 });

    const history = calls.find((c) => c.table === 'delivery_status_history');
    expect(history?.op).toBe('insert');
    expect(history?.payload).toMatchObject({
      delivery_id: DELIVERY_ID,
      from_state: 'RIDER_ASSIGNED',
      to_state: 'RIDER_SEARCHING',
      actor_type: 'RIDER',
      actor_id: RIDER_ID,
      reason: 'too far',
    });

    expect(calls.find((c) => c.table === 'orders')).toBeUndefined();
  });

  it('no reason still succeeds, and the RPC/history both carry null, not undefined', async () => {
    const { supabase, calls } = supabaseStub([ASSIGNED_DELIVERY, RPC_OK, AVAILABILITY_REPAIRED, OK]);

    await new DeliveryReleaseService(supabase).cancelDelivery(riderUser(), DELIVERY_ID, undefined);

    const rpc = calls.find((c) => c.op === 'rpc');
    expect(rpc?.payload).toMatchObject({ p_reason: null });

    const history = calls.find((c) => c.table === 'delivery_status_history');
    expect(history?.payload).toMatchObject({ reason: null });
  });
});

describe('DeliveryReleaseService — RPC error mapping (V1.1 §9)', () => {
  it('NOT_RELEASABLE (P0001, not releasable): 409, no availability write, no history row', async () => {
    const { supabase, calls } = supabaseStub([ASSIGNED_DELIVERY, NOT_RELEASABLE_ERROR]);
    const service = new DeliveryReleaseService(supabase);

    await expectDomainError(service.cancelDelivery(riderUser(), DELIVERY_ID, undefined), 'NOT_RELEASABLE');

    expect(calls.find((c) => c.table === 'rider_availability')).toBeUndefined();
    expect(calls.find((c) => c.table === 'delivery_status_history')).toBeUndefined();
  });

  it('42501 (permission denied): INTERNAL_ERROR, and the raw permission error never reaches the caller', async () => {
    const { supabase } = supabaseStub([ASSIGNED_DELIVERY, PERMISSION_ERROR]);
    const service = new DeliveryReleaseService(supabase);

    const error = await service
      .cancelDelivery(riderUser(), DELIVERY_ID, undefined)
      .catch((e: DomainError) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('INTERNAL_ERROR');
    expect((error as DomainError).message).not.toContain('service role');
  });

  it('release invariant violated: INTERNAL_ERROR, and exactly one reconciliation_cases row is opened (Phase G-3.1, migration 20260825000001)', async () => {
    const { supabase, calls } = supabaseStub([
      ASSIGNED_DELIVERY,
      INVARIANT_VIOLATED_ERROR,
      OK, // reconciliation_cases insert
    ]);
    const service = new DeliveryReleaseService(supabase);

    await expectDomainError(service.cancelDelivery(riderUser(), DELIVERY_ID, undefined), 'INTERNAL_ERROR');

    const cases = calls.filter((c) => c.table === 'reconciliation_cases');
    expect(cases).toHaveLength(1);
    expect(cases[0]?.op).toBe('insert');
    expect(cases[0]?.payload).toMatchObject({
      kind: 'RIDER_RELEASE_INVARIANT',
      delivery_id: DELIVERY_ID,
      state: 'OPEN',
    });
    expect(typeof cases[0]?.payload?.resolution_note).toBe('string');
    expect(cases[0]?.payload).not.toHaveProperty('rider_id');

    // Fail-closed all the way: no availability decrement, no history row, no retry.
    expect(calls.find((c) => c.table === 'rider_availability')).toBeUndefined();
    expect(calls.find((c) => c.table === 'delivery_status_history')).toBeUndefined();
    expect(calls.filter((c) => c.op === 'rpc')).toHaveLength(1);
  });

  it('a reconciliation_cases insert failure does not change the rider-facing outcome or leak past the response', async () => {
    const { supabase } = supabaseStub([
      ASSIGNED_DELIVERY,
      INVARIANT_VIOLATED_ERROR,
      { data: null, error: { message: 'connection reset' } }, // reconciliation_cases insert fails
    ]);
    const service = new DeliveryReleaseService(supabase);

    await expectDomainError(service.cancelDelivery(riderUser(), DELIVERY_ID, undefined), 'INTERNAL_ERROR');
  });
});

describe('DeliveryReleaseService — the availability CAS', () => {
  it('the repair is a guarded UPDATE, not a SELECT-then-decrement', async () => {
    const { supabase, calls } = supabaseStub([ASSIGNED_DELIVERY, RPC_OK, AVAILABILITY_REPAIRED, OK]);

    await new DeliveryReleaseService(supabase).cancelDelivery(riderUser(), DELIVERY_ID, undefined);

    const availability = calls.find((c) => c.table === 'rider_availability');
    const beforeIt = calls.slice(0, calls.indexOf(availability as Recorded));
    expect(beforeIt.some((c) => c.table === 'rider_availability')).toBe(false);
    expect(availability?.payload).toEqual({ active_delivery_count: 0 });
    expect(availability?.eq).toMatchObject({ rider_id: RIDER_ID, active_delivery_count: 1 });
  });

  it('a CAS that matches no row fails closed: INTERNAL_ERROR, no success reported, the RPC is never called again', async () => {
    const { supabase, calls } = supabaseStub([ASSIGNED_DELIVERY, RPC_OK, AVAILABILITY_NOT_MATCHED]);
    const service = new DeliveryReleaseService(supabase);

    await expectDomainError(service.cancelDelivery(riderUser(), DELIVERY_ID, undefined), 'INTERNAL_ERROR');

    expect(calls.filter((c) => c.op === 'rpc')).toHaveLength(1);
    expect(calls.find((c) => c.table === 'delivery_status_history')).toBeUndefined();
  });
});

describe('DeliveryReleaseService — reason propagation', () => {
  it('a reason is passed to the RPC and preserved in the history row', async () => {
    const { supabase, calls } = supabaseStub([ASSIGNED_DELIVERY, RPC_OK, AVAILABILITY_REPAIRED, OK]);

    await new DeliveryReleaseService(supabase).cancelDelivery(riderUser(), DELIVERY_ID, 'customer unreachable');

    expect(calls.find((c) => c.op === 'rpc')?.payload).toMatchObject({ p_reason: 'customer unreachable' });
    expect(calls.find((c) => c.table === 'delivery_status_history')?.payload).toMatchObject({
      reason: 'customer unreachable',
    });
  });
});

describe('DeliveryReleaseService — isolation', () => {
  it('touches no order, payment, ledger, refund or settlement table, and no money field', async () => {
    const { supabase, calls } = supabaseStub([ASSIGNED_DELIVERY, RPC_OK, AVAILABILITY_REPAIRED, OK]);

    await new DeliveryReleaseService(supabase).cancelDelivery(riderUser(), DELIVERY_ID, undefined);

    const tables = [...new Set(calls.map((c) => c.table))].sort();
    expect(tables).toEqual(['deliveries', 'delivery_status_history', 'release_rider_assignment', 'rider_availability']);

    for (const call of calls) {
      const keys = Object.keys(call.payload ?? {});
      expect(keys.filter((k) => k.includes('satang'))).toEqual([]);
    }
  });

  it('fails closed if the route is ever wired without @Roles(\'RIDER\')', async () => {
    const { supabase, calls } = supabaseStub([]);
    const service = new DeliveryReleaseService(supabase);

    await expectDomainError(service.cancelDelivery(riderUser(null), DELIVERY_ID, undefined), 'FORBIDDEN');

    expect(calls).toHaveLength(0);
  });
});

describe('DeliveryReleaseService — re-dispatch compatibility', () => {
  it('the reported post-release state is RIDER_SEARCHING, one of dispatch\'s own DISPATCHABLE_DELIVERY_STATES', async () => {
    const { supabase } = supabaseStub([ASSIGNED_DELIVERY, RPC_OK, AVAILABILITY_REPAIRED, OK]);

    const result = await new DeliveryReleaseService(supabase).cancelDelivery(riderUser(), DELIVERY_ID, undefined);

    expect(result.state).toBe('RIDER_SEARCHING');
  });
});
