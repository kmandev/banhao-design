import { DeliveryFailureService } from './delivery-failure.service';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { OrdersService } from '../orders/orders.service';

/**
 * `POST /api/v1/admin/supervisor/deliveries/:id/fail` — BQ-017 Slice #2,
 * DEC-053's operator failure resolution.
 *
 * The stub records the filters and payload of every statement, so the guarded
 * writes can be asserted directly rather than inferred from a mock's call
 * count. `OrdersService` is a genuine collaborator (never reimplemented here)
 * and so is a jest mock, exactly as `delivery-completion.service.spec.ts`
 * treats it.
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

const DELIVERY_ID = 'delivery-1';
const ORDER_ID = 'order-1';
const RIDER_ID = 'rider-1';
const CUSTOMER_ID = 'customer-1';
const RESTAURANT_ID = 'restaurant-1';
const MERCHANT_ID = 'merchant-1';
const MERCHANT_OWNER_ID = 'merchant-owner-1';
const STAFF_USER_ID = 'staff-1';

/** Well past DEC-053's five-minute wait. */
const LONG_AGO = new Date(Date.now() - 20 * 60 * 1000).toISOString();
/** Inside it. */
const JUST_NOW = new Date(Date.now() - 30 * 1000).toISOString();
const FAILED_AT = '2026-09-07T10:00:00.000Z';

function staffUser(staffRole: 'OPERATOR' | 'ADMIN' = 'OPERATOR'): AuthenticatedUser {
  return {
    id: STAFF_USER_ID,
    phone: '+66800000001',
    capabilities: {
      customer: true,
      merchant: [],
      rider: null,
      platformStaff: { staffRole },
    },
  };
}

function nonStaffUser(): AuthenticatedUser {
  return {
    id: 'user-2',
    phone: '+66800000002',
    capabilities: { customer: true, merchant: [], rider: null, platformStaff: null },
  };
}

function deliveryRow(overrides: Record<string, unknown> = {}): Result {
  return {
    data: {
      id: DELIVERY_ID,
      state: 'ARRIVED',
      rider_id: RIDER_ID,
      order_id: ORDER_ID,
      arrived_at: LONG_AGO,
      failed_at: null,
      failure_cause: null,
      ...overrides,
    },
    error: null,
  };
}

function orderRow(overrides: Record<string, unknown> = {}): Result {
  return {
    data: {
      id: ORDER_ID,
      state: 'DELIVERING',
      cause_code: null,
      customer_id: CUSTOMER_ID,
      restaurant_id: RESTAURANT_ID,
      ...overrides,
    },
    error: null,
  };
}

function attemptCount(count: number): Result {
  return { data: null, count, error: null };
}

/** The guarded UPDATE matched: this request moved the delivery. */
function claimed(overrides: Record<string, unknown> = {}): Result {
  return deliveryRow({ state: 'FAILED', failed_at: FAILED_AT, failure_cause: 'CUSTOMER_UNREACHABLE', ...overrides });
}

const NO_MATCH: Result = { data: null, error: null };
const OK: Result = { data: null, error: null };
const SLOT_RELEASED: Result = { data: { rider_id: RIDER_ID, active_delivery_count: 0 }, error: null };
const ASSIGNMENT_CLOSED: Result = { data: { id: 'assignment-1' }, error: null };
const RESTAURANT: Result = { data: { merchant_id: MERCHANT_ID }, error: null };
const MERCHANT: Result = { data: { owner_user_id: MERCHANT_OWNER_ID }, error: null };

const REQUEST = { causeCode: 'CUSTOMER_UNREACHABLE', reason: 'ไม่รับสาย 2 ครั้ง' } as const;

/**
 * The winner's full statement sequence: read delivery, read order, count
 * attempts, claim, history, close assignment, release slot, order half,
 * audit, then the outbox event's own recipient resolution.
 */
function happyPath(): Result[] {
  return [
    deliveryRow(),
    orderRow(),
    attemptCount(2),
    claimed(),
    OK, // delivery_status_history
    ASSIGNMENT_CLOSED,
    SLOT_RELEASED,
    OK, // audit_logs
    orderRow(), // outbox recipient resolution
    RESTAURANT,
    MERCHANT,
    OK, // outbox insert
  ];
}

function ordersStub(failDelivery: jest.Mock): OrdersService {
  return { failDelivery } as unknown as OrdersService;
}

function buildService(supabase: SupabaseService, orders: OrdersService): DeliveryFailureService {
  return new DeliveryFailureService(supabase, orders);
}

async function expectDomainError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await promise.catch((error: DomainError) => expect(error.code).toBe(code));
}

describe('DeliveryFailureService — a successful failure resolution', () => {
  it('transitions the delivery with a guarded UPDATE, writing failed_at and the cause in the same statement', async () => {
    const { supabase, calls } = supabaseStub(happyPath());
    const failOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERY_FAILED' });

    const result = await buildService(supabase, ordersStub(failOrder)).failDelivery(
      staffUser(),
      DELIVERY_ID,
      REQUEST,
    );

    expect(result).toEqual({
      deliveryId: DELIVERY_ID,
      orderId: ORDER_ID,
      state: 'FAILED',
      orderState: 'DELIVERY_FAILED',
      causeCode: 'CUSTOMER_UNREACHABLE',
      failedAt: FAILED_AT,
    });

    const claim = calls.find((c) => c.table === 'deliveries' && c.op === 'update');
    // The pre-state guard is in the WHERE clause (ADR-003), never a prior SELECT.
    expect(claim?.eq).toEqual({ id: DELIVERY_ID, state: 'ARRIVED' });
    expect(claim?.payload).toMatchObject({ state: 'FAILED', failure_cause: 'CUSTOMER_UNREACHABLE' });
    expect(typeof claim?.payload?.['failed_at']).toBe('string');
  });

  it('writes exactly one delivery history row, ARRIVED -> FAILED, actor OPERATOR with the reason', async () => {
    const { supabase, calls } = supabaseStub(happyPath());
    const failOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERY_FAILED' });

    await buildService(supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST);

    const history = calls.filter((c) => c.table === 'delivery_status_history');
    expect(history).toHaveLength(1);
    expect(history[0]?.payload).toMatchObject({
      delivery_id: DELIVERY_ID,
      from_state: 'ARRIVED',
      to_state: 'FAILED',
      actor_type: 'OPERATOR',
      actor_id: STAFF_USER_ID,
      reason: REQUEST.reason,
    });
  });

  it('delegates the order half to OrdersService rather than writing orders itself', async () => {
    const { supabase, calls } = supabaseStub(happyPath());
    const failOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERY_FAILED' });

    await buildService(supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST);

    expect(failOrder).toHaveBeenCalledWith(
      expect.anything(),
      ORDER_ID,
      'CUSTOMER_UNREACHABLE',
      REQUEST.reason,
    );
    // No second write path: `orders` is only ever read here.
    expect(calls.filter((c) => c.table === 'orders' && c.op === 'update')).toHaveLength(0);
  });

  it('writes exactly one audit row with OPERATOR attribution, the cause and the mandatory reason', async () => {
    const { supabase, calls } = supabaseStub(happyPath());
    const failOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERY_FAILED' });

    await buildService(supabase, ordersStub(failOrder)).failDelivery(
      staffUser('ADMIN'),
      DELIVERY_ID,
      REQUEST,
    );

    const audit = calls.filter((c) => c.table === 'audit_logs');
    expect(audit).toHaveLength(1);
    expect(audit[0]?.payload).toMatchObject({
      actor_type: 'OPERATOR',
      actor_id: STAFF_USER_ID,
      action: 'DELIVERY_FAILURE_DECLARED',
      entity_type: 'delivery',
      entity_id: DELIVERY_ID,
      reason: REQUEST.reason,
      source: 'api',
    });
    // `audit_logs.actor_type` has no ADMIN value, so the grant actually held
    // is recorded alongside it — same discipline as case resolution.
    expect(audit[0]?.payload?.['after']).toMatchObject({
      causeCode: 'CUSTOMER_UNREACHABLE',
      staffRole: 'ADMIN',
    });
  });

  it('emits exactly one OrderDeliveryFailed event, to the customer and the merchant only', async () => {
    const { supabase, calls } = supabaseStub(happyPath());
    const failOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERY_FAILED' });

    await buildService(supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST);

    const outbox = calls.filter((c) => c.table === 'outbox');
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.payload).toMatchObject({
      aggregate_type: 'delivery',
      aggregate_id: DELIVERY_ID,
      event_type: 'OrderDeliveryFailed',
      payload: {
        recipients: [
          { recipientId: CUSTOMER_ID, recipientType: 'CUSTOMER' },
          { recipientId: MERCHANT_OWNER_ID, recipientType: 'MERCHANT' },
        ],
      },
    });

    // No OPERATOR recipient: OutboxDispatchService skips them by design
    // (Phase H), so one would be a row that is silently dropped.
    expect(JSON.stringify(outbox[0]?.payload)).not.toContain('OPERATOR');
  });

  it('writes no payment, refund, ledger, earning or settlement row — Q-020 and BQ-024 are OPEN', async () => {
    const { supabase, calls } = supabaseStub(happyPath());
    const failOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERY_FAILED' });

    await buildService(supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST);

    for (const forbidden of [
      'payments',
      'payment_events',
      'payment_attempts',
      'payment_transactions',
      'refunds',
      'ledger_entries',
      'ledger_entry_groups',
      'settlements',
    ]) {
      expect(calls.find((c) => c.table === forbidden)).toBeUndefined();
    }

    // And nothing financial was written onto the delivery either.
    const claim = calls.find((c) => c.table === 'deliveries' && c.op === 'update');
    expect(claim?.payload).not.toHaveProperty('rider_earning_satang');
  });
});

describe('DeliveryFailureService — rider cleanup', () => {
  it('closes the rider’s assignment as CANCELLED, never COMPLETED — the delivery was not completed', async () => {
    const { supabase, calls } = supabaseStub(happyPath());
    const failOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERY_FAILED' });

    await buildService(supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST);

    const close = calls.find((c) => c.table === 'rider_assignments');
    expect(close?.op).toBe('update');
    expect(close?.payload).toMatchObject({ status: 'CANCELLED', close_reason: 'DELIVERY_FAILED' });
    // Matched on delivery AND rider AND status, so another rider's row can
    // never be cross-closed.
    expect(close?.eq).toEqual({
      delivery_id: DELIVERY_ID,
      rider_id: RIDER_ID,
      status: 'ACCEPTED',
    });
  });

  it('releases the rider’s slot with a guarded 1 -> 0 CAS, never a blind write', async () => {
    const { supabase, calls } = supabaseStub(happyPath());
    const failOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERY_FAILED' });

    await buildService(supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST);

    const release = calls.find((c) => c.table === 'rider_availability' && c.op === 'update');
    expect(release?.payload).toEqual({ active_delivery_count: 0 });
    // The guard value, not just the written value: a blind `= 0` would pass a
    // naive assertion and would still be wrong.
    expect(release?.eq).toEqual({ rider_id: RIDER_ID, active_delivery_count: 1 });
  });

  /**
   * The slot-leak regression. Before this command existed, a post-pickup
   * operator cancellation left `active_delivery_count` at 1 forever, so the
   * rider could accept no further work.
   */
  it('always releases the slot on a successful failure — the rider is never left blocked', async () => {
    const { supabase, calls } = supabaseStub(happyPath());
    const failOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERY_FAILED' });

    await buildService(supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST);

    expect(calls.filter((c) => c.table === 'rider_availability' && c.op === 'update')).toHaveLength(1);
  });

  it('does not decrement twice on a repair — the CAS matches nothing the second time', async () => {
    const { supabase, calls } = supabaseStub([
      // A retry: the delivery is already FAILED under this same cause.
      deliveryRow({ state: 'FAILED', failed_at: FAILED_AT, failure_cause: 'CUSTOMER_UNREACHABLE' }),
      NO_MATCH, // assignment already CANCELLED
      NO_MATCH, // the 1 -> 0 CAS matches nothing
      { data: { rider_id: RIDER_ID, active_delivery_count: 0 }, error: null }, // verified already free
    ]);
    const failOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERY_FAILED' });

    await buildService(supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST);

    // One CAS attempt, which matched nothing — the count cannot go negative.
    expect(calls.filter((c) => c.table === 'rider_availability' && c.op === 'update')).toHaveLength(1);
  });

  it('raises rather than reporting success if the slot is still held after the release', async () => {
    const { supabase } = supabaseStub([
      deliveryRow(),
      orderRow(),
      attemptCount(2),
      claimed(),
      OK,
      ASSIGNMENT_CLOSED,
      NO_MATCH, // the CAS matched nothing
      { data: { rider_id: RIDER_ID, active_delivery_count: 1 }, error: null }, // still busy
    ]);
    const failOrder = jest.fn();

    await expectDomainError(
      buildService(supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST),
      'INTERNAL_ERROR',
    );
  });

  it('never calls release_rider_assignment — it refuses post-pickup and would re-offer the delivery', async () => {
    const { supabase, calls } = supabaseStub(happyPath());
    const failOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERY_FAILED' });

    await buildService(supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST);

    expect(calls.find((c) => c.table === 'release_rider_assignment')).toBeUndefined();
    // And the delivery was never sent back to search.
    const claim = calls.find((c) => c.table === 'deliveries' && c.op === 'update');
    expect(claim?.payload).not.toMatchObject({ state: 'RIDER_SEARCHING' });
    expect(claim?.payload).not.toHaveProperty('rider_id');
  });
});

describe('DeliveryFailureService — DEC-053 preconditions', () => {
  it('refuses when the delivery has fewer than 2 contact attempts', async () => {
    const { supabase, calls } = supabaseStub([deliveryRow(), orderRow(), attemptCount(1)]);
    const failOrder = jest.fn();

    await expectDomainError(
      buildService(supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST),
      'CONFLICT',
    );

    expect(calls.find((c) => c.op === 'update')).toBeUndefined();
    expect(failOrder).not.toHaveBeenCalled();
  });

  it('refuses when fewer than 5 minutes have passed since customer arrival', async () => {
    const { supabase, calls } = supabaseStub([
      deliveryRow({ arrived_at: JUST_NOW }),
      orderRow(),
      attemptCount(2),
    ]);
    const failOrder = jest.fn();

    await expectDomainError(
      buildService(supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST),
      'CONFLICT',
    );

    expect(calls.find((c) => c.op === 'update')).toBeUndefined();
  });

  it('succeeds once the 5 minutes have elapsed', async () => {
    const fiveMinutesAndABitAgo = new Date(Date.now() - 5 * 60 * 1000 - 1000).toISOString();
    const { supabase } = supabaseStub([
      deliveryRow({ arrived_at: fiveMinutesAndABitAgo }),
      ...happyPath().slice(1),
    ]);
    const failOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERY_FAILED' });

    const result = await buildService(supabase, ordersStub(failOrder)).failDelivery(
      staffUser(),
      DELIVERY_ID,
      REQUEST,
    );

    expect(result.state).toBe('FAILED');
  });

  /**
   * DEC-054's central rule: the wait is measured from **customer** arrival.
   * A delivery that has been picked up for hours but only just reached the
   * customer must still wait.
   */
  it('measures the wait from arrived_at, not from any earlier milestone', async () => {
    const { supabase, calls } = supabaseStub([
      deliveryRow({ arrived_at: JUST_NOW }),
      orderRow(),
      attemptCount(2),
    ]);
    const failOrder = jest.fn();

    await buildService(supabase, ordersStub(failOrder))
      .failDelivery(staffUser(), DELIVERY_ID, REQUEST)
      .catch((error: DomainError) => {
        expect(error.details).toMatchObject({ arrivedAt: JUST_NOW, waitSecondsRequired: 300 });
      });

    expect(calls.find((c) => c.op === 'update')).toBeUndefined();
  });

  it('refuses a delivery that is ARRIVED but carries no arrival timestamp', async () => {
    const { supabase } = supabaseStub([deliveryRow({ arrived_at: null }), orderRow(), attemptCount(2)]);
    const failOrder = jest.fn();

    await expectDomainError(
      buildService(supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST),
      'CONFLICT',
    );
  });

  it.each(['PAID', 'PREPARING', 'PICKED_UP', 'DELIVERED', 'CANCELLED'])(
    'refuses when the order is %s rather than DELIVERING',
    async (state) => {
      const { supabase, calls } = supabaseStub([deliveryRow(), orderRow({ state })]);
      const failOrder = jest.fn();

      await expectDomainError(
        buildService(supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST),
        'CONFLICT',
      );

      expect(calls.find((c) => c.op === 'update')).toBeUndefined();
    },
  );

  it.each(['EN_ROUTE', 'PICKED_UP', 'AT_MERCHANT', 'RIDER_ASSIGNED', 'RIDER_SEARCHING'])(
    'refuses a delivery in %s — only ARRIVED may be failed',
    async (state) => {
      const { supabase, calls } = supabaseStub([deliveryRow({ state })]);
      const failOrder = jest.fn();

      await expectDomainError(
        buildService(supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST),
        'INVALID_TRANSITION',
      );

      expect(calls.find((c) => c.op === 'update')).toBeUndefined();
    },
  );

  it('is NOT_FOUND for a delivery that does not exist', async () => {
    const { supabase } = supabaseStub([NO_MATCH]);
    const failOrder = jest.fn();

    await expectDomainError(
      buildService(supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST),
      'NOT_FOUND',
    );
  });

  it('has no override — a well-formed request still waits for the conditions', async () => {
    const { supabase, calls } = supabaseStub([
      deliveryRow({ arrived_at: JUST_NOW }),
      orderRow(),
      attemptCount(0),
    ]);
    const failOrder = jest.fn();

    await expectDomainError(
      buildService(supabase, ordersStub(failOrder)).failDelivery(staffUser('ADMIN'), DELIVERY_ID, {
        ...REQUEST,
        // Even an ADMIN, and even with a compelling reason.
        reason: 'customer called the office and told us to give up',
      }),
      'CONFLICT',
    );

    expect(calls.find((c) => c.op === 'update')).toBeUndefined();
  });
});

describe('DeliveryFailureService — authorization', () => {
  it('refuses a caller with no platform_staff grant, before any read', async () => {
    const { supabase, calls } = supabaseStub([]);
    const failOrder = jest.fn();

    await expectDomainError(
      buildService(supabase, ordersStub(failOrder)).failDelivery(nonStaffUser(), DELIVERY_ID, REQUEST),
      'FORBIDDEN',
    );

    expect(calls).toHaveLength(0);
  });

  it('does not scope the delivery by rider — the operator is not a party to it', async () => {
    const { supabase, calls } = supabaseStub(happyPath());
    const failOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERY_FAILED' });

    await buildService(supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST);

    const claim = calls.find((c) => c.table === 'deliveries' && c.op === 'update');
    expect(claim?.eq).not.toHaveProperty('rider_id');
  });
});

describe('DeliveryFailureService — idempotency and conflicting causes', () => {
  it('re-runs the tail and reports success for a retry under the same cause', async () => {
    const { supabase, calls } = supabaseStub([
      deliveryRow({ state: 'FAILED', failed_at: FAILED_AT, failure_cause: 'CUSTOMER_UNREACHABLE' }),
      ASSIGNMENT_CLOSED,
      SLOT_RELEASED,
    ]);
    const failOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERY_FAILED' });

    const result = await buildService(supabase, ordersStub(failOrder)).failDelivery(
      staffUser(),
      DELIVERY_ID,
      REQUEST,
    );

    expect(result.state).toBe('FAILED');
    expect(result.orderState).toBe('DELIVERY_FAILED');
    // No second transition was attempted on the delivery.
    expect(calls.filter((c) => c.table === 'deliveries' && c.op === 'update')).toHaveLength(0);
  });

  it('writes no second history, audit or outbox row on a repair', async () => {
    const { supabase, calls } = supabaseStub([
      deliveryRow({ state: 'FAILED', failed_at: FAILED_AT, failure_cause: 'CUSTOMER_UNREACHABLE' }),
      ASSIGNMENT_CLOSED,
      SLOT_RELEASED,
    ]);
    const failOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERY_FAILED' });

    await buildService(supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST);

    expect(calls.find((c) => c.table === 'delivery_status_history')).toBeUndefined();
    expect(calls.find((c) => c.table === 'audit_logs')).toBeUndefined();
    expect(calls.find((c) => c.table === 'outbox')).toBeUndefined();
  });

  it('rejects a retry that names a different cause, rather than overwriting the recorded one', async () => {
    const { supabase, calls } = supabaseStub([
      deliveryRow({ state: 'FAILED', failed_at: FAILED_AT, failure_cause: 'RIDER_CAUSED' }),
    ]);
    const failOrder = jest.fn();

    await expectDomainError(
      buildService(supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST),
      'CONFLICT',
    );

    // A cause is an economic attribution — nothing was rewritten.
    expect(calls.find((c) => c.op === 'update')).toBeUndefined();
    expect(failOrder).not.toHaveBeenCalled();
  });

  it('repairs the unfinished order half when the delivery moved but the order did not', async () => {
    const { supabase } = supabaseStub([
      deliveryRow({ state: 'FAILED', failed_at: FAILED_AT, failure_cause: 'CUSTOMER_UNREACHABLE' }),
      ASSIGNMENT_CLOSED,
      SLOT_RELEASED,
    ]);
    const failOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERY_FAILED' });

    await buildService(supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST);

    // The tail is re-run in full, which is what closes an order/delivery split.
    expect(failOrder).toHaveBeenCalledWith(
      expect.anything(),
      ORDER_ID,
      'CUSTOMER_UNREACHABLE',
      REQUEST.reason,
    );
  });

  it('treats an order already DELIVERY_FAILED under the same cause as done', async () => {
    const { supabase } = supabaseStub([
      deliveryRow({ state: 'FAILED', failed_at: FAILED_AT, failure_cause: 'CUSTOMER_UNREACHABLE' }),
      ASSIGNMENT_CLOSED,
      SLOT_RELEASED,
      orderRow({ state: 'DELIVERY_FAILED', cause_code: 'CUSTOMER_UNREACHABLE' }),
    ]);
    const failOrder = jest.fn().mockRejectedValue(new DomainError('INVALID_TRANSITION'));

    const result = await buildService(supabase, ordersStub(failOrder)).failDelivery(
      staffUser(),
      DELIVERY_ID,
      REQUEST,
    );

    expect(result.orderState).toBe('DELIVERY_FAILED');
  });

  it('conflicts when the order is already DELIVERY_FAILED under a different cause', async () => {
    const { supabase } = supabaseStub([
      deliveryRow({ state: 'FAILED', failed_at: FAILED_AT, failure_cause: 'CUSTOMER_UNREACHABLE' }),
      ASSIGNMENT_CLOSED,
      SLOT_RELEASED,
      orderRow({ state: 'DELIVERY_FAILED', cause_code: 'MERCHANT_CAUSED' }),
    ]);
    const failOrder = jest.fn().mockRejectedValue(new DomainError('INVALID_TRANSITION'));

    await expectDomainError(
      buildService(supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST),
      'CONFLICT',
    );
  });

  it('propagates the order error unchanged when the order is in no repairable state', async () => {
    const { supabase } = supabaseStub([
      deliveryRow(),
      orderRow(),
      attemptCount(2),
      claimed(),
      OK,
      ASSIGNMENT_CLOSED,
      SLOT_RELEASED,
      orderRow({ state: 'DELIVERED' }),
    ]);
    const failOrder = jest.fn().mockRejectedValue(new DomainError('INVALID_TRANSITION'));

    await expectDomainError(
      buildService(supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST),
      'INVALID_TRANSITION',
    );
  });
});

describe('DeliveryFailureService — concurrency', () => {
  /**
   * The guarded UPDATE is the only state-changing authority: exactly one of
   * two concurrent declarations moves the delivery, and the loser re-reads and
   * resolves as an idempotent repair rather than a second transition.
   */
  it('lets exactly one of two concurrent failures win, and the loser repairs', async () => {
    const winner = supabaseStub(happyPath());
    const loser = supabaseStub([
      deliveryRow(),
      orderRow(),
      attemptCount(2),
      NO_MATCH, // its guarded UPDATE matched nothing
      deliveryRow({ state: 'FAILED', failed_at: FAILED_AT, failure_cause: 'CUSTOMER_UNREACHABLE' }),
      ASSIGNMENT_CLOSED,
      SLOT_RELEASED,
    ]);
    const failOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERY_FAILED' });

    const results = await Promise.all([
      buildService(winner.supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST),
      buildService(loser.supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST),
    ]);

    // Both callers are told the truth — the delivery failed under their cause.
    expect(results.map((r) => r.state)).toEqual(['FAILED', 'FAILED']);

    // But only one wrote the history, audit and outbox rows.
    const allCalls = [...winner.calls, ...loser.calls];
    expect(allCalls.filter((c) => c.table === 'delivery_status_history')).toHaveLength(1);
    expect(allCalls.filter((c) => c.table === 'audit_logs')).toHaveLength(1);
    expect(allCalls.filter((c) => c.table === 'outbox')).toHaveLength(1);
  });

  it('refuses when a completion won the race — a DELIVERED delivery is not failable', async () => {
    const { supabase, calls } = supabaseStub([
      deliveryRow(),
      orderRow(),
      attemptCount(2),
      NO_MATCH, // the guarded UPDATE lost to the completion
      deliveryRow({ state: 'DELIVERED' }),
    ]);
    const failOrder = jest.fn();

    await expectDomainError(
      buildService(supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST),
      'INVALID_TRANSITION',
    );

    expect(failOrder).not.toHaveBeenCalled();
    expect(calls.find((c) => c.table === 'audit_logs')).toBeUndefined();
  });
});

describe('DeliveryFailureService — best-effort side effects', () => {
  it('does not fail the command when the audit write fails — the transition already happened', async () => {
    const { supabase } = supabaseStub([
      deliveryRow(),
      orderRow(),
      attemptCount(2),
      claimed(),
      OK,
      ASSIGNMENT_CLOSED,
      SLOT_RELEASED,
      { data: null, error: { message: 'connection reset' } }, // audit_logs
      orderRow(),
      RESTAURANT,
      MERCHANT,
      OK,
    ]);
    const failOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERY_FAILED' });

    const result = await buildService(supabase, ordersStub(failOrder)).failDelivery(
      staffUser(),
      DELIVERY_ID,
      REQUEST,
    );

    expect(result.state).toBe('FAILED');
  });

  it('does not fail the command when the outbox write fails', async () => {
    const { supabase } = supabaseStub([
      deliveryRow(),
      orderRow(),
      attemptCount(2),
      claimed(),
      OK,
      ASSIGNMENT_CLOSED,
      SLOT_RELEASED,
      OK,
      orderRow(),
      RESTAURANT,
      MERCHANT,
      { data: null, error: { message: 'connection reset' } }, // outbox
    ]);
    const failOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERY_FAILED' });

    const result = await buildService(supabase, ordersStub(failOrder)).failDelivery(
      staffUser(),
      DELIVERY_ID,
      REQUEST,
    );

    expect(result.state).toBe('FAILED');
  });

  it('still emits the event with the customer alone when the merchant owner cannot be resolved', async () => {
    const { supabase, calls } = supabaseStub([
      deliveryRow(),
      orderRow(),
      attemptCount(2),
      claimed(),
      OK,
      ASSIGNMENT_CLOSED,
      SLOT_RELEASED,
      OK,
      orderRow(),
      { data: null, error: { message: 'restaurant read failed' } },
      OK,
    ]);
    const failOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'DELIVERY_FAILED' });

    await buildService(supabase, ordersStub(failOrder)).failDelivery(staffUser(), DELIVERY_ID, REQUEST);

    const outbox = calls.filter((c) => c.table === 'outbox');
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.payload).toMatchObject({
      payload: { recipients: [{ recipientId: CUSTOMER_ID, recipientType: 'CUSTOMER' }] },
    });
  });
});
