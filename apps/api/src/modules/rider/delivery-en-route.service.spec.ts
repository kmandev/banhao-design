import { DeliveryEnRouteService } from './delivery-en-route.service';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { OrdersService } from '../orders/orders.service';

/**
 * `POST /api/v1/rider/deliveries/:id/en-route` — Phase G-6, the rider's
 * departure from the merchant.
 *
 * Same stub shape as `delivery-pickup.service.spec.ts`: the `deliveries` side
 * goes through the Supabase builder stub, while `OrdersService` is a genuine
 * collaborator (not reimplemented) and so is stubbed as a jest mock. That split
 * is what lets these tests assert *"the delivery transitioned and the order call
 * was made with the right arguments"* and *"the order failed, so no false
 * success"* without reaching into `OrdersService`'s internals, which
 * `orders.service.spec.ts` already covers.
 *
 * The assertions below are deliberately about **observable effects** — which
 * table was written, with which `WHERE` filters, how many history rows exist,
 * what state the caller is left in — not merely that a mock was called.
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

/** The guarded UPDATE matched: this request is the one that moved the delivery. */
const CLAIM_OK: Result = {
  data: { id: DELIVERY_ID, state: 'EN_ROUTE', rider_id: RIDER_ID, order_id: ORDER_ID },
  error: null,
};
const CLAIM_NO_MATCH: Result = { data: null, error: null };
const OK: Result = { data: null, error: null };

/** A diagnostic read of the delivery, for the repair/refusal paths. */
function deliveryRow(state: string, riderId: string | null = RIDER_ID): Result {
  return { data: { id: DELIVERY_ID, state, rider_id: riderId, order_id: ORDER_ID }, error: null };
}

/** A diagnostic read of `orders.state`. */
function orderRow(state: string): Result {
  return { data: { state }, error: null };
}

function ordersStub(startDelivery: jest.Mock) {
  return { startDelivery } as unknown as OrdersService;
}

async function expectDomainError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await promise.catch((error: DomainError) => expect(error.code).toBe(code));
}

describe('DeliveryEnRouteService — successful departure (PICKED_UP -> EN_ROUTE / DELIVERING)', () => {
  it('transitions the delivery, appends exactly one history row, then transitions the order', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_OK, OK]);
    const startDelivery = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERING' });
    const orders = ordersStub(startDelivery);
    const user = riderUser();

    const result = await new DeliveryEnRouteService(supabase, orders).startDelivery(user, DELIVERY_ID);

    // Both domains' names for the one step — never collapsed into a single
    // ambiguous `state`, because here they genuinely differ (DEC-018).
    expect(result).toEqual({
      deliveryId: DELIVERY_ID,
      orderId: ORDER_ID,
      state: 'EN_ROUTE',
      orderState: 'DELIVERING',
      riderId: RIDER_ID,
    });

    // The guarded UPDATE is the sole transition authority: pre-state AND
    // ownership both live in the WHERE clause (ADR-003).
    const update = calls.find((c) => c.op === 'update');
    expect(update?.table).toBe('deliveries');
    expect(update?.payload).toEqual({ state: 'EN_ROUTE' });
    expect(update?.eq).toEqual({ id: DELIVERY_ID, state: 'PICKED_UP', rider_id: RIDER_ID });

    expect(startDelivery).toHaveBeenCalledTimes(1);
    expect(startDelivery).toHaveBeenCalledWith(user, ORDER_ID);

    const historyInserts = calls.filter((c) => c.table === 'delivery_status_history');
    expect(historyInserts).toHaveLength(1);
    expect(historyInserts[0]?.op).toBe('insert');
    expect(historyInserts[0]?.payload).toMatchObject({
      delivery_id: DELIVERY_ID,
      from_state: 'PICKED_UP',
      to_state: 'EN_ROUTE',
      actor_type: 'RIDER',
      actor_id: RIDER_ID,
      reason: null,
    });
  });

  it('no SELECT precedes the guarded UPDATE — the UPDATE decides, nothing else does', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_OK, OK]);
    const startDelivery = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERING' });

    await new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(riderUser(), DELIVERY_ID);

    // The very first database call of the request is the transition itself.
    expect(calls[0]?.table).toBe('deliveries');
    expect(calls[0]?.op).toBe('update');
  });

  it('the history row is written BEFORE the order is attempted (the G-5.1 ordering fix)', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_OK, OK, orderRow('PICKED_UP')]);
    // The order half fails; the delivery still genuinely transitioned, and its
    // own audit trail must say so (DEC-018).
    const startDelivery = jest.fn().mockRejectedValue(new DomainError('INVALID_TRANSITION', { details: {} }));

    await expectDomainError(
      new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(riderUser(), DELIVERY_ID),
      'INVALID_TRANSITION',
    );

    const history = calls.filter((c) => c.table === 'delivery_status_history');
    expect(history).toHaveLength(1);
    expect(history[0]?.payload).toMatchObject({ from_state: 'PICKED_UP', to_state: 'EN_ROUTE' });
  });
});

describe('DeliveryEnRouteService — ownership and state refusals (diagnosed, never decided, by a SELECT)', () => {
  it('a nonexistent delivery is NOT_FOUND, and the order is never touched', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_NO_MATCH, { data: null, error: null }]);
    const startDelivery = jest.fn();

    await expectDomainError(
      new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(riderUser(), DELIVERY_ID),
      'NOT_FOUND',
    );

    expect(startDelivery).not.toHaveBeenCalled();
    expect(calls.find((c) => c.table === 'delivery_status_history')).toBeUndefined();
  });

  it('a delivery assigned to another rider is NOT_ASSIGNED_RIDER (403), and the order is never touched', async () => {
    const { supabase } = supabaseStub([CLAIM_NO_MATCH, deliveryRow('PICKED_UP', OTHER_RIDER_ID)]);
    const startDelivery = jest.fn();

    await expectDomainError(
      new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(riderUser(RIDER_ID), DELIVERY_ID),
      'NOT_ASSIGNED_RIDER',
    );

    expect(startDelivery).not.toHaveBeenCalled();
  });

  it('a delivery with no rider at all is NOT_ASSIGNED_RIDER, never NOT_FOUND', async () => {
    const { supabase } = supabaseStub([CLAIM_NO_MATCH, deliveryRow('RIDER_SEARCHING', null)]);
    const startDelivery = jest.fn();

    await expectDomainError(
      new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(riderUser(), DELIVERY_ID),
      'NOT_ASSIGNED_RIDER',
    );

    expect(startDelivery).not.toHaveBeenCalled();
  });

  it('a delivery owned by this rider but still RIDER_ASSIGNED is INVALID_TRANSITION', async () => {
    const { supabase } = supabaseStub([CLAIM_NO_MATCH, deliveryRow('RIDER_ASSIGNED')]);
    const startDelivery = jest.fn();

    await expectDomainError(
      new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(riderUser(), DELIVERY_ID),
      'INVALID_TRANSITION',
    );

    expect(startDelivery).not.toHaveBeenCalled();
  });

  it('a delivery still AT_MERCHANT (the rider has not collected the food) is INVALID_TRANSITION', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_NO_MATCH, deliveryRow('AT_MERCHANT')]);
    const startDelivery = jest.fn();

    await expectDomainError(
      new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(riderUser(), DELIVERY_ID),
      'INVALID_TRANSITION',
    );

    expect(startDelivery).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  it('a delivery already past this step (DELIVERED) is INVALID_TRANSITION and never re-drives the order', async () => {
    const { supabase } = supabaseStub([CLAIM_NO_MATCH, deliveryRow('DELIVERED')]);
    const startDelivery = jest.fn();

    await expectDomainError(
      new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(riderUser(), DELIVERY_ID),
      'INVALID_TRANSITION',
    );

    expect(startDelivery).not.toHaveBeenCalled();
  });

  it('a failed guarded UPDATE at the transport level is INTERNAL_ERROR, and nothing else runs', async () => {
    const { supabase, calls } = supabaseStub([{ data: null, error: { message: 'connection reset' } }]);
    const startDelivery = jest.fn();

    await expectDomainError(
      new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(riderUser(), DELIVERY_ID),
      'INTERNAL_ERROR',
    );

    expect(startDelivery).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  it('a failed delivery diagnostic read is INTERNAL_ERROR, not a guessed refusal', async () => {
    const { supabase } = supabaseStub([CLAIM_NO_MATCH, { data: null, error: { message: 'connection reset' } }]);
    const startDelivery = jest.fn();

    await expectDomainError(
      new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(riderUser(), DELIVERY_ID),
      'INTERNAL_ERROR',
    );

    expect(startDelivery).not.toHaveBeenCalled();
  });
});

describe('DeliveryEnRouteService — repair on retry (delivery already EN_ROUTE and still ours)', () => {
  it('re-attempts only the order half and repairs it, writing no second history row and no second delivery UPDATE', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_NO_MATCH, deliveryRow('EN_ROUTE')]);
    const startDelivery = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERING' });
    const user = riderUser();

    const result = await new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(
      user,
      DELIVERY_ID,
    );

    expect(result).toEqual({
      deliveryId: DELIVERY_ID,
      orderId: ORDER_ID,
      state: 'EN_ROUTE',
      orderState: 'DELIVERING',
      riderId: RIDER_ID,
    });

    // The order half was genuinely re-attempted — this is the repair.
    expect(startDelivery).toHaveBeenCalledTimes(1);
    expect(startDelivery).toHaveBeenCalledWith(user, ORDER_ID);

    // ...and no second history row: the request that moved the delivery already wrote it.
    expect(calls.find((c) => c.table === 'delivery_status_history')).toBeUndefined();
    // Exactly one guarded UPDATE was *attempted* (it matched nothing); the
    // repair path never re-runs the delivery transition.
    expect(calls.filter((c) => c.op === 'update')).toHaveLength(1);
  });

  it('an already-repaired pair (delivery EN_ROUTE, order DELIVERING) is idempotent: no duplicate history, no forced write', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_NO_MATCH, deliveryRow('EN_ROUTE'), orderRow('DELIVERING')]);
    // The order's own guarded UPDATE matches nothing and refuses — as it should.
    const startDelivery = jest.fn().mockRejectedValue(new DomainError('INVALID_TRANSITION', { details: {} }));

    const result = await new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(
      riderUser(),
      DELIVERY_ID,
    );

    // The caller is honestly told the state they are genuinely left in.
    expect(result.state).toBe('EN_ROUTE');
    expect(result.orderState).toBe('DELIVERING');
    expect(calls.find((c) => c.table === 'delivery_status_history')).toBeUndefined();
    expect(calls.filter((c) => c.op === 'update' && c.table === 'deliveries')).toHaveLength(1);
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  it('a CANCELLED order is NEVER forced to DELIVERING — the original error propagates and no order write occurs', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_NO_MATCH, deliveryRow('EN_ROUTE'), orderRow('CANCELLED')]);
    const startDelivery = jest.fn().mockRejectedValue(new DomainError('INVALID_TRANSITION', { details: {} }));

    await expectDomainError(
      new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(riderUser(), DELIVERY_ID),
      'INVALID_TRANSITION',
    );

    // startDelivery's own guarded WHERE state='PICKED_UP' matched nothing: the
    // order was read for diagnosis only and never written by this service.
    expect(calls.find((c) => c.table === 'orders' && c.op !== 'select')).toBeUndefined();
    expect(calls.filter((c) => c.op === 'update' && c.table === 'deliveries')).toHaveLength(1);
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  it('a DELIVERED order is NEVER walked backwards to DELIVERING — the original error propagates', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_NO_MATCH, deliveryRow('EN_ROUTE'), orderRow('DELIVERED')]);
    const startDelivery = jest.fn().mockRejectedValue(new DomainError('INVALID_TRANSITION', { details: {} }));

    await expectDomainError(
      new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(riderUser(), DELIVERY_ID),
      'INVALID_TRANSITION',
    );

    expect(calls.find((c) => c.table === 'orders' && c.op !== 'select')).toBeUndefined();
  });

  it('an unexpected order state is never forced either — the original error survives unchanged', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_NO_MATCH, deliveryRow('EN_ROUTE'), orderRow('MERCHANT_ACCEPTED')]);
    const startDelivery = jest.fn().mockRejectedValue(new DomainError('INVALID_TRANSITION', { details: {} }));

    await expectDomainError(
      new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(riderUser(), DELIVERY_ID),
      'INVALID_TRANSITION',
    );

    expect(calls.find((c) => c.table === 'orders' && c.op !== 'select')).toBeUndefined();
  });

  it('an EN_ROUTE delivery belonging to another rider is NOT_ASSIGNED_RIDER and is never repairable by this caller', async () => {
    const { supabase } = supabaseStub([CLAIM_NO_MATCH, deliveryRow('EN_ROUTE', OTHER_RIDER_ID)]);
    const startDelivery = jest.fn();

    await expectDomainError(
      new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(riderUser(RIDER_ID), DELIVERY_ID),
      'NOT_ASSIGNED_RIDER',
    );

    expect(startDelivery).not.toHaveBeenCalled();
  });
});

describe('DeliveryEnRouteService — order transition failure (fail closed, no false success)', () => {
  it('the delivery moved but the order did not: the order error propagates unmodified, and the delivery is never re-updated to undo it', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_OK, OK, orderRow('PICKED_UP')]);
    const startDelivery = jest.fn().mockRejectedValue(new DomainError('INVALID_TRANSITION', { details: {} }));

    await expectDomainError(
      new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(riderUser(), DELIVERY_ID),
      'INVALID_TRANSITION',
    );

    expect(startDelivery).toHaveBeenCalledTimes(1);
    // The delivery UPDATE already ran (and, in the real database, already
    // committed) — this service never calls it a second time to "undo" it.
    expect(calls.filter((c) => c.op === 'update' && c.table === 'deliveries')).toHaveLength(1);
  });

  it('an order not found (deleted/inconsistent) surfaces its own NOT_FOUND unmodified, never reclassified', async () => {
    const { supabase } = supabaseStub([CLAIM_OK, OK, { data: null, error: null }]);
    const startDelivery = jest
      .fn()
      .mockRejectedValue(new DomainError('NOT_FOUND', { message: 'Order not found' }));

    await expectDomainError(
      new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(riderUser(), DELIVERY_ID),
      'NOT_FOUND',
    );
  });

  it('an unexpected (non-DomainError) failure from the order transition still propagates, not swallowed into a false success', async () => {
    const { supabase } = supabaseStub([CLAIM_OK, OK, orderRow('PICKED_UP')]);
    const startDelivery = jest.fn().mockRejectedValue(new Error('connection reset'));

    await expect(
      new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(riderUser(), DELIVERY_ID),
    ).rejects.toThrow('connection reset');
  });

  it('a failed order-state diagnostic read does not mask the original order error', async () => {
    const { supabase } = supabaseStub([
      CLAIM_OK,
      OK,
      { data: null, error: { message: 'connection reset' } }, // diagnosis itself fails
    ]);
    const startDelivery = jest.fn().mockRejectedValue(new DomainError('INVALID_TRANSITION', { details: {} }));

    await expectDomainError(
      new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(riderUser(), DELIVERY_ID),
      'INVALID_TRANSITION',
    );
  });
});

describe('DeliveryEnRouteService — concurrency', () => {
  it('the loser of two concurrent requests performs no delivery transition and writes no history row', async () => {
    const { supabase, calls } = supabaseStub([
      CLAIM_NO_MATCH, // this request's guarded UPDATE lost the race
      deliveryRow('EN_ROUTE'), // the winner already moved it
      orderRow('DELIVERING'), // the winner already advanced the order too
    ]);
    // The loser's order attempt hits the winner's committed DELIVERING and is refused.
    const startDelivery = jest.fn().mockRejectedValue(new DomainError('INVALID_TRANSITION', { details: {} }));

    const result = await new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(
      riderUser(),
      DELIVERY_ID,
    );

    // Idempotent: the loser reports the state the caller is genuinely left in.
    expect(result.state).toBe('EN_ROUTE');
    // Exactly one guarded UPDATE was attempted (it is always the authority),
    // and it matched nothing — so the loser transitioned no delivery.
    const updates = calls.filter((c) => c.op === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0]?.eq).toMatchObject({ state: 'PICKED_UP' });
    // Critically: no history row, and no write of any kind, from the loser.
    expect(calls.find((c) => c.table === 'delivery_status_history')).toBeUndefined();
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  it('only the guarded-UPDATE winner ever writes history — the losing path has no code route to it', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_NO_MATCH, deliveryRow('EN_ROUTE')]);
    const startDelivery = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERING' });

    await new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(riderUser(), DELIVERY_ID);

    expect(calls.filter((c) => c.table === 'delivery_status_history')).toHaveLength(0);
  });

  it('a winner and a loser together produce exactly one history row and one committed transition', async () => {
    // The winner: guarded UPDATE matches, history written, order advanced.
    const winner = supabaseStub([CLAIM_OK, OK]);
    const winnerOrders = ordersStub(jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERING' }));
    // The loser: same delivery, moments later.
    const loser = supabaseStub([CLAIM_NO_MATCH, deliveryRow('EN_ROUTE'), orderRow('DELIVERING')]);
    const loserOrders = ordersStub(jest.fn().mockRejectedValue(new DomainError('INVALID_TRANSITION', { details: {} })));

    const [winnerResult, loserResult] = await Promise.all([
      new DeliveryEnRouteService(winner.supabase, winnerOrders).startDelivery(riderUser(), DELIVERY_ID),
      new DeliveryEnRouteService(loser.supabase, loserOrders).startDelivery(riderUser(), DELIVERY_ID),
    ]);

    // Both callers are told the same, true thing.
    expect(winnerResult.state).toBe('EN_ROUTE');
    expect(loserResult.state).toBe('EN_ROUTE');

    // Across both requests: exactly one history row, from the winner alone.
    const historyRows = [...winner.calls, ...loser.calls].filter((c) => c.table === 'delivery_status_history');
    expect(historyRows).toHaveLength(1);
  });
});

describe('DeliveryEnRouteService — history write failure', () => {
  it('a delivery_status_history insert failure is INTERNAL_ERROR and stops before the order is touched', async () => {
    const { supabase } = supabaseStub([CLAIM_OK, { data: null, error: { message: 'connection reset' } }]);
    const startDelivery = jest.fn();

    await expectDomainError(
      new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(riderUser(), DELIVERY_ID),
      'INTERNAL_ERROR',
    );

    // History now precedes the order transition, so a history failure means the
    // order is never attempted — the retry will re-drive it through the repair path.
    expect(startDelivery).not.toHaveBeenCalled();
  });
});

describe('DeliveryEnRouteService — rider identity', () => {
  it("fails closed if the route is ever wired without @Roles('RIDER'), and never reads the request body/URL for identity", async () => {
    const { supabase, calls } = supabaseStub([]);
    const startDelivery = jest.fn();

    await expectDomainError(
      new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(riderUser(null), DELIVERY_ID),
      'FORBIDDEN',
    );

    expect(calls).toHaveLength(0);
    expect(startDelivery).not.toHaveBeenCalled();
  });

  it("the guarded UPDATE is filtered on the authenticated capability's riderId, never a value supplied elsewhere", async () => {
    const { supabase, calls } = supabaseStub([CLAIM_OK, OK]);
    const startDelivery = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERING' });

    await new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(riderUser(RIDER_ID), DELIVERY_ID);

    const update = calls.find((c) => c.op === 'update');
    expect(update?.eq.rider_id).toBe(RIDER_ID);
    // ...and the history row is attributed to that same identity.
    const history = calls.find((c) => c.table === 'delivery_status_history');
    expect(history?.payload).toMatchObject({ actor_id: RIDER_ID, actor_type: 'RIDER' });
  });

  it('one rider cannot act on another rider\'s delivery even when the delivery id is valid', async () => {
    // The guarded UPDATE's rider_id filter is what refuses this; the diagnostic
    // read only explains it.
    const { supabase, calls } = supabaseStub([CLAIM_NO_MATCH, deliveryRow('PICKED_UP', OTHER_RIDER_ID)]);
    const startDelivery = jest.fn();

    await expectDomainError(
      new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(riderUser(RIDER_ID), DELIVERY_ID),
      'NOT_ASSIGNED_RIDER',
    );

    expect(calls.find((c) => c.op === 'update')?.eq.rider_id).toBe(RIDER_ID);
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });
});

describe('DeliveryEnRouteService — table and money isolation', () => {
  it('touches only deliveries and delivery_status_history directly — order writes go exclusively through OrdersService', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_OK, OK]);
    const startDelivery = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERING' });

    await new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(riderUser(), DELIVERY_ID);

    const tables = [...new Set(calls.map((c) => c.table))].sort();
    expect(tables).toEqual(['deliveries', 'delivery_status_history']);

    // No money field of any kind is written — BQ-029 is OPEN and a value here
    // would be invented.
    for (const call of calls) {
      const keys = Object.keys(call.payload ?? {});
      expect(keys.filter((k) => k.includes('satang'))).toEqual([]);
      expect(keys.filter((k) => k.includes('earning'))).toEqual([]);
    }

    // Forbidden tables: never referenced anywhere in this service's own access.
    const forbidden = [
      'payments',
      'payment_events',
      'payment_attempts',
      'payment_transactions',
      'rider_assignment_attempts',
      'rider_assignments',
      'rider_availability',
      'reconciliation_cases',
      'ledger_entries',
      'ledger_entry_groups',
      'settlements',
      'refunds',
      'order_status_history',
    ];
    for (const table of forbidden) {
      expect(calls.find((c) => c.table === table)).toBeUndefined();
    }
  });

  it('the only `orders` access this service ever makes is a read — every order WRITE goes through OrdersService', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_NO_MATCH, deliveryRow('EN_ROUTE'), orderRow('CANCELLED')]);
    const startDelivery = jest.fn().mockRejectedValue(new DomainError('INVALID_TRANSITION', { details: {} }));

    await expectDomainError(
      new DeliveryEnRouteService(supabase, ordersStub(startDelivery)).startDelivery(riderUser(), DELIVERY_ID),
      'INVALID_TRANSITION',
    );

    const orderCalls = calls.filter((c) => c.table === 'orders');
    expect(orderCalls).toHaveLength(1);
    expect(orderCalls[0]?.op).toBe('select');
    // order_status_history stays inside OrdersService, which this service does not modify.
    expect(calls.find((c) => c.table === 'order_status_history')).toBeUndefined();
  });
});
