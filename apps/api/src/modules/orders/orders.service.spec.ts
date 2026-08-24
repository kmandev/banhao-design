import { OrdersService } from './orders.service';
import { DomainError } from '../../common/errors/domain-error';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { CartService, CartValidationResult } from '../cart/cart.service';
import type { AddressesService, Address } from '../users/addresses.service';
import type { OrderPricingService } from './order-pricing.service';
import type { AuthenticatedUser } from '../../common/types';

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

// ===========================================================================
// State transitions — Phase E-4.1
// ===========================================================================

type Result = { data: unknown; error: { message: string } | null };

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update';
  eq: Record<string, unknown>;
  in: Record<string, unknown[]>;
  payload?: Record<string, unknown>;
}

/**
 * Same shape as `AddressesService`'s own test stub (`addresses.service.spec.ts`):
 * a fake `supabase.admin.from()` that records every filter a statement was
 * built with, so a test can assert the guard is actually IN the query — the
 * WHERE clause — not merely checked afterward in application code.
 */
function ordersTableStub(results: Result[]) {
  const calls: Recorded[] = [];
  let index = 0;

  const nextResult = (): Result => results[index++] ?? { data: null, error: null };

  const admin = {
    from(table: string) {
      const call: Recorded = { table, op: 'select', eq: {}, in: {} };
      calls.push(call);

      const builder: Record<string, unknown> = {
        select: () => builder,
        insert(payload: Record<string, unknown>) {
          call.op = 'insert';
          call.payload = payload;
          return builder;
        },
        update(payload: Record<string, unknown>) {
          call.op = 'update';
          call.payload = payload;
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
        maybeSingle: () => Promise.resolve(nextResult()),
        // An insert with no .select() (writeHistory) is awaited directly.
        then: (resolve: (r: Result) => unknown) => Promise.resolve(nextResult()).then(resolve),
      };

      return builder;
    },
  };

  return { supabase: { admin } as unknown as SupabaseService, calls };
}

function buildTransitionService(results: Result[]) {
  const { supabase, calls } = ordersTableStub(results);
  const cart = {} as unknown as CartService;
  const addresses = {} as unknown as AddressesService;
  const pricing = {} as unknown as OrderPricingService;
  const subject = new OrdersService(supabase, cart, addresses, pricing);
  return { subject, calls };
}

const ORDER_ID = 'order-1';
const RESTAURANT_A = 'restaurant-a';
const RESTAURANT_B = 'restaurant-b';

function merchantUser(...restaurantIds: string[]): AuthenticatedUser {
  return {
    id: 'merchant-user-1',
    phone: null,
    capabilities: {
      customer: true,
      merchant: restaurantIds.map((restaurantId) => ({ restaurantId, memberRole: 'STAFF' as const })),
      rider: null,
      platformStaff: null,
    },
  };
}

function riderUser(): AuthenticatedUser {
  return {
    id: 'rider-user-1',
    phone: null,
    capabilities: { customer: true, merchant: [], rider: { riderId: 'rider-1' }, platformStaff: null },
  };
}

function customerUser(id = 'customer-1'): AuthenticatedUser {
  return { id, phone: null, capabilities: { customer: true, merchant: [], rider: null, platformStaff: null } };
}

function operatorUser(): AuthenticatedUser {
  return {
    id: 'operator-1',
    phone: null,
    capabilities: {
      customer: true,
      merchant: [],
      rider: null,
      platformStaff: { staffRole: 'OPERATOR' },
    },
  };
}

/** The updated-row shape every guarded UPDATE `.select()`s back. */
function updatedRow(state: string, restaurantId = RESTAURANT_A) {
  return { data: { id: ORDER_ID, restaurant_id: restaurantId, state }, error: null };
}

describe('OrdersService — merchant transitions', () => {
  it.each([
    ['acceptOrder', 'PAID', 'MERCHANT_ACCEPTED', 'accepted_at'],
    ['startPreparing', 'MERCHANT_ACCEPTED', 'PREPARING', null],
    ['markReady', 'PREPARING', 'READY_FOR_PICKUP', 'ready_at'],
  ] as const)('%s succeeds from %s and writes state + history', async (method, from, to, timestampCol) => {
    const { subject, calls } = buildTransitionService([updatedRow(to), { data: null, error: null }]);

    const result = await (subject[method] as (u: AuthenticatedUser, id: string) => Promise<unknown>)(
      merchantUser(RESTAURANT_A),
      ORDER_ID,
    );

    expect(result).toEqual({ orderId: ORDER_ID, state: to });

    const updateCall = calls.find((c) => c.table === 'orders' && c.op === 'update');
    expect(updateCall?.payload).toMatchObject({ state: to });
    if (timestampCol) expect(updateCall?.payload).toHaveProperty(timestampCol);
    expect(updateCall?.eq).toMatchObject({ id: ORDER_ID, state: from });
    expect(updateCall?.in).toMatchObject({ restaurant_id: [RESTAURANT_A] });

    const historyCall = calls.find((c) => c.table === 'order_status_history');
    expect(historyCall?.payload).toMatchObject({
      order_id: ORDER_ID,
      from_state: from,
      to_state: to,
      actor_type: 'MERCHANT',
      actor_id: merchantUser(RESTAURANT_A).id,
    });
  });

  it('rejects a merchant with no restaurant membership at all — NOT_RESTAURANT_MEMBER, no query issued', async () => {
    const { subject, calls } = buildTransitionService([]);

    await expect(subject.acceptOrder(merchantUser(), ORDER_ID)).rejects.toMatchObject({
      code: 'NOT_RESTAURANT_MEMBER',
    });
    expect(calls).toHaveLength(0);
  });

  it('rejects a merchant acting on an order belonging to a different restaurant — NOT_RESTAURANT_MEMBER', async () => {
    const { subject } = buildTransitionService([
      { data: null, error: null }, // guarded UPDATE finds 0 rows (restaurant_id not in [RESTAURANT_B])
      { data: { id: ORDER_ID, restaurant_id: RESTAURANT_A, state: 'PAID' }, error: null }, // diagnostic read
    ]);

    await expect(subject.acceptOrder(merchantUser(RESTAURANT_B), ORDER_ID)).rejects.toMatchObject({
      code: 'NOT_RESTAURANT_MEMBER',
    });
  });

  it('rejects an accept when the order is not currently PAID — INVALID_TRANSITION', async () => {
    const { subject } = buildTransitionService([
      { data: null, error: null }, // guarded UPDATE finds 0 rows (state != PAID)
      { data: { id: ORDER_ID, restaurant_id: RESTAURANT_A, state: 'CREATED' }, error: null },
    ]);

    await expect(subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      details: { currentState: 'CREATED' },
    });
  });

  it('reports NOT_FOUND when the order does not exist at all', async () => {
    const { subject } = buildTransitionService([
      { data: null, error: null },
      { data: null, error: null }, // diagnostic read also finds nothing
    ]);

    await expect(subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('never writes order_status_history for a failed transition', async () => {
    const { subject, calls } = buildTransitionService([
      { data: null, error: null },
      { data: { id: ORDER_ID, restaurant_id: RESTAURANT_A, state: 'CREATED' }, error: null },
    ]);

    await expect(subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID)).rejects.toThrow();
    expect(calls.find((c) => c.table === 'order_status_history')).toBeUndefined();
  });

  it('does not touch money columns on a successful transition', async () => {
    const { subject, calls } = buildTransitionService([updatedRow('MERCHANT_ACCEPTED'), { data: null, error: null }]);

    await subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID);

    const updateCall = calls.find((c) => c.table === 'orders' && c.op === 'update');
    for (const field of ['subtotal_satang', 'delivery_fee_satang', 'service_fee_satang', 'grand_total_satang']) {
      expect(updateCall?.payload).not.toHaveProperty(field);
    }
  });
});

describe('OrdersService — rider transitions', () => {
  it.each([
    ['pickupOrder', 'READY_FOR_PICKUP', 'PICKED_UP', 'picked_up_at'],
    ['startDelivery', 'PICKED_UP', 'DELIVERING', null],
    ['completeDelivery', 'DELIVERING', 'DELIVERED', 'delivered_at'],
  ] as const)('%s succeeds from %s and writes state + history', async (method, from, to, timestampCol) => {
    const { subject, calls } = buildTransitionService([updatedRow(to), { data: null, error: null }]);

    const result = await (subject[method] as (u: AuthenticatedUser, id: string) => Promise<unknown>)(
      riderUser(),
      ORDER_ID,
    );

    expect(result).toEqual({ orderId: ORDER_ID, state: to });

    const updateCall = calls.find((c) => c.table === 'orders' && c.op === 'update');
    expect(updateCall?.payload).toMatchObject({ state: to });
    if (timestampCol) expect(updateCall?.payload).toHaveProperty(timestampCol);
    expect(updateCall?.eq).toMatchObject({ id: ORDER_ID, state: from });
    // No restaurant scoping for a rider transition — this task explicitly
    // excludes delivery-domain rider-assignment validation (Phase G).
    expect(updateCall?.in).toEqual({});

    const historyCall = calls.find((c) => c.table === 'order_status_history');
    expect(historyCall?.payload).toMatchObject({ actor_type: 'RIDER', actor_id: riderUser().id, to_state: to });
  });

  it('rejects pickup when the order is not READY_FOR_PICKUP — INVALID_TRANSITION', async () => {
    const { subject } = buildTransitionService([
      { data: null, error: null },
      { data: { id: ORDER_ID, restaurant_id: RESTAURANT_A, state: 'PREPARING' }, error: null },
    ]);

    await expect(subject.pickupOrder(riderUser(), ORDER_ID)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      details: { currentState: 'PREPARING' },
    });
  });

  it('reports NOT_FOUND for a nonexistent order', async () => {
    const { subject } = buildTransitionService([
      { data: null, error: null },
      { data: null, error: null },
    ]);

    await expect(subject.pickupOrder(riderUser(), ORDER_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('OrdersService — terminal-state protection', () => {
  it.each(['acceptOrder', 'startPreparing', 'markReady'] as const)(
    '%s rejects an already-DELIVERED order — INVALID_TRANSITION, never treated as a valid start state',
    async (method) => {
      const { subject } = buildTransitionService([
        { data: null, error: null },
        { data: { id: ORDER_ID, restaurant_id: RESTAURANT_A, state: 'DELIVERED' }, error: null },
      ]);

      await expect(
        (subject[method] as (u: AuthenticatedUser, id: string) => Promise<unknown>)(
          merchantUser(RESTAURANT_A),
          ORDER_ID,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    },
  );

  it.each(['pickupOrder', 'startDelivery', 'completeDelivery'] as const)(
    '%s rejects an already-CANCELLED order',
    async (method) => {
      const { subject } = buildTransitionService([
        { data: null, error: null },
        { data: { id: ORDER_ID, restaurant_id: RESTAURANT_A, state: 'CANCELLED' }, error: null },
      ]);

      await expect(
        (subject[method] as (u: AuthenticatedUser, id: string) => Promise<unknown>)(riderUser(), ORDER_ID),
      ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    },
  );
});

describe('OrdersService.cancelOrder — customer', () => {
  it('cancels a CREATED order the customer owns, writes history with the reason', async () => {
    const { subject, calls } = buildTransitionService([updatedRow('CANCELLED'), { data: null, error: null }]);

    const result = await subject.cancelOrder(customerUser('customer-1'), ORDER_ID, 'เปลี่ยนใจ');

    expect(result).toEqual({ orderId: ORDER_ID, state: 'CANCELLED' });

    const updateCall = calls.find((c) => c.table === 'orders' && c.op === 'update');
    expect(updateCall?.eq).toMatchObject({ id: ORDER_ID, customer_id: 'customer-1' });
    expect(updateCall?.payload).toHaveProperty('cancelled_at');
    expect(updateCall?.in.state).toEqual(['CREATED', 'PENDING_PAYMENT', 'PAID']);

    const historyCall = calls.find((c) => c.table === 'order_status_history');
    expect(historyCall?.payload).toMatchObject({
      to_state: 'CANCELLED',
      actor_type: 'CUSTOMER',
      actor_id: 'customer-1',
      reason: 'เปลี่ยนใจ',
    });
  });

  it('rejects cancelling an order already MERCHANT_ACCEPTED — free window has closed', async () => {
    const { subject } = buildTransitionService([{ data: null, error: null }]);

    await expect(
      subject.cancelOrder(customerUser('customer-1'), ORDER_ID, undefined),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reports NOT_FOUND (never a different code) for another customer\'s order — no existence leak', async () => {
    const { subject } = buildTransitionService([{ data: null, error: null }]);

    await expect(
      subject.cancelOrder(customerUser('someone-else'), ORDER_ID, undefined),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('never runs a diagnostic read for a customer cancellation failure — ownership stays a query filter only', async () => {
    const { subject, calls } = buildTransitionService([{ data: null, error: null }]);

    await expect(subject.cancelOrder(customerUser(), ORDER_ID, undefined)).rejects.toThrow();
    // Exactly one call: the guarded UPDATE attempt. No second SELECT that
    // could distinguish "wrong state" from "not yours" from "doesn't exist".
    expect(calls).toHaveLength(1);
  });
});

describe('OrdersService.cancelOrder — operator', () => {
  it('cancels a PREPARING order regardless of ownership, with a cause reason', async () => {
    const { subject, calls } = buildTransitionService([updatedRow('CANCELLED'), { data: null, error: null }]);

    const result = await subject.cancelOrder(operatorUser(), ORDER_ID, 'no rider available');

    expect(result).toEqual({ orderId: ORDER_ID, state: 'CANCELLED' });

    const updateCall = calls.find((c) => c.table === 'orders' && c.op === 'update');
    expect(updateCall?.eq).toMatchObject({ id: ORDER_ID });
    expect(updateCall?.eq).not.toHaveProperty('customer_id');
    expect(updateCall?.in.state).toEqual([
      'CREATED',
      'PENDING_PAYMENT',
      'PAID',
      'MERCHANT_ACCEPTED',
      'PREPARING',
      'READY_FOR_PICKUP',
      'PICKED_UP',
      'DELIVERING',
    ]);

    const historyCall = calls.find((c) => c.table === 'order_status_history');
    expect(historyCall?.payload).toMatchObject({ actor_type: 'OPERATOR', reason: 'no rider available' });
  });

  it('rejects cancelling an already-DELIVERED order — terminal', async () => {
    const { subject } = buildTransitionService([
      { data: null, error: null },
      { data: { id: ORDER_ID, restaurant_id: RESTAURANT_A, state: 'DELIVERED' }, error: null },
    ]);

    await expect(subject.cancelOrder(operatorUser(), ORDER_ID, 'x')).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });

  it('reports NOT_FOUND for a nonexistent order', async () => {
    const { subject } = buildTransitionService([
      { data: null, error: null },
      { data: null, error: null },
    ]);

    await expect(subject.cancelOrder(operatorUser(), ORDER_ID, 'x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('OrdersService — atomic guarded update (no SELECT-then-UPDATE)', () => {
  it('a stale-state race is rejected: the guarded UPDATE alone decides, not a prior read', async () => {
    // Simulates another actor having already moved the order between this
    // caller's own (nonexistent) prior read and its transition attempt: the
    // guarded UPDATE itself finds 0 matching rows because `state` no longer
    // equals the expected `PAID`.
    const { subject } = buildTransitionService([
      { data: null, error: null },
      { data: { id: ORDER_ID, restaurant_id: RESTAURANT_A, state: 'MERCHANT_ACCEPTED' }, error: null },
    ]);

    await expect(subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      details: { currentState: 'MERCHANT_ACCEPTED' },
    });
  });

  it('a database error on the guarded UPDATE itself maps to INTERNAL_ERROR, not a silent success', async () => {
    const { subject } = buildTransitionService([{ data: null, error: { message: 'connection reset' } }]);

    await expect(subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });
});
