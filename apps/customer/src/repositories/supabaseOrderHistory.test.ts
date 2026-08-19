import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseOrderHistoryRepository } from './supabaseOrderHistory';

/**
 * Phase E-3B.3 — order history is a direct Supabase read under RLS
 * (DEC-APP-008). Same stub shape as `supabaseOrderDetail.test.ts`: these
 * assert the *query* as well as the mapping, because asserting only the output
 * would pass for a repository that filtered by a client-supplied customer id,
 * dropped the ordering, or issued one query per card.
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
      };

      return builder;
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

function repoWith(byTable: Record<string, Result>) {
  const { client, calls } = supabaseStub(byTable);
  return {
    subject: createSupabaseOrderHistoryRepository(client),
    calls,
    callsTo: (table: string) => calls.filter((call) => call.table === table),
  };
}

const ORDER_A = {
  id: '11111111-1111-4111-8111-111111111111',
  order_number: 'BH-20260819-0002',
  state: 'DELIVERED',
  payment_method: 'ONLINE',
  restaurant_name_snapshot: 'ก๋วยเตี๋ยวลุงหนวด',
  grand_total_satang: 9500,
  placed_at: '2026-08-19T05:00:00Z',
};

const ORDER_B = {
  id: '22222222-2222-4222-8222-222222222222',
  order_number: 'BH-20260818-0001',
  state: 'CANCELLED',
  payment_method: 'CASH',
  restaurant_name_snapshot: 'ส้มตำป้าทองดี',
  grand_total_satang: 13000,
  placed_at: '2026-08-18T05:00:00Z',
};

const ITEM_ROWS = [
  {
    id: 'item-a1',
    order_id: ORDER_A.id,
    menu_item_id: 'mi-1',
    item_name_snapshot: 'ก๋วยเตี๋ยวเรือน้ำตก',
    unit_price_satang: 3000,
    quantity: 2,
    line_total_satang: 6000,
    note: null,
  },
  {
    id: 'item-a2',
    order_id: ORDER_A.id,
    menu_item_id: 'mi-2',
    item_name_snapshot: 'เกี๊ยวทอด',
    unit_price_satang: 2000,
    quantity: 1,
    line_total_satang: 2000,
    note: null,
  },
  {
    id: 'item-b1',
    order_id: ORDER_B.id,
    menu_item_id: 'mi-3',
    item_name_snapshot: 'ตำซั่ว',
    unit_price_satang: 6500,
    quantity: 2,
    line_total_satang: 13000,
    note: null,
  },
];

describe('listOrders — the caller’s own history', () => {
  it('maps each order from its snapshot columns and attaches its own lines', async () => {
    const { subject } = repoWith({
      orders: { data: [ORDER_A, ORDER_B], error: null },
      order_items: { data: ITEM_ROWS, error: null },
    });

    await expect(subject.listOrders()).resolves.toEqual([
      {
        orderId: ORDER_A.id,
        orderNumber: 'BH-20260819-0002',
        state: 'DELIVERED',
        paymentMethod: 'ONLINE',
        restaurantNameSnapshot: 'ก๋วยเตี๋ยวลุงหนวด',
        grandTotalSatang: 9500,
        placedAt: '2026-08-19T05:00:00Z',
        items: [
          { nameSnapshot: 'ก๋วยเตี๋ยวเรือน้ำตก', quantity: 2 },
          { nameSnapshot: 'เกี๊ยวทอด', quantity: 1 },
        ],
      },
      {
        orderId: ORDER_B.id,
        orderNumber: 'BH-20260818-0001',
        state: 'CANCELLED',
        paymentMethod: 'CASH',
        restaurantNameSnapshot: 'ส้มตำป้าทองดี',
        grandTotalSatang: 13000,
        placedAt: '2026-08-18T05:00:00Z',
        items: [{ nameSnapshot: 'ตำซั่ว', quantity: 2 }],
      },
    ]);
  });

  it('never filters by a customer id — ownership is orders_select_customer, not a client value', async () => {
    const { subject, calls } = repoWith({
      orders: { data: [ORDER_A], error: null },
      order_items: { data: [], error: null },
    });

    await subject.listOrders();

    const ordersCall = calls.find((call) => call.table === 'orders');
    expect(ordersCall?.eq).toEqual({});
    expect(JSON.stringify(calls)).not.toContain('customer_id');
  });

  it('requests newest first, matching the orders_customer_idx ordering', async () => {
    const { subject, calls } = repoWith({
      orders: { data: [ORDER_A], error: null },
      order_items: { data: [], error: null },
    });

    await subject.listOrders();

    expect(calls.find((call) => call.table === 'orders')?.order).toEqual([
      { column: 'placed_at', ascending: false },
    ]);
  });

  it('fetches every order’s lines in ONE batched query, not one per order', async () => {
    const { subject, callsTo } = repoWith({
      orders: { data: [ORDER_A, ORDER_B], error: null },
      order_items: { data: ITEM_ROWS, error: null },
    });

    await subject.listOrders();

    const itemCalls = callsTo('order_items');
    expect(itemCalls).toHaveLength(1);
    expect(itemCalls[0]?.in).toEqual({ order_id: [ORDER_A.id, ORDER_B.id] });
  });

  it('returns an empty history and skips the items query when the customer has no orders', async () => {
    const { subject, callsTo } = repoWith({
      orders: { data: [], error: null },
    });

    await expect(subject.listOrders()).resolves.toEqual([]);
    expect(callsTo('order_items')).toHaveLength(0);
  });

  it('returns an order with no readable lines rather than dropping the order', async () => {
    const { subject } = repoWith({
      orders: { data: [ORDER_A], error: null },
      order_items: { data: [], error: null },
    });

    const history = await subject.listOrders();
    expect(history).toHaveLength(1);
    expect(history[0]?.items).toEqual([]);
  });
});

describe('listOrders — failures', () => {
  it('throws on a failed history read rather than reporting an empty history', async () => {
    const { subject } = repoWith({
      orders: { data: null, error: { message: 'connection reset' } },
    });

    await expect(subject.listOrders()).rejects.toThrow('Order history failed: connection reset');
  });

  it('throws when the lines read fails, rather than showing orders with silently missing items', async () => {
    const { subject } = repoWith({
      orders: { data: [ORDER_A], error: null },
      order_items: { data: null, error: { message: 'timeout' } },
    });

    await expect(subject.listOrders()).rejects.toThrow('Order history items failed: timeout');
  });
});
