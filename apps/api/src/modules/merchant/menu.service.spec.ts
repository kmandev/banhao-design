import { Logger } from '@nestjs/common';
import { MenuService } from './menu.service';
import { DomainError } from '../../common/errors/domain-error';
import { NO_CAPABILITIES, type ActorCapabilities } from '../../common/types';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * M-11 — the merchant catalog write service.
 *
 * `SupabaseService` is stubbed, matching `menu-item-image.service.spec.ts`:
 * these assert the *query this service builds*, not PostgREST's behaviour.
 * The transactional half — reorder renumbering, option replacement, rollback
 * on a constraint violation — is proven by execution against real Postgres in
 * `supabase/tests/merchant_catalog_write_test.sql`.
 *
 * The recurring shape worth naming: every id-keyed route resolves the owning
 * restaurant from the row *first*, so an unauthorized caller is refused before
 * any write is built. Several tests below assert that no write call was
 * recorded at all, not merely that the promise rejected.
 */

const RESTAURANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_RESTAURANT_ID = '22222222-2222-4222-8222-222222222222';
const CATEGORY_ID = '33333333-3333-4333-8333-333333333333';
const ITEM_ID = '44444444-4444-4444-8444-444444444444';

const MERCHANT_A: ActorCapabilities = {
  ...NO_CAPABILITIES,
  merchant: [{ restaurantId: RESTAURANT_ID, memberRole: 'OWNER' }],
};

const MERCHANT_B: ActorCapabilities = {
  ...NO_CAPABILITIES,
  merchant: [{ restaurantId: OTHER_RESTAURANT_ID, memberRole: 'OWNER' }],
};

const CATEGORY_ROW = {
  id: CATEGORY_ID,
  restaurant_id: RESTAURANT_ID,
  name: 'แนะนำ',
  sort_order: 0,
  archived_at: null,
};

const ITEM_ROW = {
  id: ITEM_ID,
  restaurant_id: RESTAURANT_ID,
  category_id: CATEGORY_ID,
  name: 'ข้าวผัดกุ้ง',
  description: 'ไข่ ต้นหอม',
  base_price_satang: 6500,
  image_url: null,
  is_available: true,
  sort_order: 0,
  archived_at: null,
  updated_at: '2026-09-01T09:14:00.000Z',
};

type Result = { data?: unknown; error: { message: string } | null; count?: number };

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update';
  payload?: Record<string, unknown>;
  filters: Record<string, unknown>;
  head?: boolean;
}

interface RpcRecorded {
  fn: string;
  args: Record<string, unknown>;
}

/**
 * `results` is consumed in order, one entry per `.from(...)` chain. A chain is
 * thenable, so `await`ing it anywhere in the builder resolves the next result.
 */
function fakeSupabase(results: Result[]): {
  service: SupabaseService;
  calls: Recorded[];
  rpcs: RpcRecorded[];
} {
  const calls: Recorded[] = [];
  const rpcs: RpcRecorded[] = [];
  let index = 0;

  const service = {
    admin: {
      from(table: string) {
        const recorded: Recorded = { table, op: 'select', filters: {} };
        calls.push(recorded);
        const result = results[index++] ?? { data: null, error: null };

        const builder: Record<string, unknown> = {
          select(_columns: string, options?: { head?: boolean }) {
            if (options?.head) recorded.head = true;
            return builder;
          },
          insert(payload: Record<string, unknown>) {
            recorded.op = 'insert';
            recorded.payload = payload;
            return builder;
          },
          update(payload: Record<string, unknown>) {
            recorded.op = 'update';
            recorded.payload = payload;
            return builder;
          },
          eq(column: string, value: unknown) {
            recorded.filters[column] = value;
            return builder;
          },
          is(column: string, value: unknown) {
            recorded.filters[`${column} is`] = value;
            return builder;
          },
          order() {
            return builder;
          },
          limit() {
            return builder;
          },
          maybeSingle: () => Promise.resolve(result),
          then: (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve),
        };

        return builder;
      },
      rpc(fn: string, args: Record<string, unknown>) {
        rpcs.push({ fn, args });
        const result = results[index++] ?? { data: null, error: null };
        return Promise.resolve(result);
      },
    },
  } as unknown as SupabaseService;

  return { service, calls, rpcs };
}

function writes(calls: Recorded[]): Recorded[] {
  return calls.filter((call) => call.op !== 'select');
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('MenuService — categories', () => {
  it('appends a new category one past the current highest sort_order', async () => {
    const { service, calls } = fakeSupabase([
      { data: { sort_order: 4 }, error: null },
      { data: { ...CATEGORY_ROW, name: 'ของหวาน', sort_order: 5 }, error: null },
    ]);

    const result = await new MenuService(service).createCategory(RESTAURANT_ID, { name: 'ของหวาน' });

    expect(calls[1]?.payload).toEqual({
      restaurant_id: RESTAURANT_ID,
      name: 'ของหวาน',
      sort_order: 5,
    });
    expect(result).toMatchObject({ name: 'ของหวาน', sortOrder: 5 });
  });

  it('starts a restaurant’s first category at sort_order 0', async () => {
    const { service, calls } = fakeSupabase([
      { data: null, error: null },
      { data: CATEGORY_ROW, error: null },
    ]);

    await new MenuService(service).createCategory(RESTAURANT_ID, { name: 'แนะนำ' });

    expect(calls[1]?.payload).toMatchObject({ sort_order: 0 });
  });

  it('renames a category the caller is a member of', async () => {
    const { service, calls } = fakeSupabase([
      { data: CATEGORY_ROW, error: null },
      { data: { ...CATEGORY_ROW, name: 'ของหวาน' }, error: null },
    ]);

    const result = await new MenuService(service).updateCategory(
      CATEGORY_ID,
      { name: 'ของหวาน' },
      MERCHANT_A,
    );

    expect(result.name).toBe('ของหวาน');
    expect(writes(calls)[0]?.payload).toEqual({ name: 'ของหวาน' });
  });

  it('refuses to rename another restaurant’s category, before building any write', async () => {
    const { service, calls } = fakeSupabase([{ data: CATEGORY_ROW, error: null }]);

    await expect(
      new MenuService(service).updateCategory(CATEGORY_ID, { name: 'ของหวาน' }, MERCHANT_B),
    ).rejects.toMatchObject({ code: 'NOT_RESTAURANT_MEMBER' });

    expect(writes(calls)).toEqual([]);
  });

  it('reports a missing category and someone else’s category identically', async () => {
    // A merchant must not be able to probe whether an id names a real dish in
    // a shop they do not belong to.
    const missing = fakeSupabase([{ data: null, error: null }]);
    const foreign = fakeSupabase([{ data: CATEGORY_ROW, error: null }]);

    const a = await new MenuService(missing.service)
      .updateCategory(CATEGORY_ID, { name: 'x' }, MERCHANT_A)
      .catch((error: unknown) => (error as DomainError).code);
    const b = await new MenuService(foreign.service)
      .updateCategory(CATEGORY_ID, { name: 'x' }, MERCHANT_B)
      .catch((error: unknown) => (error as DomainError).code);

    expect(a).toBe('NOT_RESTAURANT_MEMBER');
    expect(b).toBe('NOT_RESTAURANT_MEMBER');
  });

  it('archives an empty category, setting archived_at rather than deleting', async () => {
    const { service, calls } = fakeSupabase([
      { data: CATEGORY_ROW, error: null },
      { count: 0, error: null },
      { data: { id: CATEGORY_ID, archived_at: '2026-09-01T10:00:00.000Z' }, error: null },
    ]);

    const result = await new MenuService(service).archiveCategory(CATEGORY_ID, MERCHANT_A);

    expect(result).toEqual({ id: CATEGORY_ID, archivedAt: '2026-09-01T10:00:00.000Z' });
    const write = writes(calls)[0];
    expect(write?.op).toBe('update');
    expect(Object.keys(write?.payload ?? {})).toEqual(['archived_at']);
  });

  it('guards the archive in the WHERE clause rather than reading then checking (ADR-003)', async () => {
    const { service, calls } = fakeSupabase([
      { data: CATEGORY_ROW, error: null },
      { count: 0, error: null },
      { data: { id: CATEGORY_ID, archived_at: '2026-09-01T10:00:00.000Z' }, error: null },
    ]);

    await new MenuService(service).archiveCategory(CATEGORY_ID, MERCHANT_A);

    expect(writes(calls)[0]?.filters).toEqual({ id: CATEGORY_ID, 'archived_at is': null });
  });

  it('refuses to archive a category that still holds active dishes (M11-Q-01)', async () => {
    // `menu_items_select_active` checks only the item and the restaurant, not
    // the category, so archiving a populated one would leave its dishes
    // publicly readable with no section. Blocking is the design's own safe
    // placeholder while M11-Q-01 is open.
    const { service, calls } = fakeSupabase([
      { data: CATEGORY_ROW, error: null },
      { count: 9, error: null },
    ]);

    const error = (await new MenuService(service)
      .archiveCategory(CATEGORY_ID, MERCHANT_A)
      .catch((thrown: unknown) => thrown)) as DomainError;

    expect(error.code).toBe('CONFLICT');
    expect(error.details).toMatchObject({ activeItemCount: 9 });
    expect(writes(calls)).toEqual([]);
  });

  it('reports an already-archived category as a conflict rather than succeeding twice', async () => {
    const { service } = fakeSupabase([
      { data: CATEGORY_ROW, error: null },
      { count: 0, error: null },
      { data: null, error: null },
    ]);

    await expect(
      new MenuService(service).archiveCategory(CATEGORY_ID, MERCHANT_A),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('reorders through the transactional function, never row by row', async () => {
    const { service, calls, rpcs } = fakeSupabase([{ data: 3, error: null }]);

    const result = await new MenuService(service).reorderCategories(RESTAURANT_ID, [
      CATEGORY_ID,
      'a',
      'b',
    ]);

    expect(rpcs).toEqual([
      {
        fn: 'reorder_menu_categories',
        args: { p_restaurant_id: RESTAURANT_ID, p_category_ids: [CATEGORY_ID, 'a', 'b'] },
      },
    ]);
    expect(writes(calls)).toEqual([]);
    expect(result).toEqual({ reordered: 3 });
  });

  it('turns a rejected reorder into VALIDATION_FAILED, not a 500', async () => {
    // The function raises for a partial, duplicated or foreign list — all
    // three are the caller sending a stale order, not a server fault.
    const { service } = fakeSupabase([{ data: null, error: { message: 'must name all 3' } }]);

    await expect(
      new MenuService(service).reorderCategories(RESTAURANT_ID, [CATEGORY_ID]),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('MenuService — menu items', () => {
  it('creates a dish, appending within its category', async () => {
    const { service, calls } = fakeSupabase([
      { data: { id: CATEGORY_ID, restaurant_id: RESTAURANT_ID, archived_at: null }, error: null },
      { data: { sort_order: 2 }, error: null },
      { data: ITEM_ROW, error: null },
    ]);

    await new MenuService(service).createItem(RESTAURANT_ID, {
      categoryId: CATEGORY_ID,
      name: 'ข้าวผัดกุ้ง',
      basePriceSatang: 6500,
    });

    expect(writes(calls)[0]?.payload).toEqual({
      restaurant_id: RESTAURANT_ID,
      category_id: CATEGORY_ID,
      name: 'ข้าวผัดกุ้ง',
      description: null,
      base_price_satang: 6500,
      is_available: true,
      sort_order: 3,
    });
  });

  it('defaults a new dish to available, matching the column default and the create form', async () => {
    const { service, calls } = fakeSupabase([
      { data: { id: CATEGORY_ID, restaurant_id: RESTAURANT_ID, archived_at: null }, error: null },
      { data: null, error: null },
      { data: ITEM_ROW, error: null },
    ]);

    await new MenuService(service).createItem(RESTAURANT_ID, {
      categoryId: CATEGORY_ID,
      name: 'x',
      basePriceSatang: 0,
    });

    expect(writes(calls)[0]?.payload).toMatchObject({ is_available: true });
  });

  it('stores an empty description as null, not an empty string', async () => {
    const { service, calls } = fakeSupabase([
      { data: { id: CATEGORY_ID, restaurant_id: RESTAURANT_ID, archived_at: null }, error: null },
      { data: null, error: null },
      { data: ITEM_ROW, error: null },
    ]);

    await new MenuService(service).createItem(RESTAURANT_ID, {
      categoryId: CATEGORY_ID,
      name: 'x',
      description: '   ',
      basePriceSatang: 100,
    });

    expect(writes(calls)[0]?.payload).toMatchObject({ description: null });
  });

  it('refuses a category belonging to another restaurant, before any insert', async () => {
    const { service, calls } = fakeSupabase([
      { data: { id: CATEGORY_ID, restaurant_id: OTHER_RESTAURANT_ID, archived_at: null }, error: null },
    ]);

    await expect(
      new MenuService(service).createItem(RESTAURANT_ID, {
        categoryId: CATEGORY_ID,
        name: 'x',
        basePriceSatang: 100,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    expect(writes(calls)).toEqual([]);
  });

  it('refuses an archived category', async () => {
    const { service } = fakeSupabase([
      {
        data: { id: CATEGORY_ID, restaurant_id: RESTAURANT_ID, archived_at: '2026-08-01T00:00:00Z' },
        error: null,
      },
    ]);

    await expect(
      new MenuService(service).createItem(RESTAURANT_ID, {
        categoryId: CATEGORY_ID,
        name: 'x',
        basePriceSatang: 100,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('patches only the fields supplied', async () => {
    const { service, calls } = fakeSupabase([
      { data: ITEM_ROW, error: null },
      { data: { ...ITEM_ROW, base_price_satang: 7000 }, error: null },
    ]);

    await new MenuService(service).updateItem(ITEM_ID, { basePriceSatang: 7000 }, MERCHANT_A);

    expect(writes(calls)[0]?.payload).toEqual({ base_price_satang: 7000 });
  });

  it('clears a description when the patch sends null', async () => {
    const { service, calls } = fakeSupabase([
      { data: ITEM_ROW, error: null },
      { data: { ...ITEM_ROW, description: null }, error: null },
    ]);

    await new MenuService(service).updateItem(ITEM_ID, { description: null }, MERCHANT_A);

    expect(writes(calls)[0]?.payload).toEqual({ description: null });
  });

  it('allows a dish to move to another category of the same restaurant (M11-Q-02)', async () => {
    const { service, calls } = fakeSupabase([
      { data: ITEM_ROW, error: null },
      { data: { id: 'cat-2', restaurant_id: RESTAURANT_ID, archived_at: null }, error: null },
      { data: { ...ITEM_ROW, category_id: 'cat-2' }, error: null },
    ]);

    await new MenuService(service).updateItem(ITEM_ID, { categoryId: 'cat-2' }, MERCHANT_A);

    expect(writes(calls)[0]?.payload).toEqual({ category_id: 'cat-2' });
  });

  it('refuses to move a dish into another restaurant’s category', async () => {
    const { service, calls } = fakeSupabase([
      { data: ITEM_ROW, error: null },
      { data: { id: 'cat-2', restaurant_id: OTHER_RESTAURANT_ID, archived_at: null }, error: null },
    ]);

    await expect(
      new MenuService(service).updateItem(ITEM_ID, { categoryId: 'cat-2' }, MERCHANT_A),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    expect(writes(calls)).toEqual([]);
  });

  it('refuses to patch another restaurant’s dish', async () => {
    const { service, calls } = fakeSupabase([{ data: ITEM_ROW, error: null }]);

    await expect(
      new MenuService(service).updateItem(ITEM_ID, { name: 'x' }, MERCHANT_B),
    ).rejects.toMatchObject({ code: 'NOT_RESTAURANT_MEMBER' });

    expect(writes(calls)).toEqual([]);
  });

  it('writes exactly one boolean on the availability fast path', async () => {
    const { service, calls } = fakeSupabase([
      { data: ITEM_ROW, error: null },
      { data: { ...ITEM_ROW, is_available: false }, error: null },
    ]);

    const result = await new MenuService(service).setItemAvailability(ITEM_ID, false, MERCHANT_A);

    expect(writes(calls)[0]?.payload).toEqual({ is_available: false });
    expect(result.isAvailable).toBe(false);
  });

  it('refuses an availability flip on another restaurant’s dish', async () => {
    const { service, calls } = fakeSupabase([{ data: ITEM_ROW, error: null }]);

    await expect(
      new MenuService(service).setItemAvailability(ITEM_ID, false, MERCHANT_B),
    ).rejects.toMatchObject({ code: 'NOT_RESTAURANT_MEMBER' });

    expect(writes(calls)).toEqual([]);
  });

  it('archives a dish rather than deleting it', async () => {
    const { service, calls } = fakeSupabase([
      { data: ITEM_ROW, error: null },
      { data: { id: ITEM_ID, archived_at: '2026-09-01T10:00:00.000Z' }, error: null },
    ]);

    const result = await new MenuService(service).archiveItem(ITEM_ID, MERCHANT_A);

    expect(result.archivedAt).toBe('2026-09-01T10:00:00.000Z');
    const write = writes(calls)[0];
    expect(write?.op).toBe('update');
    expect(write?.filters).toEqual({ id: ITEM_ID, 'archived_at is': null });
  });

  it('reorders items through the transactional function', async () => {
    const { service, rpcs } = fakeSupabase([{ data: 2, error: null }]);

    await new MenuService(service).reorderItems(RESTAURANT_ID, CATEGORY_ID, [ITEM_ID, 'b']);

    expect(rpcs[0]).toEqual({
      fn: 'reorder_menu_items',
      args: {
        p_restaurant_id: RESTAURANT_ID,
        p_category_id: CATEGORY_ID,
        p_menu_item_ids: [ITEM_ID, 'b'],
      },
    });
  });

  it('never leaks a database message to the caller', async () => {
    const { service } = fakeSupabase([
      { data: null, error: { message: 'pg: relation menu_items does not exist' } },
    ]);

    const error = (await new MenuService(service)
      .updateItem(ITEM_ID, { name: 'x' }, MERCHANT_A)
      .catch((thrown: unknown) => thrown)) as DomainError;

    expect(error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(error)).not.toContain('relation menu_items');
  });
});

describe('MenuService — option groups', () => {
  it('replaces through the transactional function, with array position as sort order', async () => {
    const { service, rpcs } = fakeSupabase([{ data: ITEM_ROW, error: null }, { data: 2, error: null }]);

    const result = await new MenuService(service).replaceOptionGroups(
      ITEM_ID,
      [
        {
          title: 'ระดับความเผ็ด',
          minSelect: 1,
          maxSelect: 1,
          options: [{ label: 'เผ็ดมาก', priceDeltaSatang: 0, isAvailable: true }],
        },
        {
          title: 'เพิ่มเติม',
          minSelect: 0,
          maxSelect: 3,
          options: [{ label: 'ไข่ดาว', priceDeltaSatang: 1000, isAvailable: false }],
        },
      ],
      MERCHANT_A,
    );

    expect(rpcs[0]?.fn).toBe('replace_menu_item_option_groups');
    expect(rpcs[0]?.args.p_groups).toEqual([
      {
        title: 'ระดับความเผ็ด',
        minSelect: 1,
        maxSelect: 1,
        options: [{ label: 'เผ็ดมาก', priceDeltaSatang: 0, isAvailable: true }],
      },
      {
        title: 'เพิ่มเติม',
        minSelect: 0,
        maxSelect: 3,
        options: [{ label: 'ไข่ดาว', priceDeltaSatang: 1000, isAvailable: false }],
      },
    ]);
    expect(result).toEqual({ menuItemId: ITEM_ID, groupCount: 2 });
  });

  it('accepts an empty list — removing every group is a legitimate edit', async () => {
    const { service, rpcs } = fakeSupabase([{ data: ITEM_ROW, error: null }, { data: 0, error: null }]);

    const result = await new MenuService(service).replaceOptionGroups(ITEM_ID, [], MERCHANT_A);

    expect(rpcs[0]?.args.p_groups).toEqual([]);
    expect(result.groupCount).toBe(0);
  });

  it('refuses to rewrite another restaurant’s dish options, before calling the function', async () => {
    const { service, rpcs } = fakeSupabase([{ data: ITEM_ROW, error: null }]);

    await expect(
      new MenuService(service).replaceOptionGroups(ITEM_ID, [], MERCHANT_B),
    ).rejects.toMatchObject({ code: 'NOT_RESTAURANT_MEMBER' });

    expect(rpcs).toEqual([]);
  });
});
