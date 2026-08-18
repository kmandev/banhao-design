import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseCatalogRepository } from './supabaseCatalog';
import { CATEGORY_TAXONOMY } from '../domain/categoryTaxonomy';

type Result = { data: unknown; error: { message: string } | null };

interface Recorded {
  table: string;
  eq: Record<string, unknown>;
  in: Record<string, unknown[]>;
  ilike: Record<string, string>;
  order: { column: string; ascending: boolean }[];
}

/**
 * Records what each query was actually built with.
 *
 * Asserting only the mapped output would pass for a repository that read the
 * wrong table, skipped `sort_order`, or dropped a filter — so these tests check
 * the query itself, the same way the Phase B capability tests do.
 */
function supabaseStub(byTable: Record<string, Result | Result[]>) {
  const calls: Recorded[] = [];
  const cursors: Record<string, number> = {};

  const next = (table: string): Result => {
    const entry = byTable[table];
    if (Array.isArray(entry)) {
      const index = cursors[table] ?? 0;
      cursors[table] = index + 1;
      return entry[index] ?? { data: [], error: null };
    }
    return entry ?? { data: [], error: null };
  };

  const client = {
    from(table: string) {
      const call: Recorded = { table, eq: {}, in: {}, ilike: {}, order: [] };
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
        ilike(column: string, pattern: string) {
          call.ilike[column] = pattern;
          return builder;
        },
        order(column: string, opts: { ascending: boolean }) {
          call.order.push({ column, ascending: opts.ascending });
          return builder;
        },
        returns: () => Promise.resolve(next(table)),
        maybeSingle: () => Promise.resolve(next(table)),
      };

      return builder;
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

const NOW = new Date('2026-08-16T07:00:00Z'); // Sunday 14:00 Bangkok

function repoWith(byTable: Record<string, Result | Result[]>) {
  const { client, calls } = supabaseStub(byTable);
  return {
    subject: createSupabaseCatalogRepository(client, () => NOW),
    calls,
    callsTo: (table: string) => calls.filter((call) => call.table === table),
  };
}

const RESTAURANT_ROW = {
  id: 'r1',
  name: 'ส้มตำป้าทองดี',
  description: null,
  cuisine: 'อาหารอีสาน',
  image_url: null,
  phone: null,
  address_line: null,
  lat: null,
  lng: null,
  status: 'ACTIVE',
  temporarily_closed_until: null,
  min_order_satang: null,
  avg_prep_minutes: null,
  rating_avg: 4.8,
  rating_count: 326,
};

const HOURS_ROW = {
  restaurant_id: 'r1',
  day_of_week: 0,
  opens_at: '09:00:00',
  closes_at: '20:00:00',
};

const ITEM_ROW = {
  id: 'm1',
  restaurant_id: 'r1',
  category_id: 'c1',
  name: 'ส้มตำไทย',
  description: null,
  base_price_satang: 6000,
  image_url: null,
  is_available: true,
  sort_order: 0,
};

const CATEGORY_ROW = { id: 'c1', restaurant_id: 'r1', name: 'แนะนำ', sort_order: 0 };

describe('listCategories — PC-Q-003', () => {
  it('returns the static taxonomy without querying Supabase at all', async () => {
    const { subject, calls } = repoWith({});

    await expect(subject.listCategories()).resolves.toEqual([...CATEGORY_TAXONOMY]);
    // The decisive assertion: no table was touched, so nothing is pretending
    // menu_categories is a global taxonomy.
    expect(calls).toHaveLength(0);
  });
});

describe('listShops', () => {
  it('reads restaurants ordered by name and batches hours in ONE query', async () => {
    const { subject, callsTo } = repoWith({
      restaurants: { data: [RESTAURANT_ROW, { ...RESTAURANT_ROW, id: 'r2' }], error: null },
      restaurant_hours: { data: [HOURS_ROW], error: null },
    });

    const shops = await subject.listShops();

    expect(shops).toHaveLength(2);
    expect(callsTo('restaurants')[0]?.order).toEqual([{ column: 'name', ascending: true }]);
    // N+1 guard: two restaurants, still exactly one hours query.
    expect(callsTo('restaurant_hours')).toHaveLength(1);
    expect(callsTo('restaurant_hours')[0]?.in.restaurant_id).toEqual(['r1', 'r2']);
  });

  it('derives isOpen per shop from its own hours', async () => {
    const { subject } = repoWith({
      restaurants: { data: [RESTAURANT_ROW], error: null },
      restaurant_hours: { data: [HOURS_ROW], error: null },
    });

    // 14:00 Bangkok on Sunday, inside 09:00–20:00.
    const [shop] = await subject.listShops();
    expect(shop?.isOpen).toBe(true);
    expect(shop?.todayHours).toBe('09:00 - 20:00');
  });

  it('reports a shop with no hours as closed rather than assuming open', async () => {
    const { subject } = repoWith({
      restaurants: { data: [RESTAURANT_ROW], error: null },
      restaurant_hours: { data: [], error: null },
    });

    const [shop] = await subject.listShops();
    expect(shop?.isOpen).toBe(false);
    expect(shop?.todayHours).toBeNull();
  });

  it('skips the hours query entirely when there are no restaurants', async () => {
    const { subject, callsTo } = repoWith({ restaurants: { data: [], error: null } });

    await expect(subject.listShops()).resolves.toEqual([]);
    expect(callsTo('restaurant_hours')).toHaveLength(0);
  });

  it('does not filter status client-side — RLS is the boundary', async () => {
    const { subject, callsTo } = repoWith({
      restaurants: { data: [RESTAURANT_ROW], error: null },
      restaurant_hours: { data: [], error: null },
    });

    await subject.listShops();
    // Re-filtering here would duplicate a boundary the client cannot enforce.
    expect(callsTo('restaurants')[0]?.eq).not.toHaveProperty('status');
  });

  it('propagates a read error instead of returning an empty list', async () => {
    const { subject } = repoWith({
      restaurants: { data: null, error: { message: 'connection reset' } },
    });

    await expect(subject.listShops()).rejects.toThrow(/connection reset/);
  });
});

describe('getShop', () => {
  it('filters by id and fetches only that shop’s hours', async () => {
    const { subject, callsTo } = repoWith({
      restaurants: { data: RESTAURANT_ROW, error: null },
      restaurant_hours: { data: [HOURS_ROW], error: null },
    });

    const shop = await subject.getShop('r1');

    expect(shop?.id).toBe('r1');
    expect(callsTo('restaurants')[0]?.eq.id).toBe('r1');
    expect(callsTo('restaurant_hours')[0]?.in.restaurant_id).toEqual(['r1']);
  });

  it('returns null for a shop RLS does not expose, without querying hours', async () => {
    const { subject, callsTo } = repoWith({ restaurants: { data: null, error: null } });

    await expect(subject.getShop('hidden')).resolves.toBeNull();
    expect(callsTo('restaurant_hours')).toHaveLength(0);
  });

  it('propagates an error', async () => {
    const { subject } = repoWith({
      restaurants: { data: null, error: { message: 'timeout' } },
    });
    await expect(subject.getShop('r1')).rejects.toThrow(/timeout/);
  });
});

describe('listMenu', () => {
  it('filters by restaurant, orders by sort_order, and resolves section names', async () => {
    const { subject, callsTo } = repoWith({
      menu_items: { data: [ITEM_ROW], error: null },
      menu_categories: { data: [CATEGORY_ROW], error: null },
    });

    const menu = await subject.listMenu('r1');

    expect(menu[0]?.categoryName).toBe('แนะนำ');
    expect(callsTo('menu_items')[0]?.eq.restaurant_id).toBe('r1');
    expect(callsTo('menu_items')[0]?.order).toEqual([{ column: 'sort_order', ascending: true }]);
    expect(callsTo('menu_categories')[0]?.order).toEqual([
      { column: 'sort_order', ascending: true },
    ]);
  });

  it('uses ONE categories query for the whole menu, not one per item', async () => {
    const { subject, callsTo } = repoWith({
      menu_items: {
        data: [ITEM_ROW, { ...ITEM_ROW, id: 'm2' }, { ...ITEM_ROW, id: 'm3' }],
        error: null,
      },
      menu_categories: { data: [CATEGORY_ROW], error: null },
    });

    await subject.listMenu('r1');
    expect(callsTo('menu_categories')).toHaveLength(1);
  });

  it('returns an empty menu without a categories query', async () => {
    const { subject, callsTo } = repoWith({ menu_items: { data: [], error: null } });

    await expect(subject.listMenu('r1')).resolves.toEqual([]);
    expect(callsTo('menu_categories')).toHaveLength(0);
  });

  it('keeps an item whose category is missing rather than dropping it', async () => {
    const { subject } = repoWith({
      menu_items: { data: [ITEM_ROW], error: null },
      menu_categories: { data: [], error: null },
    });

    const menu = await subject.listMenu('r1');
    expect(menu).toHaveLength(1);
    expect(menu[0]?.categoryName).toBe('');
  });

  it('propagates an error', async () => {
    const { subject } = repoWith({
      menu_items: { data: null, error: { message: 'boom' } },
    });
    await expect(subject.listMenu('r1')).rejects.toThrow(/boom/);
  });
});

describe('C-9 / Step 6 — the client never re-applies RLS predicates', () => {
  // These are the query-construction guards the C-8 review found missing:
  // RLS alone decides archived/available visibility, so a client-side filter
  // duplicating that boundary would be a second, driftable source of truth.

  it('requests menu_items with no archived_at or is_available filter', async () => {
    const { subject, callsTo } = repoWith({
      menu_items: { data: [ITEM_ROW], error: null },
      menu_categories: { data: [CATEGORY_ROW], error: null },
    });

    await subject.listMenu('r1');

    const call = callsTo('menu_items')[0];
    expect(call?.eq).not.toHaveProperty('archived_at');
    expect(call?.eq).not.toHaveProperty('is_available');
    expect(call?.in).not.toHaveProperty('archived_at');
  });

  it('requests menu_categories with no archived_at filter', async () => {
    const { subject, callsTo } = repoWith({
      menu_items: { data: [ITEM_ROW], error: null },
      menu_categories: { data: [CATEGORY_ROW], error: null },
    });

    await subject.listMenu('r1');
    expect(callsTo('menu_categories')[0]?.eq).not.toHaveProperty('archived_at');
  });

  it('requests menu_option_groups and menu_options with no availability filter', async () => {
    const { subject, callsTo } = repoWith({
      menu_items: { data: ITEM_ROW, error: null },
      menu_categories: { data: [CATEGORY_ROW], error: null },
      menu_option_groups: {
        data: [
          { id: 'g1', menu_item_id: 'm1', title: 'x', min_select: 0, max_select: 1, sort_order: 0 },
        ],
        error: null,
      },
      menu_options: {
        data: [
          { id: 'o1', group_id: 'g1', label: 'x', price_delta_satang: 0, is_available: false, sort_order: 0 },
        ],
        error: null,
      },
    });

    const item = await subject.getMenuItem('r1', 'm1');

    // The unavailable option (is_available: false) comes back at all — proof
    // the client did not filter it, mapped straight from RLS-permitted rows.
    expect(item?.optionGroups?.[0]?.options[0]?.isAvailable).toBe(false);
    expect(callsTo('menu_option_groups')[0]?.eq).not.toHaveProperty('is_available');
    expect(callsTo('menu_options')[0]?.in).not.toHaveProperty('is_available');
  });

  it('requests restaurants with no archived/deleted filter beyond RLS', async () => {
    const { subject, callsTo } = repoWith({
      restaurants: { data: [RESTAURANT_ROW], error: null },
      restaurant_hours: { data: [], error: null },
    });

    await subject.listShops();
    expect(callsTo('restaurants')[0]?.eq).toEqual({});
  });
});

describe('getMenuItem', () => {
  it('scopes by BOTH item id and restaurant id', async () => {
    const { subject, callsTo } = repoWith({
      menu_items: { data: ITEM_ROW, error: null },
      menu_categories: { data: [CATEGORY_ROW], error: null },
      menu_option_groups: { data: [], error: null },
    });

    await subject.getMenuItem('r1', 'm1');

    // The composite (id, restaurant_id) is what stops an item being read as
    // belonging to a restaurant it does not belong to.
    expect(callsTo('menu_items')[0]?.eq).toEqual({ id: 'm1', restaurant_id: 'r1' });
  });

  it('loads option groups with their options in two batched queries', async () => {
    const { subject, callsTo } = repoWith({
      menu_items: { data: ITEM_ROW, error: null },
      menu_categories: { data: [CATEGORY_ROW], error: null },
      menu_option_groups: {
        data: [
          { id: 'g1', menu_item_id: 'm1', title: 'เนื้อสัตว์', min_select: 1, max_select: 1, sort_order: 0 },
          { id: 'g2', menu_item_id: 'm1', title: 'ไข่', min_select: 0, max_select: 2, sort_order: 1 },
        ],
        error: null,
      },
      menu_options: {
        data: [
          { id: 'o1', group_id: 'g1', label: 'หมู', price_delta_satang: 0, is_available: true, sort_order: 0 },
          { id: 'o2', group_id: 'g2', label: 'ไข่ดาว', price_delta_satang: 1000, is_available: true, sort_order: 0 },
        ],
        error: null,
      },
    });

    const item = await subject.getMenuItem('r1', 'm1');

    expect(item?.optionGroups).toHaveLength(2);
    expect(item?.optionGroups?.[0]?.options).toHaveLength(1);
    expect(item?.optionGroups?.[1]?.options[0]?.label).toBe('ไข่ดาว');
    // N+1 guard: two groups, one options query.
    expect(callsTo('menu_options')).toHaveLength(1);
    expect(callsTo('menu_options')[0]?.in.group_id).toEqual(['g1', 'g2']);
  });

  it('preserves minSelect and maxSelect through the whole read path', async () => {
    const { subject } = repoWith({
      menu_items: { data: ITEM_ROW, error: null },
      menu_categories: { data: [CATEGORY_ROW], error: null },
      menu_option_groups: {
        data: [
          { id: 'g1', menu_item_id: 'm1', title: 'ท็อปปิ้ง', min_select: 0, max_select: 3, sort_order: 0 },
        ],
        error: null,
      },
      menu_options: { data: [], error: null },
    });

    const group = (await subject.getMenuItem('r1', 'm1'))?.optionGroups?.[0];
    expect(group?.minSelect).toBe(0);
    expect(group?.maxSelect).toBe(3);
  });

  it('returns null when the item is not visible, without loading options', async () => {
    const { subject, callsTo } = repoWith({ menu_items: { data: null, error: null } });

    await expect(subject.getMenuItem('r1', 'nope')).resolves.toBeNull();
    expect(callsTo('menu_option_groups')).toHaveLength(0);
  });

  it('skips the options query when the item has no groups', async () => {
    const { subject, callsTo } = repoWith({
      menu_items: { data: ITEM_ROW, error: null },
      menu_categories: { data: [CATEGORY_ROW], error: null },
      menu_option_groups: { data: [], error: null },
    });

    const item = await subject.getMenuItem('r1', 'm1');
    expect(item?.optionGroups).toEqual([]);
    expect(callsTo('menu_options')).toHaveLength(0);
  });
});

describe('search', () => {
  it('queries both restaurants and menu items with ilike', async () => {
    const { subject, callsTo } = repoWith({
      restaurants: { data: [RESTAURANT_ROW], error: null },
      restaurant_hours: { data: [HOURS_ROW], error: null },
      menu_items: { data: [ITEM_ROW], error: null },
    });

    const result = await subject.search('ส้มตำ');

    expect(result.shops).toHaveLength(1);
    expect(result.items).toHaveLength(1);
    expect(callsTo('restaurants')[0]?.ilike.name).toBe('%ส้มตำ%');
    expect(callsTo('menu_items')[0]?.ilike.name).toBe('%ส้มตำ%');
  });

  // --- F-2: the N+1 that used to live here --------------------------------

  it('issues NO category queries, however many restaurants the items span', async () => {
    const { subject, callsTo } = repoWith({
      restaurants: { data: [], error: null },
      menu_items: {
        data: [
          ITEM_ROW,
          { ...ITEM_ROW, id: 'm2', restaurant_id: 'r2' },
          { ...ITEM_ROW, id: 'm3', restaurant_id: 'r3' },
          { ...ITEM_ROW, id: 'm4', restaurant_id: 'r4' },
        ],
        error: null,
      },
    });

    const result = await subject.search('ส้มตำ');

    // Previously one query per distinct restaurant, for a `categoryName` the
    // search results never render. Four restaurants, zero category queries.
    expect(callsTo('menu_categories')).toHaveLength(0);
    expect(result.items).toHaveLength(4);
  });

  it('keeps the total query count flat for search', async () => {
    const { subject, calls } = repoWith({
      restaurants: { data: [RESTAURANT_ROW], error: null },
      restaurant_hours: { data: [HOURS_ROW], error: null },
      menu_items: {
        data: [ITEM_ROW, { ...ITEM_ROW, id: 'm2', restaurant_id: 'r2' }],
        error: null,
      },
    });

    await subject.search('ส้มตำ');

    // restaurants + menu_items + one batched hours lookup. Nothing per-row.
    expect(calls.map((c) => c.table).sort()).toEqual([
      'menu_items',
      'restaurant_hours',
      'restaurants',
    ]);
  });

  it('still returns items with categoryId intact for a future batched lookup', async () => {
    const { subject } = repoWith({
      restaurants: { data: [], error: null },
      menu_items: { data: [ITEM_ROW], error: null },
    });

    const result = await subject.search('ส้มตำ');
    expect(result.items[0]?.categoryId).toBe('c1');
    expect(result.items[0]?.categoryName).toBe('');
  });

  it('returns empty results for a blank query without touching the database', async () => {
    const { subject, calls } = repoWith({});

    await expect(subject.search('   ')).resolves.toEqual({ shops: [], items: [] });
    expect(calls).toHaveLength(0);
  });

  it('escapes ilike wildcards so a literal % is not a match-all', async () => {
    const { subject, callsTo } = repoWith({
      restaurants: { data: [], error: null },
      menu_items: { data: [], error: null },
    });

    await subject.search('100%');
    expect(callsTo('restaurants')[0]?.ilike.name).toBe('%100\\%%');
  });

  it('escapes an underscore, which is LIKE single-character wildcard', async () => {
    const { subject, callsTo } = repoWith({
      restaurants: { data: [], error: null },
      menu_items: { data: [], error: null },
    });

    await subject.search('a_b');
    expect(callsTo('restaurants')[0]?.ilike.name).toBe('%a\\_b%');
  });

  // --- F-4 -----------------------------------------------------------------

  it('escapes a literal backslash so `a\\b` does not match `ab`', async () => {
    const { subject, callsTo } = repoWith({
      restaurants: { data: [], error: null },
      menu_items: { data: [], error: null },
    });

    await subject.search('a\\b');

    // Backslash is Postgres' LIKE escape character. Unescaped, `\\b` would be
    // read as an escaped `b` and match `ab`; doubled, it is a literal.
    expect(callsTo('restaurants')[0]?.ilike.name).toBe('%a\\\\b%');
    expect(callsTo('menu_items')[0]?.ilike.name).toBe('%a\\\\b%');
  });

  it('escapes backslash before wildcards, so the escaping is not double-applied', async () => {
    const { subject, callsTo } = repoWith({
      restaurants: { data: [], error: null },
      menu_items: { data: [], error: null },
    });

    await subject.search('50\\%');
    // One literal backslash, then a literal percent.
    expect(callsTo('restaurants')[0]?.ilike.name).toBe('%50\\\\\\%%');
  });

  it('treats an empty result as success, not an error', async () => {
    const { subject } = repoWith({
      restaurants: { data: [], error: null },
      menu_items: { data: [], error: null },
    });

    await expect(subject.search('ไม่มี')).resolves.toEqual({ shops: [], items: [] });
  });

  it('propagates a search error', async () => {
    const { subject } = repoWith({
      restaurants: { data: null, error: { message: 'search down' } },
      menu_items: { data: [], error: null },
    });

    await expect(subject.search('ส้มตำ')).rejects.toThrow(/search down/);
  });
});
