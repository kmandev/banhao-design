import { DeliveryCompletionService } from './delivery-completion.service';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { OrdersService } from '../orders/orders.service';

/**
 * `POST /api/v1/rider/deliveries/:id/delivered` — Phase G-7.2, the terminal
 * rider transition.
 *
 * Same stub shape as `delivery-en-route.service.spec.ts`: the `deliveries`,
 * `rider_assignments` and `rider_availability` sides go through the Supabase
 * builder stub, while `OrdersService` is a genuine collaborator (not
 * reimplemented) and so is stubbed as a jest mock.
 *
 * The assertions below are deliberately about **observable effects** — which
 * table was written, with which `WHERE` filters, what payload, how many
 * history rows exist, what state the caller is left in — not merely that a
 * mock was called. The `active_delivery_count` assertions in particular check
 * the guard value, not only the written value: a blind `= 0` would pass a
 * naive "was it set to zero" test and would still be wrong.
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
const DELIVERED_AT = '2026-08-26T11:00:00.000Z';

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
  data: {
    id: DELIVERY_ID,
    state: 'DELIVERED',
    rider_id: RIDER_ID,
    order_id: ORDER_ID,
    delivered_at: DELIVERED_AT,
  },
  error: null,
};
const CLAIM_NO_MATCH: Result = { data: null, error: null };
const OK: Result = { data: null, error: null };

/** A diagnostic read of the delivery, for the repair/refusal paths. */
function deliveryRow(state: string, riderId: string | null = RIDER_ID): Result {
  return {
    data: {
      id: DELIVERY_ID,
      state,
      rider_id: riderId,
      order_id: ORDER_ID,
      delivered_at: state === 'DELIVERED' ? DELIVERED_AT : null,
    },
    error: null,
  };
}

/** The `rider_assignments` row the close matched. */
const ASSIGNMENT_CLOSED: Result = { data: { id: 'assignment-1' }, error: null };
/** The guard matched nothing — already COMPLETED, or never recorded. */
const ASSIGNMENT_NO_MATCH: Result = { data: null, error: null };

/** The `1 -> 0` CAS matched: this request released the slot. */
const SLOT_RELEASED: Result = {
  data: { rider_id: RIDER_ID, active_delivery_count: 0 },
  error: null,
};
/** The CAS matched nothing — the diagnostic read decides whether that is benign. */
const SLOT_NO_MATCH: Result = { data: null, error: null };
function availabilityRow(count: number): Result {
  return { data: { rider_id: RIDER_ID, active_delivery_count: count }, error: null };
}

/** A diagnostic read of `orders.state`. */
function orderRow(state: string): Result {
  return { data: { state }, error: null };
}

function ordersStub(completeDelivery: jest.Mock) {
  return { completeDelivery } as unknown as OrdersService;
}

async function expectDomainError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await promise.catch((error: DomainError) => expect(error.code).toBe(code));
}

/** The happy path's four Supabase results, in the order the service issues them. */
const HAPPY_PATH: Result[] = [CLAIM_OK, OK, ASSIGNMENT_CLOSED, SLOT_RELEASED];

describe('DeliveryCompletionService — successful completion (EN_ROUTE -> DELIVERED)', () => {
  it('transitions the delivery with a guarded UPDATE carrying ownership and pre-state', async () => {
    const { supabase, calls } = supabaseStub(HAPPY_PATH);
    const completeDelivery = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERED' });
    const service = new DeliveryCompletionService(supabase, ordersStub(completeDelivery));

    await service.complete(riderUser(), DELIVERY_ID);

    const claim = calls[0];
    expect(claim?.table).toBe('deliveries');
    expect(claim?.op).toBe('update');
    expect(claim?.eq).toEqual({ id: DELIVERY_ID, state: 'EN_ROUTE', rider_id: RIDER_ID });
    expect(claim?.payload).toMatchObject({ state: 'DELIVERED' });
    expect(typeof claim?.payload?.delivered_at).toBe('string');
  });

  it('appends exactly one history row, EN_ROUTE -> DELIVERED, actor RIDER', async () => {
    const { supabase, calls } = supabaseStub(HAPPY_PATH);
    const completeDelivery = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERED' });
    const service = new DeliveryCompletionService(supabase, ordersStub(completeDelivery));

    await service.complete(riderUser(), DELIVERY_ID);

    const history = calls.filter((call) => call.table === 'delivery_status_history');
    expect(history).toHaveLength(1);
    expect(history[0]?.op).toBe('insert');
    expect(history[0]?.payload).toMatchObject({
      delivery_id: DELIVERY_ID,
      from_state: 'EN_ROUTE',
      to_state: 'DELIVERED',
      actor_type: 'RIDER',
      actor_id: RIDER_ID,
    });
  });

  it('closes this rider’s ACCEPTED assignment as COMPLETED, matched on delivery AND rider', async () => {
    const { supabase, calls } = supabaseStub(HAPPY_PATH);
    const completeDelivery = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERED' });
    const service = new DeliveryCompletionService(supabase, ordersStub(completeDelivery));

    await service.complete(riderUser(), DELIVERY_ID);

    const assignment = calls.find((call) => call.table === 'rider_assignments');
    expect(assignment?.op).toBe('update');
    // delivery_id alone would be able to cross-close another rider's row.
    expect(assignment?.eq).toEqual({
      delivery_id: DELIVERY_ID,
      rider_id: RIDER_ID,
      status: 'ACCEPTED',
    });
    expect(assignment?.payload).toMatchObject({ status: 'COMPLETED' });
    expect(typeof assignment?.payload?.closed_at).toBe('string');
  });

  it('releases the rider slot with a guarded 1 -> 0 CAS, never a blind write', async () => {
    const { supabase, calls } = supabaseStub(HAPPY_PATH);
    const completeDelivery = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERED' });
    const service = new DeliveryCompletionService(supabase, ordersStub(completeDelivery));

    await service.complete(riderUser(), DELIVERY_ID);

    const availability = calls.find((call) => call.table === 'rider_availability');
    expect(availability?.op).toBe('update');
    expect(availability?.payload).toEqual({ active_delivery_count: 0 });
    // The guard is the whole point: an unconditional write would clobber a
    // slot a different, concurrently accepted delivery had legitimately taken.
    expect(availability?.eq).toEqual({ rider_id: RIDER_ID, active_delivery_count: 1 });
  });

  it('transitions the order through OrdersService.completeDelivery, not a second implementation', async () => {
    const { supabase } = supabaseStub(HAPPY_PATH);
    const completeDelivery = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERED' });
    const user = riderUser();
    const service = new DeliveryCompletionService(supabase, ordersStub(completeDelivery));

    await service.complete(user, DELIVERY_ID);

    expect(completeDelivery).toHaveBeenCalledTimes(1);
    expect(completeDelivery).toHaveBeenCalledWith(user, ORDER_ID);
  });

  it('writes the history row before the assignment, slot and order are touched', async () => {
    const { supabase, calls } = supabaseStub(HAPPY_PATH);
    const completeDelivery = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERED' });
    const service = new DeliveryCompletionService(supabase, ordersStub(completeDelivery));

    await service.complete(riderUser(), DELIVERY_ID);

    expect(calls.map((call) => call.table)).toEqual([
      'deliveries',
      'delivery_status_history',
      'rider_assignments',
      'rider_availability',
    ]);
  });

  it('never nulls rider_id and never touches reassignment_count', async () => {
    const { supabase, calls } = supabaseStub(HAPPY_PATH);
    const completeDelivery = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERED' });
    const service = new DeliveryCompletionService(supabase, ordersStub(completeDelivery));

    await service.complete(riderUser(), DELIVERY_ID);

    // Completion keeps rider_id as the record of who delivered — that is the
    // difference between this path and release_rider_assignment().
    const claim = calls[0];
    expect(claim?.payload).not.toHaveProperty('rider_id');
    expect(claim?.payload).not.toHaveProperty('reassignment_count');
  });

  it('writes no proof photo — POD is the next phase', async () => {
    const { supabase, calls } = supabaseStub(HAPPY_PATH);
    const completeDelivery = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERED' });
    const service = new DeliveryCompletionService(supabase, ordersStub(completeDelivery));

    await service.complete(riderUser(), DELIVERY_ID);

    expect(calls[0]?.payload).not.toHaveProperty('proof_photo_path');
  });

  it('returns one DELIVERED state for both domains, plus delivered_at', async () => {
    const { supabase } = supabaseStub(HAPPY_PATH);
    const completeDelivery = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERED' });
    const service = new DeliveryCompletionService(supabase, ordersStub(completeDelivery));

    await expect(service.complete(riderUser(), DELIVERY_ID)).resolves.toEqual({
      deliveryId: DELIVERY_ID,
      orderId: ORDER_ID,
      state: 'DELIVERED',
      deliveredAt: DELIVERED_AT,
      riderId: RIDER_ID,
    });
  });

  it('carries no money field', async () => {
    const { supabase } = supabaseStub(HAPPY_PATH);
    const completeDelivery = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERED' });
    const service = new DeliveryCompletionService(supabase, ordersStub(completeDelivery));

    const response = await service.complete(riderUser(), DELIVERY_ID);

    for (const key of Object.keys(response)) {
      expect(key).not.toMatch(/satang|earning|fee|amount/i);
    }
  });
});

describe('DeliveryCompletionService — refusals', () => {
  it('refuses a caller with no rider capability, before any read', async () => {
    const { supabase, calls } = supabaseStub([]);
    const service = new DeliveryCompletionService(supabase, ordersStub(jest.fn()));

    await expectDomainError(service.complete(riderUser(null), DELIVERY_ID), 'FORBIDDEN');
    expect(calls).toHaveLength(0);
  });

  it('refuses a delivery that does not exist with NOT_FOUND', async () => {
    const { supabase } = supabaseStub([CLAIM_NO_MATCH, { data: null, error: null }]);
    const service = new DeliveryCompletionService(supabase, ordersStub(jest.fn()));

    await expectDomainError(service.complete(riderUser(), DELIVERY_ID), 'NOT_FOUND');
  });

  it('refuses a delivery assigned to another rider with NOT_ASSIGNED_RIDER', async () => {
    const { supabase } = supabaseStub([CLAIM_NO_MATCH, deliveryRow('EN_ROUTE', OTHER_RIDER_ID)]);
    const service = new DeliveryCompletionService(supabase, ordersStub(jest.fn()));

    await expectDomainError(service.complete(riderUser(), DELIVERY_ID), 'NOT_ASSIGNED_RIDER');
  });

  it('never touches another rider’s assignment or slot when refusing', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_NO_MATCH, deliveryRow('DELIVERED', OTHER_RIDER_ID)]);
    const completeDelivery = jest.fn();
    const service = new DeliveryCompletionService(supabase, ordersStub(completeDelivery));

    await expectDomainError(service.complete(riderUser(), DELIVERY_ID), 'NOT_ASSIGNED_RIDER');

    // A delivery already DELIVERED by someone else must not be repairable by
    // this caller: no assignment close, no slot release, no order write.
    expect(calls.some((call) => call.table === 'rider_assignments')).toBe(false);
    expect(calls.some((call) => call.table === 'rider_availability')).toBe(false);
    expect(completeDelivery).not.toHaveBeenCalled();
  });

  it.each(['RIDER_ASSIGNED', 'AT_MERCHANT', 'PICKED_UP', 'FAILED', 'ABANDONED'])(
    'refuses a delivery in %s with INVALID_TRANSITION',
    async (state) => {
      const { supabase } = supabaseStub([CLAIM_NO_MATCH, deliveryRow(state)]);
      const completeDelivery = jest.fn();
      const service = new DeliveryCompletionService(supabase, ordersStub(completeDelivery));

      await expectDomainError(service.complete(riderUser(), DELIVERY_ID), 'INVALID_TRANSITION');
      expect(completeDelivery).not.toHaveBeenCalled();
    },
  );

  it('surfaces a claim transport failure as INTERNAL_ERROR, not a false refusal', async () => {
    const { supabase } = supabaseStub([{ data: null, error: { message: 'connection reset' } }]);
    const service = new DeliveryCompletionService(supabase, ordersStub(jest.fn()));

    await expectDomainError(service.complete(riderUser(), DELIVERY_ID), 'INTERNAL_ERROR');
  });
});

describe('DeliveryCompletionService — idempotency and the repair path', () => {
  it('reports success for a retry on an already-DELIVERED delivery still owned by the caller', async () => {
    const { supabase } = supabaseStub([
      CLAIM_NO_MATCH,
      deliveryRow('DELIVERED'),
      ASSIGNMENT_NO_MATCH,
      SLOT_NO_MATCH,
      availabilityRow(0),
    ]);
    const completeDelivery = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERED' });
    const service = new DeliveryCompletionService(supabase, ordersStub(completeDelivery));

    await expect(service.complete(riderUser(), DELIVERY_ID)).resolves.toEqual({
      deliveryId: DELIVERY_ID,
      orderId: ORDER_ID,
      state: 'DELIVERED',
      deliveredAt: DELIVERED_AT,
      riderId: RIDER_ID,
    });
  });

  it('writes NO second history row on the repair path', async () => {
    const { supabase, calls } = supabaseStub([
      CLAIM_NO_MATCH,
      deliveryRow('DELIVERED'),
      ASSIGNMENT_NO_MATCH,
      SLOT_NO_MATCH,
      availabilityRow(0),
    ]);
    const completeDelivery = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERED' });
    const service = new DeliveryCompletionService(supabase, ordersStub(completeDelivery));

    await service.complete(riderUser(), DELIVERY_ID);

    // delivery_status_history has no unique constraint, so "exactly one row"
    // is only true because the repair path never writes one.
    expect(calls.filter((call) => call.table === 'delivery_status_history')).toHaveLength(0);
  });

  it('re-runs the whole tail on repair, not just the order half', async () => {
    const { supabase, calls } = supabaseStub([
      CLAIM_NO_MATCH,
      deliveryRow('DELIVERED'),
      ASSIGNMENT_CLOSED,
      SLOT_RELEASED,
    ]);
    const completeDelivery = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERED' });
    const service = new DeliveryCompletionService(supabase, ordersStub(completeDelivery));

    await service.complete(riderUser(), DELIVERY_ID);

    // A crash after the delivery UPDATE but before the slot release would
    // otherwise leave the rider holding a slot forever.
    expect(calls.some((call) => call.table === 'rider_assignments')).toBe(true);
    expect(calls.some((call) => call.table === 'rider_availability')).toBe(true);
    expect(completeDelivery).toHaveBeenCalledWith(riderUser(), ORDER_ID);
  });

  it('treats an already-COMPLETED assignment as success rather than an error', async () => {
    const { supabase } = supabaseStub([CLAIM_OK, OK, ASSIGNMENT_NO_MATCH, SLOT_RELEASED]);
    const completeDelivery = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERED' });
    const service = new DeliveryCompletionService(supabase, ordersStub(completeDelivery));

    await expect(service.complete(riderUser(), DELIVERY_ID)).resolves.toMatchObject({
      state: 'DELIVERED',
    });
  });

  it('treats an already-zero slot as released rather than an error', async () => {
    const { supabase } = supabaseStub([
      CLAIM_OK,
      OK,
      ASSIGNMENT_CLOSED,
      SLOT_NO_MATCH,
      availabilityRow(0),
    ]);
    const completeDelivery = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERED' });
    const service = new DeliveryCompletionService(supabase, ordersStub(completeDelivery));

    await expect(service.complete(riderUser(), DELIVERY_ID)).resolves.toMatchObject({
      state: 'DELIVERED',
    });
  });

  it('fails closed when the rider has no rider_availability row at all', async () => {
    const { supabase } = supabaseStub([
      CLAIM_OK,
      OK,
      ASSIGNMENT_CLOSED,
      SLOT_NO_MATCH,
      { data: null, error: null },
    ]);
    const completeDelivery = jest.fn();
    const service = new DeliveryCompletionService(supabase, ordersStub(completeDelivery));

    // Reporting a clean completion here would tell the rider they are free to
    // take new work without that being confirmable.
    await expectDomainError(service.complete(riderUser(), DELIVERY_ID), 'INTERNAL_ERROR');
    expect(completeDelivery).not.toHaveBeenCalled();
  });

  it('fails closed when the slot could not be released and is still held', async () => {
    const { supabase } = supabaseStub([
      CLAIM_OK,
      OK,
      ASSIGNMENT_CLOSED,
      SLOT_NO_MATCH,
      availabilityRow(2),
    ]);
    const service = new DeliveryCompletionService(supabase, ordersStub(jest.fn()));

    await expectDomainError(service.complete(riderUser(), DELIVERY_ID), 'INTERNAL_ERROR');
  });

  it('reports success when the order was already DELIVERED by a concurrent request', async () => {
    const { supabase } = supabaseStub([
      CLAIM_OK,
      OK,
      ASSIGNMENT_CLOSED,
      SLOT_RELEASED,
      orderRow('DELIVERED'),
    ]);
    const completeDelivery = jest.fn().mockRejectedValue(new DomainError('INVALID_TRANSITION'));
    const service = new DeliveryCompletionService(supabase, ordersStub(completeDelivery));

    await expect(service.complete(riderUser(), DELIVERY_ID)).resolves.toMatchObject({
      state: 'DELIVERED',
    });
  });

  it('propagates the order error unchanged when the order genuinely did not move', async () => {
    const { supabase } = supabaseStub([
      CLAIM_OK,
      OK,
      ASSIGNMENT_CLOSED,
      SLOT_RELEASED,
      orderRow('CANCELLED'),
    ]);
    const completeDelivery = jest.fn().mockRejectedValue(new DomainError('INVALID_TRANSITION'));
    const service = new DeliveryCompletionService(supabase, ordersStub(completeDelivery));

    // The delivery stays DELIVERED; a retry re-enters the repair path.
    await expectDomainError(service.complete(riderUser(), DELIVERY_ID), 'INVALID_TRANSITION');
  });

  it('never re-attempts the order write after diagnosing it as already delivered', async () => {
    const { supabase } = supabaseStub([
      CLAIM_OK,
      OK,
      ASSIGNMENT_CLOSED,
      SLOT_RELEASED,
      orderRow('DELIVERED'),
    ]);
    const completeDelivery = jest.fn().mockRejectedValue(new DomainError('INVALID_TRANSITION'));
    const service = new DeliveryCompletionService(supabase, ordersStub(completeDelivery));

    await service.complete(riderUser(), DELIVERY_ID);

    expect(completeDelivery).toHaveBeenCalledTimes(1);
  });
});

describe('DeliveryCompletionService — concurrency', () => {
  it('lets exactly one of two concurrent calls win the guarded UPDATE and write history', async () => {
    // Winner: claim matches, writes history, finishes the tail.
    const winner = supabaseStub(HAPPY_PATH);
    // Loser: claim matches nothing, diagnoses DELIVERED-and-ours, repairs.
    const loser = supabaseStub([
      CLAIM_NO_MATCH,
      deliveryRow('DELIVERED'),
      ASSIGNMENT_NO_MATCH,
      SLOT_NO_MATCH,
      availabilityRow(0),
    ]);

    const winnerOrders = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERED' });
    const loserOrders = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERED' });

    const [a, b] = await Promise.all([
      new DeliveryCompletionService(winner.supabase, ordersStub(winnerOrders)).complete(
        riderUser(),
        DELIVERY_ID,
      ),
      new DeliveryCompletionService(loser.supabase, ordersStub(loserOrders)).complete(
        riderUser(),
        DELIVERY_ID,
      ),
    ]);

    // Both callers are told the truth — the delivery is DELIVERED.
    expect(a.state).toBe('DELIVERED');
    expect(b.state).toBe('DELIVERED');

    // But only one history row exists across both requests.
    const historyRows = [...winner.calls, ...loser.calls].filter(
      (call) => call.table === 'delivery_status_history',
    );
    expect(historyRows).toHaveLength(1);
  });
});
