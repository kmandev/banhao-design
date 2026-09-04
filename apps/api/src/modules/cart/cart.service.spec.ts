import { CartService } from './cart.service';
import { DomainError } from '../../common/errors/domain-error';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * Phase D / D-6 — `CartService.validate`.
 *
 * Same approach as `addresses.service.spec.ts`: a table-keyed stub records the
 * query each statement was built with, so these assert the actual boundary —
 * that ownership and availability are real filters, not just what the mapped
 * output happens to look like.
 */

type Result = { data: unknown; error: { message: string } | null };

interface Recorded {
  table: string;
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

  const admin = {
    from(table: string) {
      const call: Recorded = { table, eq: {}, in: {} };
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
        returns: () => Promise.resolve(next(table)),
        maybeSingle: () => Promise.resolve(next(table)),
      };

      return builder;
    },
  };

  return { service: { admin } as unknown as SupabaseService, calls };
}

function serviceWith(byTable: Record<string, Result | Result[]>) {
  const { service, calls } = supabaseStub(byTable);
  return {
    subject: new CartService(service),
    calls,
    callsTo: (table: string) => calls.filter((call) => call.table === table),
  };
}

const USER = 'user-1';
const OTHER_USER = 'user-2';
const CART = { id: 'cart-1', restaurant_id: 'shop-1' };
const CART_ITEM = { id: 'ci-1', menu_item_id: 'mi-1', restaurant_id: 'shop-1', quantity: 2 };
const MENU_ITEM = {
  id: 'mi-1',
  restaurant_id: 'shop-1',
  base_price_satang: 6000,
  is_available: true,
  archived_at: null,
};
const RESTAURANT = { id: 'shop-1', status: 'ACTIVE', availability_mode: 'NORMAL' };

describe('CartService.validate — ownership', () => {
  it('scopes the cart lookup to the caller, never a client-supplied id', async () => {
    const { subject, callsTo } = serviceWith({ carts: { data: null, error: null } });
    await subject.validate(USER, {});

    expect(callsTo('carts')[0]?.eq).toEqual({ user_id: USER });
  });

  it('returns an empty result rather than an error when the caller has no cart', async () => {
    const { subject } = serviceWith({ carts: { data: null, error: null } });
    const result = await subject.validate(USER, {});

    expect(result).toEqual({ cartId: null, restaurantId: null, subtotalSatang: 0, lines: [] });
  });

  it('a different user validating produces their own empty result, never the first user’s cart', async () => {
    // Two independent calls, each scoped by its own caller id. Nothing in the
    // request can name whose cart is read except the verified JWT subject.
    const { subject: asUserA } = serviceWith({ carts: { data: CART, error: null } });
    const { subject: asUserB } = serviceWith({ carts: { data: null, error: null } });

    const [resultA, resultB] = await Promise.all([
      asUserA.validate(USER, {}),
      asUserB.validate(OTHER_USER, {}),
    ]);

    expect(resultA.cartId).toBe('cart-1');
    expect(resultB.cartId).toBeNull();
  });

  it('returns an empty result for a cart with no items, not an error', async () => {
    const { subject } = serviceWith({
      carts: { data: CART, error: null },
      cart_items: { data: [], error: null },
    });

    const result = await subject.validate(USER, {});
    expect(result).toEqual({ cartId: 'cart-1', restaurantId: 'shop-1', subtotalSatang: 0, lines: [] });
  });
});

function baseTables(overrides: Record<string, Result | Result[]> = {}) {
  return {
    carts: { data: CART, error: null },
    cart_items: { data: [CART_ITEM], error: null },
    restaurants: { data: RESTAURANT, error: null },
    menu_items: { data: [MENU_ITEM], error: null },
    cart_item_options: { data: [], error: null },
    menu_options: { data: [], error: null },
    menu_option_groups: { data: [], error: null },
    ...overrides,
  };
}

describe('CartService.validate — a valid cart', () => {
  it('re-prices from the live catalog, in integer satang', async () => {
    const { subject } = serviceWith(baseTables());
    const result = await subject.validate(USER, {});

    expect(result.subtotalSatang).toBe(12000); // 6000 × 2
    expect(Number.isInteger(result.subtotalSatang)).toBe(true);
    expect(result.lines).toEqual([
      { cartItemId: 'ci-1', menuItemId: 'mi-1', quantity: 2, unitPriceSatang: 6000, lineSubtotalSatang: 12000 },
    ]);
  });

  it('adds available option deltas into the unit price before quantity', async () => {
    const { subject } = serviceWith(
      baseTables({
        cart_item_options: {
          data: [{ id: 'cio-1', cart_item_id: 'ci-1', menu_option_id: 'mo-1' }],
          error: null,
        },
        menu_options: {
          data: [{ id: 'mo-1', group_id: 'g-1', price_delta_satang: 1000, is_available: true }],
          error: null,
        },
        menu_option_groups: { data: [{ id: 'g-1', menu_item_id: 'mi-1' }], error: null },
      }),
    );

    const result = await subject.validate(USER, {});

    // (6000 + 1000) × 2 — a common bug is 6000×2 + 1000.
    expect(result.lines[0]?.unitPriceSatang).toBe(7000);
    expect(result.subtotalSatang).toBe(14000);
  });

  it('excludes an unavailable option from the subtotal without raising an error', async () => {
    const { subject } = serviceWith(
      baseTables({
        cart_item_options: {
          data: [{ id: 'cio-1', cart_item_id: 'ci-1', menu_option_id: 'mo-1' }],
          error: null,
        },
        menu_options: {
          data: [{ id: 'mo-1', group_id: 'g-1', price_delta_satang: 1000, is_available: false }],
          error: null,
        },
        menu_option_groups: { data: [{ id: 'g-1', menu_item_id: 'mi-1' }], error: null },
      }),
    );

    const result = await subject.validate(USER, {});

    // PC-Q-001 parity, and no OPTION_UNAVAILABLE code exists in the catalogue —
    // this is a silent exclusion, not a rejected cart.
    expect(result.lines[0]?.unitPriceSatang).toBe(6000);
  });

  it('excludes an option whose group does not resolve to the cart item (integrity fault), not an error', async () => {
    const { subject } = serviceWith(
      baseTables({
        cart_item_options: {
          data: [{ id: 'cio-1', cart_item_id: 'ci-1', menu_option_id: 'mo-1' }],
          error: null,
        },
        menu_options: {
          data: [{ id: 'mo-1', group_id: 'g-1', price_delta_satang: 1000, is_available: true }],
          error: null,
        },
        // g-1 belongs to a different menu item entirely.
        menu_option_groups: { data: [{ id: 'g-1', menu_item_id: 'some-other-item' }], error: null },
      }),
    );

    const result = await subject.validate(USER, {});
    expect(result.lines[0]?.unitPriceSatang).toBe(6000);
  });
});

describe('CartService.validate — ITEM_UNAVAILABLE', () => {
  it('raises for is_available = false', async () => {
    const { subject } = serviceWith(
      baseTables({ menu_items: { data: [{ ...MENU_ITEM, is_available: false }], error: null } }),
    );

    await expect(subject.validate(USER, {})).rejects.toMatchObject({
      code: 'ITEM_UNAVAILABLE',
    });
  });

  it('raises for an archived item', async () => {
    const { subject } = serviceWith(
      baseTables({
        menu_items: { data: [{ ...MENU_ITEM, archived_at: '2026-08-01T00:00:00Z' }], error: null },
      }),
    );

    await expect(subject.validate(USER, {})).rejects.toBeInstanceOf(DomainError);
    await expect(subject.validate(USER, {})).rejects.toMatchObject({ code: 'ITEM_UNAVAILABLE' });
  });

  it('raises when the item no longer resolves at all (defensive)', async () => {
    const { subject } = serviceWith(baseTables({ menu_items: { data: [], error: null } }));
    await expect(subject.validate(USER, {})).rejects.toMatchObject({ code: 'ITEM_UNAVAILABLE' });
  });

  it('raises for every item when the restaurant is no longer ACTIVE', async () => {
    const { subject } = serviceWith(
      baseTables({ restaurants: { data: { id: 'shop-1', status: 'SUSPENDED' }, error: null } }),
    );

    await expect(subject.validate(USER, {})).rejects.toMatchObject({
      code: 'ITEM_UNAVAILABLE',
      details: { items: [{ cartItemId: 'ci-1', menuItemId: 'mi-1' }] },
    });
  });

  it('carries structured, machine-readable details, not prose', async () => {
    const { subject } = serviceWith(
      baseTables({ menu_items: { data: [{ ...MENU_ITEM, is_available: false }], error: null } }),
    );

    await expect(subject.validate(USER, {})).rejects.toMatchObject({
      details: { items: [{ cartItemId: 'ci-1', menuItemId: 'mi-1' }] },
    });
  });
});

describe('CartService.validate — RESTAURANT_CLOSED (M-13, Paused)', () => {
  it('raises RESTAURANT_CLOSED, not ITEM_UNAVAILABLE, when the restaurant is Paused', async () => {
    const { subject } = serviceWith(
      baseTables({
        restaurants: { data: { id: 'shop-1', status: 'ACTIVE', availability_mode: 'PAUSED' }, error: null },
      }),
    );

    await expect(subject.validate(USER, {})).rejects.toMatchObject({
      code: 'RESTAURANT_CLOSED',
      details: { restaurantId: 'shop-1' },
    });
  });

  it('never reaches the ITEM_UNAVAILABLE check for a Paused restaurant, even with an unavailable item', async () => {
    const { subject } = serviceWith(
      baseTables({
        restaurants: { data: { id: 'shop-1', status: 'ACTIVE', availability_mode: 'PAUSED' }, error: null },
        menu_items: { data: [{ ...MENU_ITEM, is_available: false }], error: null },
      }),
    );

    await expect(subject.validate(USER, {})).rejects.toMatchObject({ code: 'RESTAURANT_CLOSED' });
  });

  it('a Busy restaurant is unaffected — still validates normally, no conflict', async () => {
    const { subject } = serviceWith(
      baseTables({
        restaurants: {
          data: { id: 'shop-1', status: 'ACTIVE', availability_mode: 'BUSY' },
          error: null,
        },
      }),
    );

    const result = await subject.validate(USER, {});
    expect(result.lines).toHaveLength(1);
  });

  it('a non-ACTIVE restaurant keeps its pre-existing ITEM_UNAVAILABLE behaviour — unchanged by M-13', async () => {
    const { subject } = serviceWith(
      baseTables({
        restaurants: { data: { id: 'shop-1', status: 'SUSPENDED', availability_mode: 'NORMAL' }, error: null },
      }),
    );

    await expect(subject.validate(USER, {})).rejects.toMatchObject({ code: 'ITEM_UNAVAILABLE' });
  });
});

describe('CartService.validate — MIXED_RESTAURANT (defence in depth)', () => {
  it('raises if a cart_item somehow carries a different restaurant_id than its cart', async () => {
    // DEC-017's composite foreign keys make this unreachable through the
    // repository; this proves the service still fails loudly rather than
    // mis-pricing, if it is ever reached by a bug or manual edit.
    const { subject, callsTo } = serviceWith(
      baseTables({
        cart_items: { data: [{ ...CART_ITEM, restaurant_id: 'other-shop' }], error: null },
      }),
    );

    await expect(subject.validate(USER, {})).rejects.toMatchObject({ code: 'MIXED_RESTAURANT' });
    // Must fail before ever reading the catalog for a cart it cannot trust.
    expect(callsTo('menu_items')).toHaveLength(0);
  });
});

describe('CartService.validate — PRICE_CHANGED', () => {
  it('raises when the client’s expected unit price no longer matches the live price', async () => {
    const { subject } = serviceWith(baseTables());

    await expect(
      subject.validate(USER, {
        expectedLines: [{ cartItemId: 'ci-1', expectedUnitPriceSatang: 5000 }],
      }),
    ).rejects.toMatchObject({
      code: 'PRICE_CHANGED',
      details: { lines: [{ cartItemId: 'ci-1', expectedSatang: 5000, currentSatang: 6000 }] },
    });
  });

  it('does not raise when the expected price still matches', async () => {
    const { subject } = serviceWith(baseTables());

    const result = await subject.validate(USER, {
      expectedLines: [{ cartItemId: 'ci-1', expectedUnitPriceSatang: 6000 }],
    });

    expect(result.subtotalSatang).toBe(12000);
  });

  it('is skipped entirely when the request carries no expectedLines', async () => {
    const { subject } = serviceWith(baseTables());
    await expect(subject.validate(USER, {})).resolves.toMatchObject({ subtotalSatang: 12000 });
  });

  it('ignores a cartItemId that does not belong to the caller’s own cart', async () => {
    const { subject } = serviceWith(baseTables());

    // A stale or foreign id is never compared against anything — only rows
    // already loaded for this cart are considered.
    const result = await subject.validate(USER, {
      expectedLines: [{ cartItemId: 'someone-elses-line', expectedUnitPriceSatang: 1 }],
    });

    expect(result.subtotalSatang).toBe(12000);
  });

  it('checks availability before price, so an unavailable item reports ITEM_UNAVAILABLE not PRICE_CHANGED', async () => {
    const { subject } = serviceWith(
      baseTables({ menu_items: { data: [{ ...MENU_ITEM, is_available: false }], error: null } }),
    );

    await expect(
      subject.validate(USER, {
        expectedLines: [{ cartItemId: 'ci-1', expectedUnitPriceSatang: 1 }],
      }),
    ).rejects.toMatchObject({ code: 'ITEM_UNAVAILABLE' });
  });
});

describe('CartService.validate — DEC-D-01, no invented money', () => {
  it('the result carries no delivery fee, service fee, discount or grand total', async () => {
    const { subject } = serviceWith(baseTables());
    const result = await subject.validate(USER, {});

    const keys = Object.keys(result);
    expect(keys).not.toContain('deliveryFeeSatang');
    expect(keys).not.toContain('serviceFeeSatang');
    expect(keys).not.toContain('discountSatang');
    expect(keys).not.toContain('totalSatang');
    expect(keys).not.toContain('grandTotalSatang');
  });
});
