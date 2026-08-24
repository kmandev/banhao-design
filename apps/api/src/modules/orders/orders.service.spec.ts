import { OrdersService } from './orders.service';
import { DomainError } from '../../common/errors/domain-error';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { CartService, CartValidationResult } from '../cart/cart.service';
import type { AddressesService, Address } from '../users/addresses.service';
import type { OrderPricingService } from './order-pricing.service';

/**
 * Phase E-2 — `OrdersService.create`.
 *
 * `CartService`, `AddressesService` and `OrderPricingService` are plain
 * jest.fn() stubs, exactly as `cart.controller.spec.ts` stubs `CartService`
 * itself — their own business logic is covered by their own spec files.
 * What this file proves is the orchestration: which server-derived values
 * reach `create_order`, that nothing from the request body does, that every
 * upstream rejection propagates rather than being swallowed, and that a
 * `create_order` failure maps to the right catalogue code.
 */

const CUSTOMER_ID = 'customer-1';
const ADDRESS_ID = 'address-1';
const RESTAURANT_ID = 'restaurant-1';

const VALID_CART: CartValidationResult = {
  cartId: 'cart-1',
  restaurantId: RESTAURANT_ID,
  subtotalSatang: 12000,
  lines: [
    { cartItemId: 'ci-1', menuItemId: 'mi-1', quantity: 2, unitPriceSatang: 6000, lineSubtotalSatang: 12000 },
  ],
};

const OWNED_ADDRESS: Address = {
  id: ADDRESS_ID,
  label: null,
  recipientName: 'ลูกค้า ทดสอบ',
  recipientPhone: '+66811111111',
  addressLine: 'ที่อยู่ทดสอบ',
  landmark: null,
  instructions: null,
  lat: null,
  lng: null,
  isDefault: true,
  createdAt: '2026-08-19T00:00:00Z',
  updatedAt: '2026-08-19T00:00:00Z',
};

const FEES = { deliveryFeeSatang: 1500, serviceFeeSatang: 500 };

function buildService(options?: {
  cartResult?: CartValidationResult | (() => Promise<CartValidationResult>);
  addressResult?: Address | null;
  fees?: typeof FEES | (() => typeof FEES);
  rpcResult?: { data: unknown; error: { message: string } | null };
}) {
  const cartValidate = jest.fn().mockImplementation(async () => {
    const result = options?.cartResult ?? VALID_CART;
    return typeof result === 'function' ? result() : result;
  });
  const addressesGetOwned = jest.fn().mockResolvedValue(
    options?.addressResult === undefined ? OWNED_ADDRESS : options.addressResult,
  );
  const pricingResolve = jest.fn().mockImplementation(() => {
    const fees = options?.fees ?? FEES;
    return typeof fees === 'function' ? fees() : fees;
  });
  const rpc = jest.fn().mockResolvedValue(
    options?.rpcResult ?? {
      data: [{ order_id: 'order-1', order_number: 'BH-20260819-0001', state: 'CREATED' }],
      error: null,
    },
  );
  const fromSpy = jest.fn();

  const supabase = { admin: { rpc, from: fromSpy } } as unknown as SupabaseService;
  const cart = { validate: cartValidate } as unknown as CartService;
  const addresses = { getOwned: addressesGetOwned } as unknown as AddressesService;
  const pricing = { resolveOrderFees: pricingResolve } as unknown as OrderPricingService;

  const subject = new OrdersService(supabase, cart, addresses, pricing);

  return { subject, cartValidate, addressesGetOwned, pricingResolve, rpc, fromSpy };
}

describe('OrdersService.create — cart', () => {
  it('rejects an empty cart (no cart at all) with CART_EMPTY', async () => {
    const { subject } = buildService({
      cartResult: { cartId: null, restaurantId: null, subtotalSatang: 0, lines: [] },
    });

    await expect(
      subject.create(CUSTOMER_ID, { addressId: ADDRESS_ID, paymentMethod: 'ONLINE' }),
    ).rejects.toMatchObject({ code: 'CART_EMPTY' });
  });

  it('rejects an empty cart (cart exists, zero lines) with CART_EMPTY', async () => {
    const { subject } = buildService({
      cartResult: { cartId: 'cart-1', restaurantId: RESTAURANT_ID, subtotalSatang: 0, lines: [] },
    });

    await expect(
      subject.create(CUSTOMER_ID, { addressId: ADDRESS_ID, paymentMethod: 'ONLINE' }),
    ).rejects.toMatchObject({ code: 'CART_EMPTY' });
  });

  it('propagates ITEM_UNAVAILABLE from CartService.validate unchanged', async () => {
    const { subject } = buildService({
      cartResult: () => {
        throw new DomainError('ITEM_UNAVAILABLE', { details: { items: [{ cartItemId: 'ci-1' }] } });
      },
    });

    await expect(
      subject.create(CUSTOMER_ID, { addressId: ADDRESS_ID, paymentMethod: 'ONLINE' }),
    ).rejects.toMatchObject({ code: 'ITEM_UNAVAILABLE' });
  });

  it('propagates PRICE_CHANGED from CartService.validate unchanged — a stale price is rejected', async () => {
    const { subject } = buildService({
      cartResult: () => {
        throw new DomainError('PRICE_CHANGED', {
          details: { lines: [{ cartItemId: 'ci-1', expectedSatang: 5000, currentSatang: 6000 }] },
        });
      },
    });

    await expect(
      subject.create(CUSTOMER_ID, {
        addressId: ADDRESS_ID,
        paymentMethod: 'ONLINE',
        expectedLines: [{ cartItemId: 'ci-1', expectedUnitPriceSatang: 5000 }],
      }),
    ).rejects.toMatchObject({ code: 'PRICE_CHANGED' });
  });

  it('passes expectedLines through to CartService.validate unchanged', async () => {
    const { subject, cartValidate } = buildService();
    const expectedLines = [{ cartItemId: 'ci-1', expectedUnitPriceSatang: 6000 }];

    await subject.create(CUSTOMER_ID, { addressId: ADDRESS_ID, paymentMethod: 'ONLINE', expectedLines });

    expect(cartValidate).toHaveBeenCalledWith(CUSTOMER_ID, { expectedLines });
  });

  it('never calls create_order when the cart is rejected — no partial write', async () => {
    const { subject, rpc } = buildService({
      cartResult: { cartId: null, restaurantId: null, subtotalSatang: 0, lines: [] },
    });

    await expect(
      subject.create(CUSTOMER_ID, { addressId: ADDRESS_ID, paymentMethod: 'ONLINE' }),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('OrdersService.create — address', () => {
  it('rejects with NOT_FOUND when the address does not belong to (or exist for) this customer', async () => {
    const { subject, addressesGetOwned } = buildService({ addressResult: null });

    await expect(
      subject.create(CUSTOMER_ID, { addressId: ADDRESS_ID, paymentMethod: 'ONLINE' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(addressesGetOwned).toHaveBeenCalledWith(CUSTOMER_ID, ADDRESS_ID);
  });

  it('never calls create_order when the address is rejected', async () => {
    const { subject, rpc } = buildService({ addressResult: null });

    await expect(
      subject.create(CUSTOMER_ID, { addressId: ADDRESS_ID, paymentMethod: 'ONLINE' }),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('OrdersService.create — fees (DEC-E-01)', () => {
  it('propagates a DomainError from OrderPricingService.resolveOrderFees unchanged, whatever it throws', async () => {
    const { subject, rpc } = buildService({
      fees: () => {
        throw new DomainError('NOT_IMPLEMENTED');
      },
    });

    await expect(
      subject.create(CUSTOMER_ID, { addressId: ADDRESS_ID, paymentMethod: 'ONLINE' }),
    ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('resolves fees only after cart and address both passed', async () => {
    const { subject, pricingResolve } = buildService();

    await subject.create(CUSTOMER_ID, { addressId: ADDRESS_ID, paymentMethod: 'ONLINE' });

    expect(pricingResolve).toHaveBeenCalledWith(RESTAURANT_ID, VALID_CART.subtotalSatang);
  });
});

describe('OrdersService.create — create_order call contract', () => {
  it('calls create_order with exactly the server-derived values, nothing client-controlled', async () => {
    const { subject, rpc } = buildService();

    await subject.create(CUSTOMER_ID, {
      addressId: ADDRESS_ID,
      paymentMethod: 'ONLINE',
      // A client cannot actually reach this shape past the Zod schema
      // (order.spec.ts proves that) — this cast simulates a hypothetical
      // caller who bypassed validation, to prove the SERVICE itself also
      // never reads these fields, not merely that the schema blocks them.
      ...({
        customerId: 'someone-else',
        restaurantId: 'a-different-restaurant',
        orderNumber: 'BH-20200101-9999',
        subtotalSatang: 1,
        deliveryFeeSatang: 1,
        serviceFeeSatang: 1,
        grandTotalSatang: 1,
      } as Record<string, unknown>),
    });

    expect(rpc).toHaveBeenCalledWith('create_order', {
      p_customer_id: CUSTOMER_ID,
      p_address_id: ADDRESS_ID,
      p_payment_method: 'ONLINE',
      p_delivery_fee_satang: FEES.deliveryFeeSatang,
      p_service_fee_satang: FEES.serviceFeeSatang,
      p_correlation_id: null,
    });
  });

  it('never writes through supabase.admin.from — create_order is the only write path', async () => {
    const { subject, fromSpy } = buildService();

    await subject.create(CUSTOMER_ID, { addressId: ADDRESS_ID, paymentMethod: 'ONLINE' });

    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('maps a successful create_order row to orderId/orderNumber/state', async () => {
    const { subject } = buildService({
      rpcResult: {
        data: [{ order_id: 'order-42', order_number: 'BH-20260819-0042', state: 'CREATED' }],
        error: null,
      },
    });

    const result = await subject.create(CUSTOMER_ID, { addressId: ADDRESS_ID, paymentMethod: 'ONLINE' });

    expect(result).toEqual({ orderId: 'order-42', orderNumber: 'BH-20260819-0042', state: 'CREATED' });
  });
});

describe('OrdersService.create — create_order failure mapping', () => {
  it.each([
    ['create_order: cart c1 is empty', 'CART_EMPTY'],
    ['create_order: customer x has no open cart', 'CART_EMPTY'],
    ['create_order: unavailable items in cart: ของหมด', 'ITEM_UNAVAILABLE'],
    ['create_order: restaurant r1 is not ACTIVE', 'RESTAURANT_CLOSED'],
    ['create_order: address a1 is not a usable address for customer c1', 'NOT_FOUND'],
    ['connection reset', 'INTERNAL_ERROR'],
  ])('maps %j to %s', async (message, code) => {
    const { subject } = buildService({ rpcResult: { data: null, error: { message } } });

    await expect(
      subject.create(CUSTOMER_ID, { addressId: ADDRESS_ID, paymentMethod: 'ONLINE' }),
    ).rejects.toMatchObject({ code });
  });

  it('never exposes the raw Postgres error message to the caller', async () => {
    const { subject } = buildService({
      rpcResult: { data: null, error: { message: 'raw postgres internals: relation orders' } },
    });

    try {
      await subject.create(CUSTOMER_ID, { addressId: ADDRESS_ID, paymentMethod: 'ONLINE' });
      fail('expected create to throw');
    } catch (cause) {
      expect((cause as DomainError).message).not.toContain('relation orders');
    }
  });

  it('raises INTERNAL_ERROR when create_order returns no row at all', async () => {
    const { subject } = buildService({ rpcResult: { data: [], error: null } });

    await expect(
      subject.create(CUSTOMER_ID, { addressId: ADDRESS_ID, paymentMethod: 'ONLINE' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
