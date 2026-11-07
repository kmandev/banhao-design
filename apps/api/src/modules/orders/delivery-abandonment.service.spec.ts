import { Logger } from '@nestjs/common';
import { DeliveryAbandonmentService } from './delivery-abandonment.service';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * DEC-050 — closing the delivery of a cancelled order.
 *
 * Same stub shape as the rest of the suite: a fake `supabase.admin.from()`
 * that records what each statement was built with and returns queued results
 * in call order, so the guard is asserted to be IN the query.
 */

type Result = { data: unknown; error: { message: string } | null };

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update';
  payload?: Record<string, unknown>;
  eq: Record<string, unknown>;
  neq: Record<string, unknown>;
  in: Record<string, unknown[]>;
}

function supabaseStub(results: Result[]) {
  const calls: Recorded[] = [];
  let index = 0;
  const next = (): Result => results[index++] ?? { data: null, error: null };

  const admin = {
    from(table: string) {
      const call: Recorded = { table, op: 'select', eq: {}, neq: {}, in: {} };
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
        neq(column: string, value: unknown) {
          call.neq[column] = value;
          return builder;
        },
        in(column: string, values: unknown[]) {
          call.in[column] = values;
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve(next()),
        returns: () => Promise.resolve(next()),
        then: (resolve: (r: Result) => unknown) => Promise.resolve(next()).then(resolve),
      };

      return builder;
    },
  };

  return { service: new DeliveryAbandonmentService({ admin } as unknown as SupabaseService), calls };
}

const ORDER_ID = 'order-1';
const DELIVERY_ID = 'delivery-1';
const RIDER_ID = 'rider-1';
const CUSTOMER = { type: 'CUSTOMER', id: 'customer-1' } as const;
const NO_ERROR: Result = { data: null, error: null };

const delivery = (state: string, riderId: string | null = null): Result => ({
  data: { id: DELIVERY_ID, state, rider_id: riderId },
  error: null,
});

describe('DeliveryAbandonmentService.abandonForOrder', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('reports NO_DELIVERY, and writes nothing, when the order has no delivery yet', async () => {
    const { service, calls } = supabaseStub([NO_ERROR]);

    await expect(service.abandonForOrder(ORDER_ID, CUSTOMER, 'x')).resolves.toBe('NO_DELIVERY');

    expect(calls.filter((c) => c.op !== 'select')).toHaveLength(0);
  });

  it.each(['PICKED_UP', 'EN_ROUTE', 'ARRIVED', 'DELIVERED', 'FAILED'])(
    'leaves a %s delivery alone — post-pickup is DEC-053\'s, and the rest are terminal',
    async (state) => {
      const { service, calls } = supabaseStub([delivery(state, RIDER_ID)]);

      await expect(service.abandonForOrder(ORDER_ID, CUSTOMER, 'x')).resolves.toBe('NOT_APPLICABLE');

      expect(calls.filter((c) => c.op !== 'select')).toHaveLength(0);
    },
  );

  it('abandons a RIDER_SEARCHING delivery: guarded claim, then history, and touches no rider because none is assigned', async () => {
    const { service, calls } = supabaseStub([
      delivery('RIDER_SEARCHING'), // read
      delivery('ABANDONED'), // claim
      NO_ERROR, // history insert
    ]);

    await expect(service.abandonForOrder(ORDER_ID, CUSTOMER, 'เปลี่ยนใจ')).resolves.toBe('ABANDONED');

    const claim = calls.find((c) => c.table === 'deliveries' && c.op === 'update');
    expect(claim?.payload).toEqual({ state: 'ABANDONED' });
    // ADR-003: the pre-state rides in the same WHERE as the write.
    expect(claim?.in.state).toEqual(['UNASSIGNED', 'RIDER_SEARCHING', 'RIDER_REASSIGNING', 'RIDER_ASSIGNED', 'AT_MERCHANT']);
    expect(claim?.in.state).not.toContain('PICKED_UP');

    const history = calls.find((c) => c.table === 'delivery_status_history');
    expect(history?.payload).toMatchObject({
      delivery_id: DELIVERY_ID,
      from_state: 'RIDER_SEARCHING',
      to_state: 'ABANDONED',
      actor_type: 'CUSTOMER',
      actor_id: 'customer-1',
      reason: 'เปลี่ยนใจ',
    });

    expect(calls.some((c) => c.table === 'rider_assignments')).toBe(false);
    expect(calls.some((c) => c.table === 'rider_availability')).toBe(false);
  });

  it('for an assigned rider: closes the assignment as CANCELLED and frees the slot with a 1 -> 0 CAS', async () => {
    const { service, calls } = supabaseStub([
      delivery('RIDER_ASSIGNED', RIDER_ID), // read
      delivery('ABANDONED', RIDER_ID), // claim
      NO_ERROR, // history
      NO_ERROR, // assignment close
      { data: [], error: null }, // rider's other live deliveries: none
      NO_ERROR, // slot release
    ]);

    await expect(service.abandonForOrder(ORDER_ID, CUSTOMER, 'x')).resolves.toBe('ABANDONED');

    const assignment = calls.find((c) => c.table === 'rider_assignments');
    expect(assignment?.payload).toMatchObject({ status: 'CANCELLED', close_reason: 'ORDER_CANCELLED' });
    // Matched on delivery AND rider AND status, so it cannot cross-close another row.
    expect(assignment?.eq).toEqual({ delivery_id: DELIVERY_ID, rider_id: RIDER_ID, status: 'ACCEPTED' });

    const slot = calls.find((c) => c.table === 'rider_availability');
    expect(slot?.payload).toEqual({ active_delivery_count: 0 });
    expect(slot?.eq).toEqual({ rider_id: RIDER_ID, active_delivery_count: 1 });
  });

  it('never calls the release RPC, which would send the delivery back to RIDER_SEARCHING', async () => {
    const { service, calls } = supabaseStub([delivery('AT_MERCHANT', RIDER_ID), delivery('ABANDONED', RIDER_ID)]);

    await service.abandonForOrder(ORDER_ID, CUSTOMER, 'x');

    // The stub has no rpc at all; reaching for it would have thrown.
    expect(calls.every((c) => ['deliveries', 'delivery_status_history', 'rider_assignments', 'rider_availability'].includes(c.table))).toBe(true);
  });

  it('does not free the rider\'s slot when the rider is busy with a different delivery', async () => {
    const { service, calls } = supabaseStub([
      delivery('ABANDONED', RIDER_ID), // already abandoned: this is a repair
      NO_ERROR, // assignment close
      { data: [{ id: 'delivery-2' }], error: null }, // another live delivery
    ]);

    await expect(service.abandonForOrder(ORDER_ID, { type: 'SYSTEM', id: null }, 'x')).resolves.toBe('REPAIRED');

    const otherCheck = calls.find((c) => c.table === 'deliveries' && c.op === 'select' && c.neq.id);
    expect(otherCheck?.neq).toEqual({ id: DELIVERY_ID });
    expect(calls.some((c) => c.table === 'rider_availability')).toBe(false);
  });

  it('a delivery already ABANDONED is repaired — the tail re-runs, and no second history row is written', async () => {
    const { service, calls } = supabaseStub([
      delivery('ABANDONED', RIDER_ID),
      NO_ERROR,
      { data: [], error: null },
      NO_ERROR,
    ]);

    await expect(service.abandonForOrder(ORDER_ID, CUSTOMER, 'x')).resolves.toBe('REPAIRED');

    expect(calls.some((c) => c.table === 'delivery_status_history')).toBe(false);
    expect(calls.some((c) => c.table === 'rider_assignments')).toBe(true);
  });

  it('when the claim loses a race to an abandon that already finished, it repairs instead of reporting a refusal', async () => {
    const { service, calls } = supabaseStub([
      delivery('RIDER_SEARCHING'), // read
      NO_ERROR, // claim matched 0 rows
      delivery('ABANDONED'), // re-read
    ]);

    await expect(service.abandonForOrder(ORDER_ID, CUSTOMER, 'x')).resolves.toBe('REPAIRED');

    expect(calls.some((c) => c.table === 'delivery_status_history')).toBe(false);
  });

  it('when the claim loses because the delivery moved on (picked up), reports NOT_APPLICABLE', async () => {
    const { service } = supabaseStub([delivery('AT_MERCHANT', RIDER_ID), NO_ERROR, delivery('PICKED_UP', RIDER_ID)]);

    await expect(service.abandonForOrder(ORDER_ID, CUSTOMER, 'x')).resolves.toBe('NOT_APPLICABLE');
  });

  it('throws when the claim itself errors, so the caller can log it and the sweep can retry', async () => {
    const { service } = supabaseStub([
      delivery('RIDER_SEARCHING'),
      { data: null, error: { message: 'connection reset' } },
    ]);

    await expect(service.abandonForOrder(ORDER_ID, CUSTOMER, 'x')).rejects.toThrow('connection reset');
  });
});

describe('DeliveryAbandonmentService.sweepCancelledOrders', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('reads only deliveries whose order is CANCELLED and that are still abandonable', async () => {
    const { service, calls } = supabaseStub([{ data: [], error: null }]);

    const result = await service.sweepCancelledOrders();

    expect(result).toEqual({ examined: 0, abandoned: 0, failed: 0 });
    expect(calls[0]?.table).toBe('deliveries');
    expect(calls[0]?.eq).toEqual({ 'orders.state': 'CANCELLED' });
    expect(calls[0]?.in.state).toEqual(['UNASSIGNED', 'RIDER_SEARCHING', 'RIDER_REASSIGNING', 'RIDER_ASSIGNED', 'AT_MERCHANT']);
  });

  it('closes each one as the system actor and counts it', async () => {
    const { service, calls } = supabaseStub([
      { data: [{ order_id: ORDER_ID }], error: null }, // sweep read
      delivery('RIDER_SEARCHING'), // abandonForOrder: read
      delivery('ABANDONED'), // claim
      NO_ERROR, // history
    ]);

    const result = await service.sweepCancelledOrders();

    expect(result).toEqual({ examined: 1, abandoned: 1, failed: 0 });
    const history = calls.find((c) => c.table === 'delivery_status_history');
    expect(history?.payload).toMatchObject({ actor_type: 'SYSTEM', actor_id: null });
  });

  it('keeps going past one that fails, and reports it', async () => {
    const { service } = supabaseStub([
      { data: [{ order_id: 'a' }, { order_id: 'b' }], error: null },
      { data: null, error: { message: 'boom' } }, // a: read fails
      delivery('RIDER_SEARCHING'), // b: read
      delivery('ABANDONED'), // b: claim
      NO_ERROR, // b: history
    ]);

    const result = await service.sweepCancelledOrders();

    expect(result).toEqual({ examined: 2, abandoned: 1, failed: 1 });
  });

  it('never throws when the read itself fails', async () => {
    const { service } = supabaseStub([{ data: null, error: { message: 'connection reset' } }]);

    await expect(service.sweepCancelledOrders()).resolves.toEqual({ examined: 0, abandoned: 0, failed: 1 });
  });
});
