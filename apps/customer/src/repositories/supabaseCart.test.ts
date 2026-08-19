import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createSupabaseCartRepository,
  MixedRestaurantError,
  NotAuthenticatedError,
} from './supabaseCart';

/**
 * Phase D / D-4 — the Supabase cart repository.
 *
 * Same approach as `supabaseCatalog.test.ts`: assert the **query that was
 * built**, not just the mapped output. A repository that wrote the right shape
 * to the wrong table, or omitted `restaurant_id` and quietly defeated the
 * DEC-017 composite foreign keys, would pass an output-only test.
 */

type Result = { data: unknown; error: { message: string } | null };

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete';
  payload?: unknown;
  eq: Record<string, unknown>;
  in: Record<string, unknown[]>;
}

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
      const call: Recorded = { table, op: 'select', eq: {}, in: {} };
      calls.push(call);

      const builder: Record<string, unknown> = {
        select: () => builder,
        insert(payload: unknown) {
          call.op = 'insert';
          call.payload = payload;
          return builder;
        },
        update(payload: unknown) {
          call.op = 'update';
          call.payload = payload;
          return builder;
        },
        delete() {
          call.op = 'delete';
          return builder;
        },
        eq(column: string, value: unknown) {
          call.eq[column] = value;
          // A bare delete/update terminates on `.eq` — it is thenable so the
          // repository can await it directly, exactly as PostgREST behaves.
          return Object.assign(builder, {
            then: (resolve: (r: Result) => unknown) => resolve(next(table)),
          });
        },
        in(column: string, values: unknown[]) {
          call.in[column] = values;
          return builder;
        },
        order: () => builder,
        returns: () => Promise.resolve(next(table)),
        maybeSingle: () => Promise.resolve(next(table)),
        single: () => Promise.resolve(next(table)),
      };

      return builder;
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

const USER = 'user-1';
const SHOP = 'shop-1';

function repoWith(
  byTable: Record<string, Result | Result[]>,
  userId: string | null = USER,
) {
  const { client, calls } = supabaseStub(byTable);
  return {
    subject: createSupabaseCartRepository(client, async () => userId),
    calls,
    callsTo: (table: string) => calls.filter((call) => call.table === table),
  };
}

const CART_ROW = { id: 'cart-1', restaurant_id: SHOP };

describe('getCart', () => {
  it('returns null when the customer has no cart', async () => {
    const { subject } = repoWith({ carts: { data: null, error: null } });
    await expect(subject.getCart()).resolves.toBeNull();
  });

  it('scopes the cart lookup to the caller', async () => {
    const { subject, callsTo } = repoWith({ carts: { data: null, error: null } });
    await subject.getCart();

    expect(callsTo('carts')[0]?.eq).toEqual({ user_id: USER });
  });

  it('prices lines from the live catalog rather than anything stored', async () => {
    const { subject } = repoWith({
      carts: { data: CART_ROW, error: null },
      cart_items: {
        data: [
          {
            id: 'ci-1',
            cart_id: 'cart-1',
            restaurant_id: SHOP,
            menu_item_id: 'mi-1',
            quantity: 2,
            note: 'ไม่ใส่ผัก',
          },
        ],
        error: null,
      },
      cart_item_options: {
        data: [{ id: 'cio-1', cart_item_id: 'ci-1', menu_option_id: 'mo-1' }],
        error: null,
      },
      menu_items: {
        data: [{ id: 'mi-1', name: 'ส้มตำไทย', base_price_satang: 6000, is_available: true }],
        error: null,
      },
      menu_options: {
        data: [{ id: 'mo-1', label: 'ไข่ดาว', price_delta_satang: 1000 }],
        error: null,
      },
    });

    const cart = await subject.getCart();

    expect(cart?.lines).toHaveLength(1);
    expect(cart?.lines[0]).toMatchObject({
      id: 'ci-1',
      name: 'ส้มตำไทย',
      basePriceSatang: 6000,
      quantity: 2,
      note: 'ไม่ใส่ผัก',
    });
    expect(cart?.lines[0]?.options[0]).toMatchObject({
      label: 'ไข่ดาว',
      priceDeltaSatang: 1000,
    });
  });

  it('reports a line whose menu item RLS no longer returns, rather than dropping it', async () => {
    const { subject } = repoWith({
      carts: { data: CART_ROW, error: null },
      cart_items: {
        data: [
          {
            id: 'ci-gone',
            cart_id: 'cart-1',
            restaurant_id: SHOP,
            menu_item_id: 'archived',
            quantity: 1,
            note: null,
          },
        ],
        error: null,
      },
      cart_item_options: { data: [], error: null },
      menu_items: { data: [], error: null },
      menu_options: { data: [], error: null },
    });

    const cart = await subject.getCart();

    expect(cart?.lines).toHaveLength(0);
    expect(cart?.unresolvedLineIds).toEqual(['ci-gone']);
  });

  it('throws rather than reporting an empty cart when the read fails', async () => {
    const { subject } = repoWith({
      carts: { data: null, error: { message: 'boom' } },
    });

    await expect(subject.getCart()).rejects.toThrow(/Cart lookup failed: boom/);
  });
});

describe('addItem', () => {
  const input = {
    shopId: SHOP,
    menuItemId: 'mi-1',
    quantity: 2,
    note: '  ไม่ใส่ผัก  ',
    menuOptionIds: ['mo-1'],
  };

  function addStub(cartRow: unknown) {
    return repoWith({
      carts: [{ data: cartRow, error: null }, { data: CART_ROW, error: null }],
      cart_items: [
        {
          data: {
            id: 'ci-1',
            cart_id: 'cart-1',
            restaurant_id: SHOP,
            menu_item_id: 'mi-1',
            quantity: 2,
            note: 'ไม่ใส่ผัก',
          },
          error: null,
        },
        { data: [], error: null },
      ],
      cart_item_options: { data: [], error: null },
      menu_items: { data: [], error: null },
      menu_options: { data: [], error: null },
    });
  }

  it('opens a cart with the caller as owner when none exists', async () => {
    const { subject, callsTo } = addStub(null);
    await subject.addItem(input);

    const insert = callsTo('carts').find((call) => call.op === 'insert');
    // `carts_insert_own` checks `user_id = auth.uid()` — the policy verifies the
    // value, it does not supply one, so omitting it would fail the WITH CHECK.
    expect(insert?.payload).toEqual({ user_id: USER, restaurant_id: SHOP });
  });

  it('writes restaurant_id on the line — the column both composite FKs pin', async () => {
    const { subject, callsTo } = addStub(null);
    await subject.addItem(input);

    const insert = callsTo('cart_items').find((call) => call.op === 'insert');
    expect(insert?.payload).toMatchObject({
      cart_id: 'cart-1',
      restaurant_id: SHOP,
      menu_item_id: 'mi-1',
      quantity: 2,
    });
  });

  it('never writes a price — cart_items has no price column and no grant for one', async () => {
    const { subject, callsTo } = addStub(null);
    await subject.addItem(input);

    const insert = callsTo('cart_items').find((call) => call.op === 'insert');
    const keys = Object.keys(insert?.payload as Record<string, unknown>);

    // The deployed grant is insert (cart_id, restaurant_id, menu_item_id,
    // quantity, note). Anything beyond that would be refused by Postgres.
    expect(keys.sort()).toEqual(
      ['cart_id', 'menu_item_id', 'note', 'quantity', 'restaurant_id'].sort(),
    );
  });

  it('trims the note and stores absence as NULL, not an empty string', async () => {
    const { subject, callsTo } = addStub(null);
    await subject.addItem({ ...input, note: '   ' });

    const insert = callsTo('cart_items').find((call) => call.op === 'insert');
    expect((insert?.payload as { note: unknown }).note).toBeNull();
  });

  it('stores option identities, never labels or deltas', async () => {
    const { subject, callsTo } = addStub(null);
    await subject.addItem(input);

    const insert = callsTo('cart_item_options').find((call) => call.op === 'insert');
    expect(insert?.payload).toEqual([{ cart_item_id: 'ci-1', menu_option_id: 'mo-1' }]);
  });

  it('skips the option insert entirely when nothing was chosen', async () => {
    const { subject, callsTo } = addStub(null);
    await subject.addItem({ ...input, menuOptionIds: [] });

    expect(callsTo('cart_item_options').some((call) => call.op === 'insert')).toBe(false);
  });

  it('reuses the existing cart instead of opening a second one', async () => {
    const { subject, callsTo } = addStub(CART_ROW);
    await subject.addItem(input);

    // `carts_user_id_key` is UNIQUE — a second insert would be a constraint
    // violation, not merely wasteful.
    expect(callsTo('carts').some((call) => call.op === 'insert')).toBe(false);
  });

  it('raises MIXED_RESTAURANT for a different restaurant, without writing (DEC-017)', async () => {
    const { subject, callsTo } = addStub({ id: 'cart-1', restaurant_id: 'other-shop' });

    await expect(subject.addItem(input)).rejects.toBeInstanceOf(MixedRestaurantError);
    // The composite FKs would refuse this anyway; the point is the customer
    // gets the C-09 dialog instead of a constraint violation.
    expect(callsTo('cart_items')).toHaveLength(0);
  });

  it('carries both restaurant ids so the dialog can name them', async () => {
    const { subject } = addStub({ id: 'cart-1', restaurant_id: 'other-shop' });

    await expect(subject.addItem(input)).rejects.toMatchObject({
      currentShopId: 'other-shop',
      attemptedShopId: SHOP,
    });
  });
});

describe('setQuantity / removeItem / clear', () => {
  const loaded = {
    carts: { data: CART_ROW, error: null },
    cart_items: { data: [], error: null },
    cart_item_options: { data: [], error: null },
    menu_items: { data: [], error: null },
    menu_options: { data: [], error: null },
  };

  it('updates only the quantity column', async () => {
    const { subject, callsTo } = repoWith(loaded);
    await subject.setQuantity('ci-1', 3);

    const update = callsTo('cart_items').find((call) => call.op === 'update');
    expect(update?.payload).toEqual({ quantity: 3 });
    expect(update?.eq).toEqual({ id: 'ci-1' });
  });

  it('deletes the line by id', async () => {
    const { subject, callsTo } = repoWith(loaded);
    await subject.removeItem('ci-1');

    const del = callsTo('cart_items').find((call) => call.op === 'delete');
    expect(del?.eq).toEqual({ id: 'ci-1' });
  });

  it('clears by deleting the cart, letting items cascade', async () => {
    const { subject, callsTo } = repoWith(loaded);
    await subject.clear();

    expect(callsTo('carts').some((call) => call.op === 'delete')).toBe(true);
    // One statement, not three — the FKs cascade.
    expect(callsTo('cart_items').some((call) => call.op === 'delete')).toBe(false);
  });

  it('treats clearing a non-existent cart as success', async () => {
    const { subject, callsTo } = repoWith({ carts: { data: null, error: null } });

    await expect(subject.clear()).resolves.toBeUndefined();
    expect(callsTo('carts').some((call) => call.op === 'delete')).toBe(false);
  });
});

describe('DEC-D-03 — no guest cart', () => {
  const anonymous = { carts: { data: null, error: null } };

  it.each([
    ['getCart', (s: ReturnType<typeof repoWith>['subject']) => s.getCart()],
    [
      'addItem',
      (s: ReturnType<typeof repoWith>['subject']) =>
        s.addItem({
          shopId: SHOP,
          menuItemId: 'mi-1',
          quantity: 1,
          note: '',
          menuOptionIds: [],
        }),
    ],
    ['setQuantity', (s: ReturnType<typeof repoWith>['subject']) => s.setQuantity('ci-1', 2)],
    ['removeItem', (s: ReturnType<typeof repoWith>['subject']) => s.removeItem('ci-1')],
    ['clear', (s: ReturnType<typeof repoWith>['subject']) => s.clear()],
  ])('%s refuses without a session', async (_name, operation) => {
    const { subject } = repoWith(anonymous, null);
    await expect(operation(subject)).rejects.toBeInstanceOf(NotAuthenticatedError);
  });

  it('makes no request at all when signed out', async () => {
    const { subject, calls } = repoWith(anonymous, null);

    await expect(subject.getCart()).rejects.toBeInstanceOf(NotAuthenticatedError);
    expect(calls).toHaveLength(0);
  });
});
