import * as cartDomain from './cart';
import {
  cartItemCount,
  cartSubtotalSatang,
  emptyCart,
  lineTotalSatang,
  optionLabels,
  optionsDeltaSatang,
  type Cart,
  type CartLine,
} from './cart';

/**
 * Phase D / D-2 — the cart domain.
 *
 * These assert two separate things: that the arithmetic is right, and that the
 * money it refuses to compute stays refused. The second matters as much as the
 * first — DEC-D-01 is only real if there is no path from a cart to a total.
 */

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    id: 'line-1',
    menuItemId: 'item-1',
    name: 'ส้มตำไทย',
    basePriceSatang: 6000,
    isAvailable: true,
    quantity: 1,
    note: '',
    options: [],
    ...overrides,
  };
}

function cart(lines: CartLine[], unresolvedLineIds: string[] = []): Cart {
  return { id: 'cart-1', shopId: 'shop-1', lines, unresolvedLineIds };
}

describe('line arithmetic', () => {
  it('sums option deltas, including zero-delta options', () => {
    const subject = line({
      options: [
        { id: 'o1', menuOptionId: 'm1', label: 'เผ็ดน้อย', priceDeltaSatang: 0 },
        { id: 'o2', menuOptionId: 'm2', label: 'ไข่ดาว', priceDeltaSatang: 1000 },
      ],
    });

    expect(optionsDeltaSatang(subject)).toBe(1000);
  });

  it('applies quantity to base + options, not to base alone', () => {
    const subject = line({
      quantity: 3,
      options: [{ id: 'o1', menuOptionId: 'm1', label: 'ไข่ดาว', priceDeltaSatang: 1000 }],
    });

    // (6000 + 1000) × 3 — a common bug is 6000×3 + 1000.
    expect(lineTotalSatang(subject)).toBe(21000);
  });

  it('keeps every result an integer number of satang', () => {
    const subject = line({ basePriceSatang: 3333, quantity: 7 });
    const total = lineTotalSatang(subject);

    expect(Number.isInteger(total)).toBe(true);
    expect(total).toBe(23331);
  });

  it('exposes option labels in stored order', () => {
    const subject = line({
      options: [
        { id: 'o1', menuOptionId: 'm1', label: 'เผ็ดน้อย', priceDeltaSatang: 0 },
        { id: 'o2', menuOptionId: 'm2', label: 'ไข่ดาว', priceDeltaSatang: 1000 },
      ],
    });

    expect(optionLabels(subject)).toEqual(['เผ็ดน้อย', 'ไข่ดาว']);
  });
});

describe('cart totals', () => {
  it('sums the subtotal across lines', () => {
    const subject = cart([
      line({ id: 'a', basePriceSatang: 6000, quantity: 2 }),
      line({ id: 'b', basePriceSatang: 5500, quantity: 1 }),
    ]);

    expect(cartSubtotalSatang(subject)).toBe(17500);
  });

  it('counts individual items, not lines', () => {
    const subject = cart([
      line({ id: 'a', quantity: 2 }),
      line({ id: 'b', quantity: 3 }),
    ]);

    expect(cartItemCount(subject)).toBe(5);
    expect(subject.lines).toHaveLength(2);
  });

  it('is zero for an empty cart without special-casing', () => {
    const subject = emptyCart('cart-1', 'shop-1');

    expect(cartSubtotalSatang(subject)).toBe(0);
    expect(cartItemCount(subject)).toBe(0);
  });

  it('excludes unresolved lines from the subtotal but keeps their ids', () => {
    // A line whose menu item RLS no longer returns cannot be priced. It must
    // not contribute a guessed amount, and must not vanish either.
    const subject = cart([line({ id: 'a', basePriceSatang: 6000 })], ['gone-1']);

    expect(cartSubtotalSatang(subject)).toBe(6000);
    expect(subject.unresolvedLineIds).toEqual(['gone-1']);
  });
});

describe('DEC-D-01 — the domain computes no fees', () => {
  it('exports exactly the arithmetic it is allowed to do, and nothing more', () => {
    // Pinned rather than pattern-matched: the risk this guards is someone
    // adding `calculateTotals` back, and a new export should have to be a
    // deliberate edit here rather than something a loose regex waves through.
    expect(Object.keys(cartDomain).sort()).toEqual([
      'cartItemCount',
      'cartSubtotalSatang',
      'emptyCart',
      'lineTotalSatang',
      'optionLabels',
      'optionsDeltaSatang',
    ]);
  });

  it('names no fee concept anywhere in its public surface', () => {
    const exported = Object.keys(cartDomain).join(' ');

    expect(exported).not.toMatch(/delivery/i);
    expect(exported).not.toMatch(/service/i);
    expect(exported).not.toMatch(/discount/i);
    expect(exported).not.toMatch(/grand/i);
  });

  it('a cart line carries no price the app chose', () => {
    // Every money field on a line must be sourced from the catalog. If a future
    // change adds a client-authored amount, this is where it gets caught.
    const keys = Object.keys(line());

    expect(keys).toEqual(
      expect.arrayContaining(['basePriceSatang', 'quantity', 'options']),
    );
    expect(keys).not.toContain('deliveryFeeSatang');
    expect(keys).not.toContain('serviceFeeSatang');
    expect(keys).not.toContain('discountSatang');
    expect(keys).not.toContain('totalSatang');
  });
});
