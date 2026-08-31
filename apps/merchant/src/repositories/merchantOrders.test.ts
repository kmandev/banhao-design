import type { SupabaseClient } from '@supabase/supabase-js';
import { createMerchantOrdersRepository } from './merchantOrders';

/**
 * M-2.3's initial-fetch half of the Order Board (M2-RT-001) — a direct
 * Supabase read against `orders` under RLS. These tests stub the query
 * builder so a dropped `restaurant_id` filter, a wrong table, a `select('*')`,
 * or a mis-mapped column fails here rather than only in a live check.
 * Mirrors `merchantRestaurant.test.ts`'s stubbing style.
 */

type Result = { data: unknown; error: { message: string } | null };

interface Recorded {
  table: string;
  select: string[];
  eq: Record<string, unknown>;
  order: { column: string; ascending: boolean }[];
}

function supabaseStub(result: Result) {
  const calls: Recorded[] = [];

  const client = {
    from(table: string) {
      const call: Recorded = { table, select: [], eq: {}, order: [] };
      calls.push(call);

      const builder = {
        select(columns: string) {
          call.select.push(columns);
          return builder;
        },
        eq(column: string, value: unknown) {
          call.eq[column] = value;
          return builder;
        },
        order(column: string, opts: { ascending: boolean }) {
          call.order.push({ column, ascending: opts.ascending });
          return builder;
        },
        returns() {
          return Promise.resolve(result);
        },
      };

      return builder;
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

function repoWith(result: Result) {
  const { client, calls } = supabaseStub(result);
  return { subject: createMerchantOrdersRepository(client), calls };
}

const ORDER_ROW = {
  id: 'order-1',
  order_number: 'BH-20260831-0001',
  state: 'MERCHANT_ACCEPTED',
  restaurant_id: 'rest-1',
  recipient_name_snapshot: 'สมชาย ใจดี',
  recipient_phone_snapshot: '+66812345678',
  grand_total_satang: 15000,
  placed_at: '2026-08-31T09:00:00Z',
  accepted_at: '2026-08-31T09:02:00Z',
  ready_at: null,
  picked_up_at: null,
};

describe('listRestaurantOrders — table, columns, and scope', () => {
  it('queries only orders', async () => {
    const { subject, calls } = repoWith({ data: [ORDER_ROW], error: null });
    await subject.listRestaurantOrders('rest-1');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.table).toBe('orders');
  });

  it('selects exactly the MerchantOrderSummary projection — no select(*), no child tables', async () => {
    const { subject, calls } = repoWith({ data: [ORDER_ROW], error: null });
    await subject.listRestaurantOrders('rest-1');

    const selected = calls[0]!.select.join(' ');
    expect(selected).not.toBe('*');
    expect(selected).not.toMatch(/\*/);
    expect(selected.split(',').map((c) => c.trim()).sort()).toEqual(
      [
        'id',
        'order_number',
        'state',
        'restaurant_id',
        'recipient_name_snapshot',
        'recipient_phone_snapshot',
        'grand_total_satang',
        'placed_at',
        'accepted_at',
        'ready_at',
        'picked_up_at',
      ].sort(),
    );
    expect(selected).not.toMatch(/order_item/);
    expect(selected).not.toMatch(/order_status_history/);
    expect(selected).not.toMatch(/deliveries/);
  });

  it('filters restaurant_id to the requested restaurant', async () => {
    const { subject, calls } = repoWith({ data: [ORDER_ROW], error: null });
    await subject.listRestaurantOrders('rest-1');

    expect(calls[0]!.eq).toEqual({ restaurant_id: 'rest-1' });
  });

  it('orders newest first by placed_at', async () => {
    const { subject, calls } = repoWith({ data: [ORDER_ROW], error: null });
    await subject.listRestaurantOrders('rest-1');

    expect(calls[0]!.order).toEqual([{ column: 'placed_at', ascending: false }]);
  });

  it('never applies a client-side user_id filter — restaurant_id scope plus RLS is the only scope', async () => {
    const { subject, calls } = repoWith({ data: [ORDER_ROW], error: null });
    await subject.listRestaurantOrders('rest-1');

    expect(calls[0]!.eq).not.toHaveProperty('user_id');
    expect(calls[0]!.eq).not.toHaveProperty('customer_id');
  });

  it('does not perform any Realtime/channel subscription — initial fetch only (M-2.3, not M-2.4)', async () => {
    const channel = jest.fn();
    const { client, calls } = supabaseStub({ data: [], error: null });
    (client as unknown as { channel: jest.Mock }).channel = channel;

    const subject = createMerchantOrdersRepository(client);
    await subject.listRestaurantOrders('rest-1');

    expect(channel).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });
});

describe('listRestaurantOrders — mapping and results', () => {
  it('maps an order row to a MerchantOrderSummary — snake_case to camelCase', async () => {
    const { subject } = repoWith({ data: [ORDER_ROW], error: null });
    const result = await subject.listRestaurantOrders('rest-1');

    expect(result).toEqual([
      {
        id: 'order-1',
        orderNumber: 'BH-20260831-0001',
        state: 'MERCHANT_ACCEPTED',
        restaurantId: 'rest-1',
        recipientNameSnapshot: 'สมชาย ใจดี',
        recipientPhoneSnapshot: '+66812345678',
        grandTotalSatang: 15000,
        placedAt: '2026-08-31T09:00:00Z',
        acceptedAt: '2026-08-31T09:02:00Z',
        readyAt: null,
        pickedUpAt: null,
      },
    ]);
  });

  it('keeps unreached lifecycle timestamps null rather than inventing a value', async () => {
    const { subject } = repoWith({
      data: [{ ...ORDER_ROW, state: 'CREATED', accepted_at: null, ready_at: null, picked_up_at: null }],
      error: null,
    });
    const result = await subject.listRestaurantOrders('rest-1');

    expect(result[0]!.acceptedAt).toBeNull();
    expect(result[0]!.readyAt).toBeNull();
    expect(result[0]!.pickedUpAt).toBeNull();
  });

  it('returns an empty array for a restaurant with no orders yet — not an error', async () => {
    const { subject } = repoWith({ data: [], error: null });
    const result = await subject.listRestaurantOrders('rest-1');

    expect(result).toEqual([]);
  });

  it('throws rather than silently returning an empty board on a query error', async () => {
    const { subject } = repoWith({ data: null, error: { message: 'network error' } });
    await expect(subject.listRestaurantOrders('rest-1')).rejects.toThrow('network error');
  });
});
