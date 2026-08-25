import { DeliveryPickupService } from './delivery-pickup.service';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { OrdersService } from '../orders/orders.service';

/**
 * `POST /api/v1/rider/deliveries/:id/picked-up` — Phase G-5, the order ↔
 * delivery join point.
 *
 * Same stub shape as `delivery-arrival.service.spec.ts` for the `deliveries`
 * side. `OrdersService` is a genuine collaborator here (not reimplemented),
 * so it is stubbed as a jest mock rather than through the Supabase builder —
 * this is what lets these tests assert "delivery succeeded, order call was
 * made with the right arguments" and "order failed, no history row" without
 * reaching into `OrdersService`'s own internals, which are already covered by
 * `orders.service.spec.ts`.
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
const ORDER_ID = 'order-1';

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
  data: { id: DELIVERY_ID, state: 'PICKED_UP', rider_id: RIDER_ID, order_id: ORDER_ID },
  error: null,
};
const CLAIM_NO_MATCH: Result = { data: null, error: null };
const OK: Result = { data: null, error: null };

function ordersStub(pickupOrder: jest.Mock) {
  return { pickupOrder } as unknown as OrdersService;
}

async function expectDomainError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await promise.catch((error: DomainError) => expect(error.code).toBe(code));
}

describe('DeliveryPickupService — successful pickup (the join point)', () => {
  it('transitions the delivery, appends exactly one history row, then transitions the order', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_OK, OK]);
    const pickupOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'PICKED_UP' });
    const orders = ordersStub(pickupOrder);
    const user = riderUser();

    const result = await new DeliveryPickupService(supabase, orders).pickup(user, DELIVERY_ID);

    expect(result).toEqual({ deliveryId: DELIVERY_ID, orderId: ORDER_ID, state: 'PICKED_UP', riderId: RIDER_ID });

    const update = calls.find((c) => c.op === 'update');
    expect(update?.table).toBe('deliveries');
    expect(update?.payload).toEqual({ state: 'PICKED_UP' });
    expect(update?.eq).toEqual({ id: DELIVERY_ID, state: 'AT_MERCHANT', rider_id: RIDER_ID });

    expect(pickupOrder).toHaveBeenCalledTimes(1);
    expect(pickupOrder).toHaveBeenCalledWith(user, ORDER_ID);

    const historyInserts = calls.filter((c) => c.table === 'delivery_status_history');
    expect(historyInserts).toHaveLength(1);
    expect(historyInserts[0]?.op).toBe('insert');
    expect(historyInserts[0]?.payload).toMatchObject({
      delivery_id: DELIVERY_ID,
      from_state: 'AT_MERCHANT',
      to_state: 'PICKED_UP',
      actor_type: 'RIDER',
      actor_id: RIDER_ID,
    });
  });
});

describe('DeliveryPickupService — delivery ownership and state failures (diagnosed, never decided, by a SELECT)', () => {
  it('a nonexistent delivery is NOT_FOUND, and the order is never touched', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_NO_MATCH, { data: null, error: null }]);
    const pickupOrder = jest.fn();
    const orders = ordersStub(pickupOrder);

    await expectDomainError(
      new DeliveryPickupService(supabase, orders).pickup(riderUser(), DELIVERY_ID),
      'NOT_FOUND',
    );

    expect(pickupOrder).not.toHaveBeenCalled();
    expect(calls.find((c) => c.table === 'delivery_status_history')).toBeUndefined();
  });

  it('a delivery assigned to another rider is NOT_ASSIGNED_RIDER (403), and the order is never touched', async () => {
    const { supabase } = supabaseStub([
      CLAIM_NO_MATCH,
      { data: { id: DELIVERY_ID, state: 'AT_MERCHANT', rider_id: OTHER_RIDER_ID, order_id: ORDER_ID }, error: null },
    ]);
    const pickupOrder = jest.fn();
    const orders = ordersStub(pickupOrder);

    await expectDomainError(
      new DeliveryPickupService(supabase, orders).pickup(riderUser(RIDER_ID), DELIVERY_ID),
      'NOT_ASSIGNED_RIDER',
    );

    expect(pickupOrder).not.toHaveBeenCalled();
  });

  it('a delivery owned by this rider but still RIDER_ASSIGNED (not yet AT_MERCHANT) is INVALID_TRANSITION', async () => {
    const { supabase } = supabaseStub([
      CLAIM_NO_MATCH,
      { data: { id: DELIVERY_ID, state: 'RIDER_ASSIGNED', rider_id: RIDER_ID, order_id: ORDER_ID }, error: null },
    ]);
    const pickupOrder = jest.fn();
    const orders = ordersStub(pickupOrder);

    await expectDomainError(
      new DeliveryPickupService(supabase, orders).pickup(riderUser(), DELIVERY_ID),
      'INVALID_TRANSITION',
    );

    expect(pickupOrder).not.toHaveBeenCalled();
  });

  it('a delivery in a terminal state (DELIVERED) is INVALID_TRANSITION and never touches the order', async () => {
    const { supabase } = supabaseStub([
      CLAIM_NO_MATCH,
      { data: { id: DELIVERY_ID, state: 'DELIVERED', rider_id: RIDER_ID, order_id: ORDER_ID }, error: null },
    ]);
    const pickupOrder = jest.fn();
    const orders = ordersStub(pickupOrder);

    await expectDomainError(
      new DeliveryPickupService(supabase, orders).pickup(riderUser(), DELIVERY_ID),
      'INVALID_TRANSITION',
    );

    expect(pickupOrder).not.toHaveBeenCalled();
  });
});

describe('DeliveryPickupService — concurrency', () => {
  it('the loser of two concurrent requests performs no delivery transition and writes no history row', async () => {
    const { supabase, calls } = supabaseStub([
      CLAIM_NO_MATCH, // this request's guarded UPDATE lost the race
      { data: { id: DELIVERY_ID, state: 'PICKED_UP', rider_id: RIDER_ID, order_id: ORDER_ID }, error: null },
      { data: { state: 'PICKED_UP' }, error: null }, // the winner already advanced the order too
    ]);
    // The loser's order attempt hits the winner's committed PICKED_UP and is refused.
    const pickupOrder = jest.fn().mockRejectedValue(new DomainError('INVALID_TRANSITION', { details: {} }));
    const orders = ordersStub(pickupOrder);

    const result = await new DeliveryPickupService(supabase, orders).pickup(riderUser(), DELIVERY_ID);

    // Idempotent: the loser reports the state the caller is genuinely left in.
    expect(result.state).toBe('PICKED_UP');
    // Exactly one guarded UPDATE was *attempted* (it is always the authority),
    // and it matched nothing — so the loser transitioned no delivery.
    const updates = calls.filter((c) => c.op === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0]?.eq).toMatchObject({ state: 'AT_MERCHANT' });
    // Critically: no history row, and no write of any kind, from the loser.
    expect(calls.find((c) => c.table === 'delivery_status_history')).toBeUndefined();
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  it('only the guarded-UPDATE winner ever writes history — the losing path has no code route to it', async () => {
    const { supabase, calls } = supabaseStub([
      CLAIM_NO_MATCH,
      { data: { id: DELIVERY_ID, state: 'PICKED_UP', rider_id: RIDER_ID, order_id: ORDER_ID }, error: null },
    ]);
    const pickupOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'PICKED_UP' });
    const orders = ordersStub(pickupOrder);

    await new DeliveryPickupService(supabase, orders).pickup(riderUser(), DELIVERY_ID);

    expect(calls.filter((c) => c.table === 'delivery_status_history')).toHaveLength(0);
  });
});

describe('DeliveryPickupService — order transition failure (fail closed, no false success)', () => {
  it('the delivery moved but the order did not: the order error propagates unmodified, and the delivery is never re-updated to undo it', async () => {
    const { supabase, calls } = supabaseStub([
      CLAIM_OK,
      OK, // history
      { data: { state: 'READY_FOR_PICKUP' }, error: null }, // order diagnosis: still not PICKED_UP
    ]);
    const pickupOrder = jest.fn().mockRejectedValue(new DomainError('INVALID_TRANSITION', { details: {} }));
    const orders = ordersStub(pickupOrder);

    await expectDomainError(
      new DeliveryPickupService(supabase, orders).pickup(riderUser(), DELIVERY_ID),
      'INVALID_TRANSITION',
    );

    expect(pickupOrder).toHaveBeenCalledTimes(1);
    // The delivery UPDATE already ran (and, in the real database, already committed) —
    // this service never calls it a second time to "undo" it.
    expect(calls.filter((c) => c.op === 'update' && c.table === 'deliveries')).toHaveLength(1);
  });

  it('the history row IS written before the order is attempted — the delivery genuinely transitioned, and its own audit must say so (DEC-018)', async () => {
    const { supabase, calls } = supabaseStub([
      CLAIM_OK,
      OK,
      { data: { state: 'READY_FOR_PICKUP' }, error: null },
    ]);
    const pickupOrder = jest.fn().mockRejectedValue(new DomainError('INVALID_TRANSITION', { details: {} }));
    const orders = ordersStub(pickupOrder);

    await expectDomainError(
      new DeliveryPickupService(supabase, orders).pickup(riderUser(), DELIVERY_ID),
      'INVALID_TRANSITION',
    );

    const history = calls.filter((c) => c.table === 'delivery_status_history');
    expect(history).toHaveLength(1);
    expect(history[0]?.payload).toMatchObject({ from_state: 'AT_MERCHANT', to_state: 'PICKED_UP' });
  });

  it('an order not found (deleted/inconsistent) surfaces its own NOT_FOUND unmodified', async () => {
    const { supabase } = supabaseStub([CLAIM_OK, OK, { data: null, error: null }]);
    const pickupOrder = jest.fn().mockRejectedValue(new DomainError('NOT_FOUND', { message: 'Order not found' }));
    const orders = ordersStub(pickupOrder);

    await expectDomainError(
      new DeliveryPickupService(supabase, orders).pickup(riderUser(), DELIVERY_ID),
      'NOT_FOUND',
    );
  });

  it('an unexpected (non-DomainError) failure from the order transition still propagates, not swallowed into a false success', async () => {
    const { supabase } = supabaseStub([
      CLAIM_OK,
      OK,
      { data: { state: 'READY_FOR_PICKUP' }, error: null },
    ]);
    const pickupOrder = jest.fn().mockRejectedValue(new Error('connection reset'));
    const orders = ordersStub(pickupOrder);

    await expect(new DeliveryPickupService(supabase, orders).pickup(riderUser(), DELIVERY_ID)).rejects.toThrow(
      'connection reset',
    );
  });

  it('a failed order-state diagnostic read does not mask the original order error', async () => {
    const { supabase } = supabaseStub([
      CLAIM_OK,
      OK,
      { data: null, error: { message: 'connection reset' } }, // diagnosis itself fails
    ]);
    const pickupOrder = jest.fn().mockRejectedValue(new DomainError('INVALID_TRANSITION', { details: {} }));
    const orders = ordersStub(pickupOrder);

    await expectDomainError(
      new DeliveryPickupService(supabase, orders).pickup(riderUser(), DELIVERY_ID),
      'INVALID_TRANSITION',
    );
  });
});

describe('DeliveryPickupService — G-5.1 partial-failure repair', () => {
  it('a retry whose delivery is already PICKED_UP re-attempts the order half and repairs it, writing no second history row', async () => {
    const { supabase, calls } = supabaseStub([
      CLAIM_NO_MATCH, // guarded UPDATE: delivery is no longer AT_MERCHANT
      { data: { id: DELIVERY_ID, state: 'PICKED_UP', rider_id: RIDER_ID, order_id: ORDER_ID }, error: null },
    ]);
    const pickupOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'PICKED_UP' });
    const orders = ordersStub(pickupOrder);
    const user = riderUser();

    const result = await new DeliveryPickupService(supabase, orders).pickup(user, DELIVERY_ID);

    expect(result).toEqual({ deliveryId: DELIVERY_ID, orderId: ORDER_ID, state: 'PICKED_UP', riderId: RIDER_ID });

    // The order half was genuinely re-attempted — this is the repair.
    expect(pickupOrder).toHaveBeenCalledTimes(1);
    expect(pickupOrder).toHaveBeenCalledWith(user, ORDER_ID);

    // ...and no second history row: the request that moved the delivery already wrote it.
    expect(calls.find((c) => c.table === 'delivery_status_history')).toBeUndefined();
    // The delivery is never re-updated on the repair path.
    expect(calls.filter((c) => c.op === 'update')).toHaveLength(1);
  });

  it('an already-repaired pair (delivery and order both PICKED_UP) is idempotent: no duplicate order transition, no duplicate history', async () => {
    const { supabase, calls } = supabaseStub([
      CLAIM_NO_MATCH,
      { data: { id: DELIVERY_ID, state: 'PICKED_UP', rider_id: RIDER_ID, order_id: ORDER_ID }, error: null },
      { data: { state: 'PICKED_UP' }, error: null }, // order diagnosis: already done
    ]);
    // The order's own guarded UPDATE matches nothing and refuses — as it should.
    const pickupOrder = jest.fn().mockRejectedValue(new DomainError('INVALID_TRANSITION', { details: {} }));
    const orders = ordersStub(pickupOrder);

    const result = await new DeliveryPickupService(supabase, orders).pickup(riderUser(), DELIVERY_ID);

    expect(result.state).toBe('PICKED_UP');
    expect(calls.find((c) => c.table === 'delivery_status_history')).toBeUndefined();
    // Only the guarded UPDATE attempt (which matched nothing) — no repair write.
    expect(calls.filter((c) => c.op === 'update' && c.table === 'deliveries')).toHaveLength(1);
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  it('a CANCELLED order is NEVER forced to PICKED_UP — the order error propagates and no order write occurs', async () => {
    const { supabase, calls } = supabaseStub([
      CLAIM_NO_MATCH,
      { data: { id: DELIVERY_ID, state: 'PICKED_UP', rider_id: RIDER_ID, order_id: ORDER_ID }, error: null },
      { data: { state: 'CANCELLED' }, error: null },
    ]);
    const pickupOrder = jest.fn().mockRejectedValue(new DomainError('INVALID_TRANSITION', { details: {} }));
    const orders = ordersStub(pickupOrder);

    await expectDomainError(
      new DeliveryPickupService(supabase, orders).pickup(riderUser(), DELIVERY_ID),
      'INVALID_TRANSITION',
    );

    // pickupOrder's own guarded WHERE state='READY_FOR_PICKUP' matched nothing:
    // the order was read for diagnosis only and never written by this service.
    expect(calls.find((c) => c.table === 'orders' && c.op !== 'select')).toBeUndefined();
    // No repair-path delivery write, and no history row.
    expect(calls.filter((c) => c.op === 'update' && c.table === 'deliveries')).toHaveLength(1);
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  it('a delivery that has moved past PICKED_UP (EN_ROUTE) is not repairable and never touches the order', async () => {
    const { supabase } = supabaseStub([
      CLAIM_NO_MATCH,
      { data: { id: DELIVERY_ID, state: 'EN_ROUTE', rider_id: RIDER_ID, order_id: ORDER_ID }, error: null },
    ]);
    const pickupOrder = jest.fn();
    const orders = ordersStub(pickupOrder);

    await expectDomainError(
      new DeliveryPickupService(supabase, orders).pickup(riderUser(), DELIVERY_ID),
      'INVALID_TRANSITION',
    );

    expect(pickupOrder).not.toHaveBeenCalled();
  });

  it('a PICKED_UP delivery belonging to another rider is NOT_ASSIGNED_RIDER and is never repairable by this caller', async () => {
    const { supabase } = supabaseStub([
      CLAIM_NO_MATCH,
      { data: { id: DELIVERY_ID, state: 'PICKED_UP', rider_id: OTHER_RIDER_ID, order_id: ORDER_ID }, error: null },
    ]);
    const pickupOrder = jest.fn();
    const orders = ordersStub(pickupOrder);

    await expectDomainError(
      new DeliveryPickupService(supabase, orders).pickup(riderUser(RIDER_ID), DELIVERY_ID),
      'NOT_ASSIGNED_RIDER',
    );

    expect(pickupOrder).not.toHaveBeenCalled();
  });
});

describe('DeliveryPickupService — history write failure', () => {
  it('a delivery_status_history insert failure surfaces as INTERNAL_ERROR and stops before the order is touched', async () => {
    const { supabase } = supabaseStub([CLAIM_OK, { data: null, error: { message: 'connection reset' } }]);
    const pickupOrder = jest.fn();
    const orders = ordersStub(pickupOrder);

    await expectDomainError(
      new DeliveryPickupService(supabase, orders).pickup(riderUser(), DELIVERY_ID),
      'INTERNAL_ERROR',
    );

    expect(pickupOrder).not.toHaveBeenCalled();
  });
});

describe('DeliveryPickupService — rider identity', () => {
  it('fails closed if the route is ever wired without @Roles(\'RIDER\'), and never reads the request body/URL for identity', async () => {
    const { supabase, calls } = supabaseStub([]);
    const pickupOrder = jest.fn();
    const orders = ordersStub(pickupOrder);

    await expectDomainError(
      new DeliveryPickupService(supabase, orders).pickup(riderUser(null), DELIVERY_ID),
      'FORBIDDEN',
    );

    expect(calls).toHaveLength(0);
    expect(pickupOrder).not.toHaveBeenCalled();
  });

  it('the guarded UPDATE is filtered on the authenticated capability\'s riderId, never a value supplied elsewhere', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_OK, OK]);
    const pickupOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'PICKED_UP' });
    const orders = ordersStub(pickupOrder);

    await new DeliveryPickupService(supabase, orders).pickup(riderUser(RIDER_ID), DELIVERY_ID);

    const update = calls.find((c) => c.op === 'update');
    expect(update?.eq.rider_id).toBe(RIDER_ID);
  });
});

describe('DeliveryPickupService — table isolation', () => {
  it('touches only deliveries and delivery_status_history directly — order writes go exclusively through OrdersService, never a direct orders table call', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_OK, OK]);
    const pickupOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'PICKED_UP' });
    const orders = ordersStub(pickupOrder);

    await new DeliveryPickupService(supabase, orders).pickup(riderUser(), DELIVERY_ID);

    const tables = [...new Set(calls.map((c) => c.table))].sort();
    expect(tables).toEqual(['deliveries', 'delivery_status_history']);

    for (const call of calls) {
      const keys = Object.keys(call.payload ?? {});
      expect(keys.filter((k) => k.includes('satang'))).toEqual([]);
    }

    // Forbidden tables: never referenced anywhere in this service's own writes.
    const forbidden = [
      'payments',
      'payment_events',
      'payment_attempts',
      'rider_assignment_attempts',
      'rider_assignments',
      'reconciliation_cases',
      'ledger_entries',
      'ledger_entry_groups',
      'settlements',
      'refunds',
    ];
    for (const table of forbidden) {
      expect(calls.find((c) => c.table === table)).toBeUndefined();
    }
  });

  it('the only `orders` access this service ever makes is a read — every order WRITE goes through OrdersService', async () => {
    const { supabase, calls } = supabaseStub([
      CLAIM_NO_MATCH,
      { data: { id: DELIVERY_ID, state: 'PICKED_UP', rider_id: RIDER_ID, order_id: ORDER_ID }, error: null },
      { data: { state: 'CANCELLED' }, error: null },
    ]);
    const pickupOrder = jest.fn().mockRejectedValue(new DomainError('INVALID_TRANSITION', { details: {} }));
    const orders = ordersStub(pickupOrder);

    await expectDomainError(
      new DeliveryPickupService(supabase, orders).pickup(riderUser(), DELIVERY_ID),
      'INVALID_TRANSITION',
    );

    const orderCalls = calls.filter((c) => c.table === 'orders');
    expect(orderCalls).toHaveLength(1);
    expect(orderCalls[0]?.op).toBe('select');
    expect(calls.find((c) => c.table === 'order_status_history')).toBeUndefined();
  });
});
