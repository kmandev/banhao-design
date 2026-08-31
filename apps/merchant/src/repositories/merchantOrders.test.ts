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

// ---------------------------------------------------------------------------
// M-2.7 — the three merchant transition commands.
//
// These assert the *wire contract* against the real controller
// (`apps/api/src/modules/orders/orders.controller.ts`): a wrong verb, a
// mistyped path segment, an invented request body, or an accidental direct
// Supabase write fails here rather than only in a live check. The API client
// is stubbed at its single `request` seam — the same level M-2.3's tests stub
// the Supabase query builder.
// ---------------------------------------------------------------------------

interface RecordedRequest {
  path: string;
  init: RequestInit;
}

function apiStub(outcome: { resolve: unknown } | { reject: unknown }) {
  const requests: RecordedRequest[] = [];

  const client = {
    request(path: string, init: RequestInit = {}) {
      requests.push({ path, init });
      return 'reject' in outcome ? Promise.reject(outcome.reject) : Promise.resolve(outcome.resolve);
    },
  };

  return { client: client as unknown as Parameters<typeof createMerchantOrdersRepository>[1], requests };
}

function commandRepo(outcome: { resolve: unknown } | { reject: unknown }) {
  // A Supabase stub that would throw if touched: a command must never reach it.
  const { client: supabase, calls } = supabaseStub({ data: null, error: { message: 'must not be called' } });
  const { client: api, requests } = apiStub(outcome);
  return { subject: createMerchantOrdersRepository(supabase, api), requests, supabaseCalls: calls };
}

const TRANSITION_OK = { orderId: 'order-1', state: 'MERCHANT_ACCEPTED' };

describe('transitionOrder — endpoint contract', () => {
  it.each([
    ['accept', '/api/v1/orders/order-1/accept'],
    ['start-preparing', '/api/v1/orders/order-1/start-preparing'],
    ['mark-ready', '/api/v1/orders/order-1/mark-ready'],
  ] as const)('%s posts to %s', async (command, expectedPath) => {
    const { subject, requests } = commandRepo({ resolve: TRANSITION_OK });
    await subject.transitionOrder('order-1', command);

    expect(requests).toHaveLength(1);
    expect(requests[0]!.path).toBe(expectedPath);
    expect(requests[0]!.init.method).toBe('POST');
  });

  it('sends no request body — none of the three endpoints declares one', async () => {
    const { subject, requests } = commandRepo({ resolve: TRANSITION_OK });
    await subject.transitionOrder('order-1', 'accept');

    expect(requests[0]!.init.body).toBeUndefined();
  });

  it('url-scopes the command to the order it was given', async () => {
    const { subject, requests } = commandRepo({ resolve: TRANSITION_OK });
    await subject.transitionOrder('order-99', 'mark-ready');

    expect(requests[0]!.path).toBe('/api/v1/orders/order-99/mark-ready');
  });

  it('returns the server transition response unchanged', async () => {
    const { subject } = commandRepo({ resolve: TRANSITION_OK });
    await expect(subject.transitionOrder('order-1', 'accept')).resolves.toEqual(TRANSITION_OK);
  });

  it('never writes through Supabase — authenticated holds no update grant on orders', async () => {
    const { subject, supabaseCalls } = commandRepo({ resolve: TRANSITION_OK });
    await subject.transitionOrder('order-1', 'accept');

    expect(supabaseCalls).toHaveLength(0);
  });

  it('propagates the API error intact so callers can branch on code, not message', async () => {
    const failure = Object.assign(new Error('invalid transition'), { code: 'INVALID_TRANSITION', status: 409 });
    const { subject } = commandRepo({ reject: failure });

    await expect(subject.transitionOrder('order-1', 'accept')).rejects.toBe(failure);
  });
});

// ---------------------------------------------------------------------------
// M-04 — getOrderDetail. A separate, minimal stub: `fetchOrderDetail`'s
// chain ends in `.single()`, which `supabaseStub` above (built for the board
// read's `.returns()` ending) does not model. RLS itself — whether a
// cross-restaurant order can actually be read — is not something a mocked
// client can prove; these tests assert the *application-level* scope this
// repository is responsible for (M-04's "restaurant isolation" requirement
// alongside, never instead of, RLS).
// ---------------------------------------------------------------------------

interface DetailRecorded {
  table: string;
  select: string[];
  eq: Record<string, unknown>;
  order: { column: string; options: unknown }[];
}

function detailStub(result: Result) {
  const calls: DetailRecorded[] = [];

  const client = {
    from(table: string) {
      const call: DetailRecorded = { table, select: [], eq: {}, order: [] };
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
        order(column: string, options: unknown) {
          call.order.push({ column, options });
          return builder;
        },
        single() {
          return Promise.resolve(result);
        },
      };

      return builder;
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

const ORDER_DETAIL_ROW = {
  id: 'order-1',
  order_number: 'BH-20260831-0001',
  state: 'PAID',
  restaurant_id: 'rest-1',
  recipient_name_snapshot: 'สมชาย ใจดี',
  recipient_phone_snapshot: '+66812345678',
  delivery_address_snapshot: '88/12 หมู่ 4',
  delivery_landmark: null,
  payment_method: 'ONLINE',
  subtotal_satang: 17500,
  delivery_fee_satang: 2000,
  service_fee_satang: 1000,
  discount_satang: 0,
  grand_total_satang: 20500,
  placed_at: '2026-08-31T09:00:00Z',
  accepted_at: null,
  ready_at: null,
  picked_up_at: null,
  order_items: [
    {
      id: 'item-1',
      item_name_snapshot: 'ข้าวผัดกะเพราหมูสับ',
      quantity: 2,
      unit_price_satang: 5500,
      line_total_satang: 11000,
      note: null,
      order_item_options: [
        { id: 'opt-1', group_name_snapshot: 'ความเผ็ด', option_name_snapshot: 'เผ็ดมาก', price_delta_satang: 0 },
      ],
    },
  ],
  order_status_history: [
    { id: 'hist-1', to_state: 'CREATED', actor_type: 'SYSTEM', reason: null, occurred_at: '2026-08-31T08:59:00Z' },
    { id: 'hist-2', to_state: 'PAID', actor_type: 'WEBHOOK', reason: null, occurred_at: '2026-08-31T09:00:00Z' },
  ],
};

describe('getOrderDetail — table, columns, and scope', () => {
  it('queries only orders, with no request body/API call involved', async () => {
    const { client, calls } = detailStub({ data: ORDER_DETAIL_ROW, error: null });
    const subject = createMerchantOrdersRepository(client);
    await subject.getOrderDetail('order-1', 'rest-1');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.table).toBe('orders');
  });

  it('scopes to both the requested order id and the caller restaurant', async () => {
    const { client, calls } = detailStub({ data: ORDER_DETAIL_ROW, error: null });
    const subject = createMerchantOrdersRepository(client);
    await subject.getOrderDetail('order-1', 'rest-1');

    expect(calls[0]!.eq).toEqual({ id: 'order-1', restaurant_id: 'rest-1' });
  });

  it('embeds order_items, order_item_options and order_status_history — no select(*)', async () => {
    const { client, calls } = detailStub({ data: ORDER_DETAIL_ROW, error: null });
    const subject = createMerchantOrdersRepository(client);
    await subject.getOrderDetail('order-1', 'rest-1');

    const selected = calls[0]!.select.join(' ');
    expect(selected).not.toMatch(/(^|[^_a-z])\*/);
    expect(selected).toMatch(/order_items/);
    expect(selected).toMatch(/order_item_options/);
    expect(selected).toMatch(/order_status_history/);
  });

  it('never applies a client-side customer_id/user_id filter — restaurant scope plus RLS is the boundary', async () => {
    const { client, calls } = detailStub({ data: ORDER_DETAIL_ROW, error: null });
    const subject = createMerchantOrdersRepository(client);
    await subject.getOrderDetail('order-1', 'rest-1');

    expect(calls[0]!.eq).not.toHaveProperty('customer_id');
    expect(calls[0]!.eq).not.toHaveProperty('user_id');
  });

  it('a different restaurantId scopes the query to that restaurant instead — the application-level isolation guard', async () => {
    const { client, calls } = detailStub({ data: ORDER_DETAIL_ROW, error: null });
    const subject = createMerchantOrdersRepository(client);
    await subject.getOrderDetail('order-1', 'rest-other');

    expect(calls[0]!.eq).toEqual({ id: 'order-1', restaurant_id: 'rest-other' });
  });
});

describe('getOrderDetail — mapping and results', () => {
  it('maps the order, items, options and history into MerchantOrderDetail', async () => {
    const { client } = detailStub({ data: ORDER_DETAIL_ROW, error: null });
    const subject = createMerchantOrdersRepository(client);
    const result = await subject.getOrderDetail('order-1', 'rest-1');

    expect(result.orderId).toBe('order-1');
    expect(result.recipientPhoneSnapshot).toBe('+66812345678');
    expect(result.items).toEqual([
      {
        id: 'item-1',
        nameSnapshot: 'ข้าวผัดกะเพราหมูสับ',
        quantity: 2,
        unitPriceSatang: 5500,
        lineTotalSatang: 11000,
        note: null,
        options: [
          { id: 'opt-1', groupNameSnapshot: 'ความเผ็ด', optionNameSnapshot: 'เผ็ดมาก', priceDeltaSatang: 0 },
        ],
      },
    ]);
    expect(result.statusHistory).toEqual([
      { id: 'hist-1', toState: 'CREATED', actorType: 'SYSTEM', reason: null, occurredAt: '2026-08-31T08:59:00Z' },
      { id: 'hist-2', toState: 'PAID', actorType: 'WEBHOOK', reason: null, occurredAt: '2026-08-31T09:00:00Z' },
    ]);
  });

  it('does not carry a state field — the panel reads state from the live board row, never this fetch', async () => {
    const { client } = detailStub({ data: ORDER_DETAIL_ROW, error: null });
    const subject = createMerchantOrdersRepository(client);
    const result = await subject.getOrderDetail('order-1', 'rest-1');

    expect(result).not.toHaveProperty('state');
  });

  it('throws on a query error — a card the merchant just clicked must never resolve to nothing silently', async () => {
    const { client } = detailStub({ data: null, error: { message: 'PGRST116' } });
    const subject = createMerchantOrdersRepository(client);

    await expect(subject.getOrderDetail('order-1', 'rest-1')).rejects.toThrow('PGRST116');
  });
});
