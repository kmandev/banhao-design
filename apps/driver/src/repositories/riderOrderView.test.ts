import type { SupabaseClient } from '@supabase/supabase-js';
import { createRiderOrderViewRepository } from './riderOrderView';

/**
 * Phase G, V1.1 §15 — the rider's read path is a direct Supabase read under
 * RLS (DEC-APP-008), scoped entirely by the three deployed `rider_order_*`
 * views' own `is_assigned_order_rider()` predicate. These tests stub the
 * query builder the same way `supabaseOrderDetail.test.ts` does, so a wrong
 * table, a dropped column, or a smuggled `rider_id` filter fails here rather
 * than only in a live check.
 */

type Result = { data: unknown; error: { message: string } | null };

interface Recorded {
  table: string;
  select: string[];
  eq: Record<string, unknown>;
  in: Record<string, unknown[]>;
  order: { column: string; ascending: boolean }[];
  writeOps: string[];
}

const BASE_TABLES = [
  'orders',
  'order_items',
  'order_item_options',
  'deliveries',
  'rider_assignment_attempts',
  'rider_assignments',
  'rider_availability',
];

const MONEY_PATTERN = /satang|price|commission|earning|payment_method|ledger|settlement|refund/i;

function supabaseStub(byTable: Record<string, Result>) {
  const calls: Recorded[] = [];

  const client = {
    from(table: string) {
      const call: Recorded = { table, select: [], eq: {}, in: {}, order: [], writeOps: [] };
      calls.push(call);

      const builder: Record<string, unknown> = {
        select(columns: string) {
          call.select.push(columns);
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
        order(column: string, opts: { ascending: boolean }) {
          call.order.push({ column, ascending: opts.ascending });
          return builder;
        },
        insert() {
          call.writeOps.push('insert');
          return builder;
        },
        update() {
          call.writeOps.push('update');
          return builder;
        },
        upsert() {
          call.writeOps.push('upsert');
          return builder;
        },
        delete() {
          call.writeOps.push('delete');
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
    subject: createRiderOrderViewRepository(client),
    calls,
    callsTo: (table: string) => calls.filter((call) => call.table === table),
  };
}

/** Recursively collects every own-property key of a value, including nested arrays/objects. */
function collectKeys(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, into);
    return into;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      into.push(key);
      collectKeys(entry, into);
    }
  }
  return into;
}

const ORDER_ROW = {
  id: 'order-1',
  order_number: 'BH-20260825-0001',
  state: 'PICKED_UP',
  restaurant_id: 'restaurant-1',
  restaurant_name_snapshot: 'ก๋วยเตี๋ยวลุงหนวด',
  delivery_address_snapshot: '123 หมู่ 4 ต.บุณฑริก',
  delivery_lat: 14.373,
  delivery_lng: 105.226,
  delivery_landmark: 'ใกล้ตลาดสดบุณฑริก',
  recipient_name_snapshot: 'สมชาย ใจดี',
  recipient_phone_snapshot: '0812345678',
  distance_m: 1800,
  quoted_eta_minutes: 15,
  placed_at: '2026-08-25T05:00:00Z',
  accepted_at: '2026-08-25T05:01:00Z',
  ready_at: '2026-08-25T05:05:00Z',
  picked_up_at: '2026-08-25T05:10:00Z',
  delivered_at: null,
  cancelled_at: null,
  created_at: '2026-08-25T05:00:00Z',
  updated_at: '2026-08-25T05:10:00Z',
};

const ITEM_ROW = {
  id: 'item-1',
  order_id: 'order-1',
  item_name_snapshot: 'ส้มตำไทย',
  quantity: 2,
  note: null,
  created_at: '2026-08-25T05:00:01Z',
};

const OPTION_ROW = {
  id: 'opt-1',
  order_item_id: 'item-1',
  group_name_snapshot: 'ระดับความเผ็ด',
  option_name_snapshot: 'เผ็ดมาก',
  created_at: '2026-08-25T05:00:02Z',
};

describe('getAssignedOrder — rider reads the order currently assigned to them', () => {
  it('maps the order, its items and options from the three rider views', async () => {
    const { subject } = repoWith({
      rider_order_view: { data: [ORDER_ROW], error: null },
      rider_order_item_view: { data: [ITEM_ROW], error: null },
      rider_order_item_option_view: { data: [OPTION_ROW], error: null },
    });

    const order = await subject.getAssignedOrder();

    expect(order).toEqual({
      orderId: 'order-1',
      orderNumber: 'BH-20260825-0001',
      state: 'PICKED_UP',
      restaurantId: 'restaurant-1',
      restaurantNameSnapshot: 'ก๋วยเตี๋ยวลุงหนวด',
      deliveryAddressSnapshot: '123 หมู่ 4 ต.บุณฑริก',
      deliveryLat: 14.373,
      deliveryLng: 105.226,
      deliveryLandmark: 'ใกล้ตลาดสดบุณฑริก',
      recipientNameSnapshot: 'สมชาย ใจดี',
      recipientPhoneSnapshot: '0812345678',
      distanceM: 1800,
      quotedEtaMinutes: 15,
      placedAt: '2026-08-25T05:00:00Z',
      acceptedAt: '2026-08-25T05:01:00Z',
      readyAt: '2026-08-25T05:05:00Z',
      pickedUpAt: '2026-08-25T05:10:00Z',
      deliveredAt: null,
      cancelledAt: null,
      createdAt: '2026-08-25T05:00:00Z',
      updatedAt: '2026-08-25T05:10:00Z',
      items: [
        {
          id: 'item-1',
          nameSnapshot: 'ส้มตำไทย',
          quantity: 2,
          note: null,
          createdAt: '2026-08-25T05:00:01Z',
          options: [
            {
              id: 'opt-1',
              groupNameSnapshot: 'ระดับความเผ็ด',
              optionNameSnapshot: 'เผ็ดมาก',
              createdAt: '2026-08-25T05:00:02Z',
            },
          ],
        },
      ],
    });
  });

  it('assembles two items each with only their own options — no cross-item contamination', async () => {
    const secondItem = { ...ITEM_ROW, id: 'item-2', item_name_snapshot: 'ข้าวเหนียว', quantity: 1 };
    const secondOption = {
      id: 'opt-2',
      order_item_id: 'item-2',
      group_name_snapshot: 'จำนวนถุง',
      option_name_snapshot: '2 ถุง',
      created_at: '2026-08-25T05:00:03Z',
    };

    const { subject } = repoWith({
      rider_order_view: { data: [ORDER_ROW], error: null },
      rider_order_item_view: { data: [ITEM_ROW, secondItem], error: null },
      rider_order_item_option_view: { data: [OPTION_ROW, secondOption], error: null },
    });

    const order = await subject.getAssignedOrder();

    expect(order?.items).toHaveLength(2);
    expect(order?.items[0]?.id).toBe('item-1');
    expect(order?.items[0]?.options.map((o) => o.id)).toEqual(['opt-1']);
    expect(order?.items[1]?.id).toBe('item-2');
    expect(order?.items[1]?.options.map((o) => o.id)).toEqual(['opt-2']);
  });
});

describe('getAssignedOrder — view-only access', () => {
  it('queries only rider_order_view, rider_order_item_view and rider_order_item_option_view', async () => {
    const { subject, calls } = repoWith({
      rider_order_view: { data: [ORDER_ROW], error: null },
      rider_order_item_view: { data: [ITEM_ROW], error: null },
      rider_order_item_option_view: { data: [OPTION_ROW], error: null },
    });

    await subject.getAssignedOrder();

    const tables = [...new Set(calls.map((c) => c.table))];
    expect(tables.sort()).toEqual(
      ['rider_order_view', 'rider_order_item_view', 'rider_order_item_option_view'].sort(),
    );
    for (const forbidden of BASE_TABLES) {
      expect(tables).not.toContain(forbidden);
    }
  });

  it('selects exactly the deployed view columns — the literal projection, never "*" and never a superset', async () => {
    const { subject, calls } = repoWith({
      rider_order_view: { data: [ORDER_ROW], error: null },
      rider_order_item_view: { data: [ITEM_ROW], error: null },
      rider_order_item_option_view: { data: [OPTION_ROW], error: null },
    });

    await subject.getAssignedOrder();

    expect(calls.find((c) => c.table === 'rider_order_view')?.select).toEqual([
      'id, order_number, state, restaurant_id, restaurant_name_snapshot, delivery_address_snapshot, delivery_lat, delivery_lng, delivery_landmark, recipient_name_snapshot, recipient_phone_snapshot, distance_m, quoted_eta_minutes, placed_at, accepted_at, ready_at, picked_up_at, delivered_at, cancelled_at, created_at, updated_at',
    ]);
    expect(calls.find((c) => c.table === 'rider_order_item_view')?.select).toEqual([
      'id, order_id, item_name_snapshot, quantity, note, created_at',
    ]);
    expect(calls.find((c) => c.table === 'rider_order_item_option_view')?.select).toEqual([
      'id, order_item_id, group_name_snapshot, option_name_snapshot, created_at',
    ]);
  });
});

describe('getAssignedOrder — no rider-id filter, ever', () => {
  it('the assigned-order query is completely unfiltered — authorization is the view predicate alone', async () => {
    const { subject, calls } = repoWith({
      rider_order_view: { data: [ORDER_ROW], error: null },
      rider_order_item_view: { data: [ITEM_ROW], error: null },
      rider_order_item_option_view: { data: [OPTION_ROW], error: null },
    });

    await subject.getAssignedOrder();

    expect(calls.find((c) => c.table === 'rider_order_view')?.eq).toEqual({});
    expect(calls.find((c) => c.table === 'rider_order_view')?.in).toEqual({});
  });

  it('no query filter, anywhere, is keyed by a rider identity', async () => {
    const { subject, calls } = repoWith({
      rider_order_view: { data: [ORDER_ROW], error: null },
      rider_order_item_view: { data: [ITEM_ROW], error: null },
      rider_order_item_option_view: { data: [OPTION_ROW], error: null },
    });

    await subject.getAssignedOrder();

    const forbiddenFilterKeys = ['rider_id', 'riderId', 'deliveries.rider_id'];
    for (const call of calls) {
      const filterKeys = [...Object.keys(call.eq), ...Object.keys(call.in)];
      for (const key of filterKeys) {
        expect(forbiddenFilterKeys).not.toContain(key);
      }
    }
  });

  it('the item/option queries narrow by order id only — never by rider identity', async () => {
    const { subject, calls } = repoWith({
      rider_order_view: { data: [ORDER_ROW], error: null },
      rider_order_item_view: { data: [ITEM_ROW], error: null },
      rider_order_item_option_view: { data: [OPTION_ROW], error: null },
    });

    await subject.getAssignedOrder();

    expect(calls.find((c) => c.table === 'rider_order_item_view')?.eq).toEqual({ order_id: 'order-1' });
    expect(calls.find((c) => c.table === 'rider_order_item_option_view')?.in).toEqual({
      order_item_id: ['item-1'],
    });
  });
});

describe('getAssignedOrder — money isolation', () => {
  it('never requests or returns a money-shaped field: satang, price, commission, earning, payment_method, ledger, settlement, refund', async () => {
    const { subject, calls } = repoWith({
      rider_order_view: { data: [ORDER_ROW], error: null },
      rider_order_item_view: { data: [ITEM_ROW], error: null },
      rider_order_item_option_view: { data: [OPTION_ROW], error: null },
    });

    const order = await subject.getAssignedOrder();

    for (const call of calls) {
      for (const columns of call.select) {
        expect(MONEY_PATTERN.test(columns)).toBe(false);
      }
    }

    for (const key of collectKeys(order)) {
      expect(MONEY_PATTERN.test(key)).toBe(false);
    }
  });
});

describe('getAssignedOrder — no active assignment', () => {
  it('returns null when the rider has no assigned order, not a special "wrong rider" error', async () => {
    const { subject } = repoWith({
      rider_order_view: { data: [], error: null },
    });

    await expect(subject.getAssignedOrder()).resolves.toBeNull();
  });

  it('never queries items/options once the assigned-order view has no rows', async () => {
    const { subject, callsTo } = repoWith({
      rider_order_view: { data: [], error: null },
    });

    await subject.getAssignedOrder();

    expect(callsTo('rider_order_item_view')).toHaveLength(0);
    expect(callsTo('rider_order_item_option_view')).toHaveLength(0);
  });
});

describe('getAssignedOrder — failures', () => {
  it('throws rather than returning an empty result on a Supabase read error', async () => {
    const { subject } = repoWith({
      rider_order_view: { data: null, error: { message: 'connection reset' } },
    });

    await expect(subject.getAssignedOrder()).rejects.toThrow('Rider order read failed: connection reset');
  });

  it('throws on an item-view failure without swallowing it as an empty order', async () => {
    const { subject } = repoWith({
      rider_order_view: { data: [ORDER_ROW], error: null },
      rider_order_item_view: { data: null, error: { message: 'connection reset' } },
    });

    await expect(subject.getAssignedOrder()).rejects.toThrow('Rider order items failed: connection reset');
  });
});

describe('getAssignedOrder — read-only', () => {
  it('never calls insert, update, upsert or delete against any table', async () => {
    const { subject, calls } = repoWith({
      rider_order_view: { data: [ORDER_ROW], error: null },
      rider_order_item_view: { data: [ITEM_ROW], error: null },
      rider_order_item_option_view: { data: [OPTION_ROW], error: null },
    });

    await subject.getAssignedOrder();

    expect(calls.flatMap((c) => c.writeOps)).toEqual([]);
  });
});
