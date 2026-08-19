import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseOrderDetailRepository } from './supabaseOrderDetail';

/**
 * Phase E-3B.1 — order detail is a direct Supabase read under RLS
 * (DEC-APP-008). These tests stub the query builder the same way
 * `supabaseCatalog.test.ts` does, so a wrong table, a dropped filter, or a
 * mis-mapped snapshot column fails here rather than only in a live check.
 */

type Result = { data: unknown; error: { message: string } | null };

interface Recorded {
  table: string;
  eq: Record<string, unknown>;
  in: Record<string, unknown[]>;
  order: { column: string; ascending: boolean }[];
}

function supabaseStub(byTable: Record<string, Result>) {
  const calls: Recorded[] = [];

  const client = {
    from(table: string) {
      const call: Recorded = { table, eq: {}, in: {}, order: [] };
      calls.push(call);

      const builder: Record<string, unknown> = {
        select: () => builder,
        eq(column: string, value: unknown) {
          call.eq[column] = value;
          return builder;
        },
        in(column: string, values: unknown[]) {
          call.in[column] = values;
          return builder;
        },
        order(column: string, opts: { ascending: boolean }) {
          call.order.push({ column, ascending: opts.ascending });
          return builder;
        },
        returns: () => Promise.resolve(byTable[table] ?? { data: [], error: null }),
        maybeSingle: () => Promise.resolve(byTable[table] ?? { data: null, error: null }),
      };

      return builder;
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

function repoWith(byTable: Record<string, Result>) {
  const { client, calls } = supabaseStub(byTable);
  return {
    subject: createSupabaseOrderDetailRepository(client),
    calls,
    callsTo: (table: string) => calls.filter((call) => call.table === table),
  };
}

const ORDER_ROW = {
  id: 'order-1',
  order_number: 'BH-20260819-0001',
  state: 'PREPARING',
  payment_method: 'ONLINE',
  subtotal_satang: 12000,
  delivery_fee_satang: 1500,
  service_fee_satang: 500,
  discount_satang: 0,
  grand_total_satang: 14000,
  recipient_name_snapshot: 'สมชาย ใจดี',
  recipient_phone_snapshot: '0812345678',
  delivery_address_snapshot: '123 หมู่ 4 ต.บุณฑริก',
  placed_at: '2026-08-19T05:00:00Z',
};

const ITEM_ROW = {
  id: 'item-1',
  order_id: 'order-1',
  menu_item_id: 'mi-1',
  item_name_snapshot: 'ส้มตำไทย',
  unit_price_satang: 6000,
  quantity: 2,
  line_total_satang: 12000,
  note: null,
};

const OPTION_ROW = {
  id: 'opt-1',
  order_item_id: 'item-1',
  group_name_snapshot: 'ระดับความเผ็ด',
  option_name_snapshot: 'เผ็ดมาก',
  price_delta_satang: 0,
};

const HISTORY_ROWS = [
  { to_state: 'CREATED', occurred_at: '2026-08-19T05:00:00Z', reason: 'Order created from cart' },
  { to_state: 'PAID', occurred_at: '2026-08-19T05:01:00Z', reason: null },
  { to_state: 'MERCHANT_ACCEPTED', occurred_at: '2026-08-19T05:02:00Z', reason: null },
  { to_state: 'PREPARING', occurred_at: '2026-08-19T05:03:00Z', reason: null },
];

describe('getOrder — owner reads own order', () => {
  it('maps the order, its items, options and status history from snapshot columns', async () => {
    const { subject, calls } = repoWith({
      orders: { data: ORDER_ROW, error: null },
      order_items: { data: [ITEM_ROW], error: null },
      order_item_options: { data: [OPTION_ROW], error: null },
      order_status_history: { data: HISTORY_ROWS, error: null },
    });

    const order = await subject.getOrder('order-1');

    expect(order).toEqual({
      orderId: 'order-1',
      orderNumber: 'BH-20260819-0001',
      state: 'PREPARING',
      paymentMethod: 'ONLINE',
      subtotalSatang: 12000,
      deliveryFeeSatang: 1500,
      serviceFeeSatang: 500,
      discountSatang: 0,
      grandTotalSatang: 14000,
      recipientNameSnapshot: 'สมชาย ใจดี',
      recipientPhoneSnapshot: '0812345678',
      deliveryAddressSnapshot: '123 หมู่ 4 ต.บุณฑริก',
      placedAt: '2026-08-19T05:00:00Z',
      items: [
        {
          id: 'item-1',
          menuItemId: 'mi-1',
          nameSnapshot: 'ส้มตำไทย',
          unitPriceSatang: 6000,
          quantity: 2,
          lineTotalSatang: 12000,
          note: null,
          options: [
            {
              id: 'opt-1',
              groupNameSnapshot: 'ระดับความเผ็ด',
              optionNameSnapshot: 'เผ็ดมาก',
              priceDeltaSatang: 0,
            },
          ],
        },
      ],
      statusHistory: [
        { toState: 'CREATED', occurredAt: '2026-08-19T05:00:00Z', reason: 'Order created from cart' },
        { toState: 'PAID', occurredAt: '2026-08-19T05:01:00Z', reason: null },
        { toState: 'MERCHANT_ACCEPTED', occurredAt: '2026-08-19T05:02:00Z', reason: null },
        { toState: 'PREPARING', occurredAt: '2026-08-19T05:03:00Z', reason: null },
      ],
    });

    // The order id drives every subordinate query — never a client-supplied
    // customer id (V1.1's own ownership rule for this kind of read).
    expect(calls.find((c) => c.table === 'orders')?.eq).toEqual({ id: 'order-1' });
    expect(calls.find((c) => c.table === 'order_items')?.eq).toEqual({ order_id: 'order-1' });
    expect(calls.find((c) => c.table === 'order_status_history')?.eq).toEqual({
      order_id: 'order-1',
    });
    // Chronological, not merely "the array Supabase happened to return" —
    // the query itself asks for it.
    expect(calls.find((c) => c.table === 'order_status_history')?.order).toEqual([
      { column: 'occurred_at', ascending: true },
    ]);
  });

  it('never re-derives price or name from the live catalog — only snapshot columns are read', async () => {
    const { subject } = repoWith({
      orders: { data: ORDER_ROW, error: null },
      order_items: { data: [ITEM_ROW], error: null },
      order_item_options: { data: [], error: null },
      order_status_history: { data: [], error: null },
    });

    const order = await subject.getOrder('order-1');

    expect(order?.items[0]?.nameSnapshot).toBe(ITEM_ROW.item_name_snapshot);
    expect(order?.items[0]?.unitPriceSatang).toBe(ITEM_ROW.unit_price_satang);
  });

  it('skips the options query entirely when the order has no items', async () => {
    const { subject, callsTo } = repoWith({
      orders: { data: ORDER_ROW, error: null },
      order_items: { data: [], error: null },
      order_status_history: { data: [], error: null },
    });

    const order = await subject.getOrder('order-1');

    expect(order?.items).toEqual([]);
    expect(callsTo('order_item_options')).toHaveLength(0);
  });
});

describe('getOrder — ownership and not-found', () => {
  it('returns null for a nonexistent order id, indistinguishable from one owned by another customer', async () => {
    const { subject } = repoWith({
      orders: { data: null, error: null },
    });

    await expect(subject.getOrder('someone-elses-order')).resolves.toBeNull();
  });

  it('never queries items/options/history once the order itself is not visible under RLS', async () => {
    const { subject, callsTo } = repoWith({
      orders: { data: null, error: null },
    });

    await subject.getOrder('someone-elses-order');

    expect(callsTo('order_items')).toHaveLength(0);
    expect(callsTo('order_status_history')).toHaveLength(0);
  });
});

describe('getOrder — failures', () => {
  it('throws rather than returning an empty result on a malformed order id', async () => {
    const { subject } = repoWith({
      orders: { data: null, error: { message: 'invalid input syntax for type uuid' } },
    });

    await expect(subject.getOrder('not-a-uuid')).rejects.toThrow(/invalid input syntax/);
  });

  it('throws on a transport/server failure rather than surfacing a raw Postgres error as success', async () => {
    const { subject } = repoWith({
      orders: { data: null, error: { message: 'internal error' } },
    });

    await expect(subject.getOrder('order-1')).rejects.toThrow('Order detail failed: internal error');
  });
});
