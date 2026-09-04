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

/**
 * `.from()` after `create_order()` succeeds — the OrderCreated outbox write
 * (H-3), which reads `restaurants`/`merchants` to resolve the MERCHANT
 * recipient and inserts into `outbox`. Same chainable-stub shape as
 * `ordersTableStub` below: every call it does not have a queued result for
 * degrades to `{ data: null, error: null }` (a harmless "not found"/no-op),
 * never a crash — `resolveMerchantOwnerId` and `writeOutboxEvent` are both
 * written to tolerate exactly that.
 */
function outboxAwareFromStub(results: Result[] = []) {
  const calls: Recorded[] = [];
  let index = 0;

  const nextResult = (): Result => results[index++] ?? { data: null, error: null };

  const from = jest.fn((table: string) => {
    const call: Recorded = { table, op: 'select', eq: {}, in: {} };
    calls.push(call);

    const builder: Record<string, unknown> = {
      select: () => builder,
      insert(payload: Record<string, unknown>) {
        call.op = 'insert';
        call.payload = payload;
        return builder;
      },
      eq(column: string, value: unknown) {
        call.eq[column] = value;
        return builder;
      },
      maybeSingle: () => Promise.resolve(nextResult()),
      then: (resolve: (r: Result) => unknown) => Promise.resolve(nextResult()).then(resolve),
    };

    return builder;
  });

  return { from, calls };
}

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
  const { from: fromSpy, calls: fromCalls } = outboxAwareFromStub();

  const supabase = { admin: { rpc, from: fromSpy } } as unknown as SupabaseService;
  const cart = { validate: cartValidate } as unknown as CartService;
  const addresses = { getOwned: addressesGetOwned } as unknown as AddressesService;
  const pricing = { resolveOrderFees: pricingResolve } as unknown as OrderPricingService;

  const subject = new OrdersService(supabase, cart, addresses, pricing);

  return { subject, cartValidate, addressesGetOwned, pricingResolve, rpc, fromSpy, fromCalls };
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

  it('never writes order data through supabase.admin.from — create_order is the only write path for the order itself; H-3 adds only the OrderCreated outbox follow-up', async () => {
    const { subject, fromCalls } = buildService();

    await subject.create(CUSTOMER_ID, { addressId: ADDRESS_ID, paymentMethod: 'ONLINE' });

    // No order/order_items/order_item_options write ever happens outside the
    // atomic create_order() RPC — that invariant is unchanged. `.from()` is
    // now called, but only for H-3's best-effort OrderCreated notification
    // follow-up (restaurants/merchants read, outbox insert), never for order
    // data itself.
    for (const table of ['orders', 'order_items', 'order_item_options']) {
      expect(fromCalls.some((c) => c.table === table)).toBe(false);
    }
    // The stub's `restaurants` read defaults to "not found", so
    // `resolveMerchantOwnerId` short-circuits before ever reaching
    // `merchants` — the outbox row still writes, with only CUSTOMER
    // resolved.
    expect(fromCalls.map((c) => c.table).sort()).toEqual(['outbox', 'restaurants']);
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
    ['create_order: restaurant r1 is PAUSED and not accepting new orders', 'RESTAURANT_CLOSED'],
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

type Result = { data: unknown; error: { message: string; code?: string } | null };

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
/** M-05: `accept` is the one merchant command that carries a body, and `prepMinutes` is required. */
const ACCEPT_INPUT = { prepMinutes: 20 } as const;
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

    const result = await (
      subject[method] as (u: AuthenticatedUser, id: string, input?: unknown) => Promise<unknown>
    )(merchantUser(RESTAURANT_A), ORDER_ID, ACCEPT_INPUT);

    expect(result).toEqual({ orderId: ORDER_ID, state: to });

    const updateCall = calls.find((c) => c.table === 'orders' && c.op === 'update');
    expect(updateCall?.payload).toMatchObject({ state: to });
    if (timestampCol) expect(updateCall?.payload).toHaveProperty(timestampCol);
    // M-05: only `accept` carries a prep time. `start-preparing` and
    // `mark-ready` ask no question, so they must not acquire one merely
    // because the same private helper writes all three.
    if (method === 'acceptOrder') {
      expect(updateCall?.payload).toMatchObject({ prep_minutes: 20 });
    } else {
      expect(updateCall?.payload).not.toHaveProperty('prep_minutes');
    }
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

    await expect(subject.acceptOrder(merchantUser(), ORDER_ID, ACCEPT_INPUT)).rejects.toMatchObject({
      code: 'NOT_RESTAURANT_MEMBER',
    });
    expect(calls).toHaveLength(0);
  });

  it('rejects a merchant acting on an order belonging to a different restaurant — NOT_RESTAURANT_MEMBER', async () => {
    const { subject } = buildTransitionService([
      { data: null, error: null }, // guarded UPDATE finds 0 rows (restaurant_id not in [RESTAURANT_B])
      { data: { id: ORDER_ID, restaurant_id: RESTAURANT_A, state: 'PAID' }, error: null }, // diagnostic read
    ]);

    await expect(subject.acceptOrder(merchantUser(RESTAURANT_B), ORDER_ID, ACCEPT_INPUT)).rejects.toMatchObject({
      code: 'NOT_RESTAURANT_MEMBER',
    });
  });

  it('rejects an accept when the order is not currently PAID — INVALID_TRANSITION', async () => {
    const { subject } = buildTransitionService([
      { data: null, error: null }, // guarded UPDATE finds 0 rows (state != PAID)
      { data: { id: ORDER_ID, restaurant_id: RESTAURANT_A, state: 'CREATED' }, error: null },
    ]);

    await expect(subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, ACCEPT_INPUT)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      details: { currentState: 'CREATED' },
    });
  });

  it('reports NOT_FOUND when the order does not exist at all', async () => {
    const { subject } = buildTransitionService([
      { data: null, error: null },
      { data: null, error: null }, // diagnostic read also finds nothing
    ]);

    await expect(subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, ACCEPT_INPUT)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('never writes order_status_history for a failed transition', async () => {
    const { subject, calls } = buildTransitionService([
      { data: null, error: null },
      { data: { id: ORDER_ID, restaurant_id: RESTAURANT_A, state: 'CREATED' }, error: null },
    ]);

    await expect(subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, ACCEPT_INPUT)).rejects.toThrow();
    expect(calls.find((c) => c.table === 'order_status_history')).toBeUndefined();
  });

  // -------------------------------------------------------------------
  // M-05 — prep time, written by the same guarded UPDATE that moves the
  // state. `prep_minutes` is data about the transition, so it must never
  // exist on an order this call did not actually accept.
  // -------------------------------------------------------------------

  it('M-05: persists prep_minutes in the same guarded UPDATE as the state', async () => {
    const { subject, calls } = buildTransitionService([updatedRow('MERCHANT_ACCEPTED'), { data: null, error: null }]);

    await subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, { prepMinutes: 45 });

    const orderUpdates = calls.filter((c) => c.table === 'orders' && c.op === 'update');
    // One statement, not two — never a follow-up "set the prep time" write.
    expect(orderUpdates).toHaveLength(1);
    expect(orderUpdates[0]?.payload).toMatchObject({ state: 'MERCHANT_ACCEPTED', prep_minutes: 45 });
    // ...and that one statement is still the guarded one (ADR-003, M05-C04).
    expect(orderUpdates[0]?.eq).toMatchObject({ id: ORDER_ID, state: 'PAID' });
    expect(orderUpdates[0]?.in).toMatchObject({ restaurant_id: [RESTAURANT_A] });
  });

  it('M-05: the prep time cannot overwrite the guard — state and ownership stay the WHERE clause', async () => {
    const { subject, calls } = buildTransitionService([updatedRow('MERCHANT_ACCEPTED'), { data: null, error: null }]);

    await subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, { prepMinutes: 10 });

    const updateCall = calls.find((c) => c.table === 'orders' && c.op === 'update');
    expect(updateCall?.payload).toMatchObject({ state: 'MERCHANT_ACCEPTED' });
    expect(updateCall?.payload).not.toHaveProperty('restaurant_id');
    expect(updateCall?.payload).not.toHaveProperty('customer_id');
  });

  it('M-05: a non-PAID order receives no prep time — the guard matched 0 rows, so nothing was written', async () => {
    const { subject, calls } = buildTransitionService([
      { data: null, error: null }, // guarded UPDATE finds 0 rows (state != PAID)
      { data: { id: ORDER_ID, restaurant_id: RESTAURANT_A, state: 'PREPARING' }, error: null },
    ]);

    await expect(
      subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, { prepMinutes: 60 }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

    // The statement was issued and matched nothing — that is the guard doing
    // its job. What must never happen is a second, unguarded write that lands
    // the prep time anyway.
    const orderUpdates = calls.filter((c) => c.table === 'orders' && c.op === 'update');
    expect(orderUpdates).toHaveLength(1);
    expect(orderUpdates[0]?.eq).toMatchObject({ state: 'PAID' });
  });

  it('M-05: a wrong-restaurant accept writes no prep time', async () => {
    const { subject, calls } = buildTransitionService([
      { data: null, error: null },
      { data: { id: ORDER_ID, restaurant_id: RESTAURANT_A, state: 'PAID' }, error: null },
    ]);

    await expect(
      subject.acceptOrder(merchantUser(RESTAURANT_B), ORDER_ID, { prepMinutes: 30 }),
    ).rejects.toMatchObject({ code: 'NOT_RESTAURANT_MEMBER' });

    const orderUpdates = calls.filter((c) => c.table === 'orders' && c.op === 'update');
    expect(orderUpdates).toHaveLength(1);
    expect(orderUpdates[0]?.in).toMatchObject({ restaurant_id: [RESTAURANT_B] });
  });

  it('M-05: a concurrent second accept is still rejected and does not re-write the prep time', async () => {
    // The loser of the race: the winner already moved the order, so this
    // caller's identical guarded UPDATE matches 0 rows.
    const { subject, calls } = buildTransitionService([
      { data: null, error: null },
      { data: { id: ORDER_ID, restaurant_id: RESTAURANT_A, state: 'MERCHANT_ACCEPTED' }, error: null },
    ]);

    await expect(
      subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, { prepMinutes: 60 }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION', details: { currentState: 'MERCHANT_ACCEPTED' } });

    expect(calls.filter((c) => c.table === 'orders' && c.op === 'update')).toHaveLength(1);
    expect(calls.find((c) => c.table === 'order_status_history')).toBeUndefined();
  });

  it('M-05: prep_minutes is never written to restaurants.avg_prep_minutes (M05-C03)', async () => {
    const { subject, calls } = buildTransitionService([updatedRow('MERCHANT_ACCEPTED'), { data: null, error: null }]);

    await subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, { prepMinutes: 20 });

    expect(calls.find((c) => c.table === 'restaurants' && c.op === 'update')).toBeUndefined();
  });

  it('M-05: does not touch quoted_eta_minutes — a prep time is not an ETA', async () => {
    const { subject, calls } = buildTransitionService([updatedRow('MERCHANT_ACCEPTED'), { data: null, error: null }]);

    await subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, { prepMinutes: 20 });

    const updateCall = calls.find((c) => c.table === 'orders' && c.op === 'update');
    expect(updateCall?.payload).not.toHaveProperty('quoted_eta_minutes');
  });

  it('does not touch money columns on a successful transition', async () => {
    const { subject, calls } = buildTransitionService([updatedRow('MERCHANT_ACCEPTED'), { data: null, error: null }]);

    await subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, ACCEPT_INPUT);

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
        (subject[method] as (u: AuthenticatedUser, id: string, input?: unknown) => Promise<unknown>)(
          merchantUser(RESTAURANT_A),
          ORDER_ID,
          ACCEPT_INPUT,
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

/**
 * Phase G foundation — `acceptOrder` also creates the order's `deliveries`
 * row (`RIDER_SEARCHING`), and repairs a missing one on retry.
 *
 * Call order for a successful accept (H-3 adds the two outbox segments):
 * guarded `orders` UPDATE → history insert → [MerchantAcceptedOrder outbox:
 * `restaurants` read → `merchants` read → `outbox` insert] → `orders` read →
 * `restaurants` read → `deliveries` insert → [RiderSearchStarted outbox:
 * `outbox` insert, only when a delivery was genuinely created].
 */
const RESTAURANT_LAT = 15.123456;
const RESTAURANT_LNG = 105.123456;
const DELIVERY_LAT = 15.222222;
const DELIVERY_LNG = 105.222222;

/** H-3 — the MerchantAcceptedOrder outbox segment that now precedes `ensureDeliveryForAcceptedOrder`'s own reads on every successful `acceptOrder` call. */
const MERCHANT_OWNER_LOOKUP = { data: { merchant_id: 'merchant-1' }, error: null };
const MERCHANT_OWNER = { data: { owner_user_id: 'merchant-owner-1' }, error: null };
const MERCHANT_ACCEPTED_OUTBOX_SEGMENT = [MERCHANT_OWNER_LOOKUP, MERCHANT_OWNER, { data: null, error: null }];

/** The `orders` row `ensureDeliveryForAcceptedOrder` reads back. */
function deliverySnapshot(state = 'MERCHANT_ACCEPTED', restaurantId = RESTAURANT_A) {
  return {
    data: {
      id: ORDER_ID,
      restaurant_id: restaurantId,
      state,
      delivery_lat: DELIVERY_LAT,
      delivery_lng: DELIVERY_LNG,
    },
    error: null,
  };
}

const RESTAURANT_PICKUP = { data: { lat: RESTAURANT_LAT, lng: RESTAURANT_LNG }, error: null };
const NO_ERROR = { data: null, error: null };

/** Every column the created delivery must carry — asserted whole, not field by field. */
const EXPECTED_DELIVERY = {
  order_id: ORDER_ID,
  state: 'RIDER_SEARCHING',
  pickup_lat: RESTAURANT_LAT,
  pickup_lng: RESTAURANT_LNG,
  dropoff_lat: DELIVERY_LAT,
  dropoff_lng: DELIVERY_LNG,
  rider_earning_satang: null,
};

describe('OrdersService.acceptOrder — delivery row creation (Phase G)', () => {
  it('1. creates exactly one RIDER_SEARCHING delivery with restaurant pickup and order-snapshot dropoff', async () => {
    const { subject, calls } = buildTransitionService([
      updatedRow('MERCHANT_ACCEPTED'),
      NO_ERROR, // order_status_history
      ...MERCHANT_ACCEPTED_OUTBOX_SEGMENT,
      deliverySnapshot(),
      RESTAURANT_PICKUP,
      NO_ERROR, // deliveries insert
      NO_ERROR, // RiderSearchStarted outbox insert
    ]);

    const result = await subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, ACCEPT_INPUT);

    expect(result).toEqual({ orderId: ORDER_ID, state: 'MERCHANT_ACCEPTED' });

    const deliveryInserts = calls.filter((c) => c.table === 'deliveries' && c.op === 'insert');
    expect(deliveryInserts).toHaveLength(1);
    expect(deliveryInserts[0]?.payload).toEqual(EXPECTED_DELIVERY);
  });

  it('5. never invents a rider earning — rider_earning_satang is explicitly null (BQ-029/DEC-023 still OPEN)', async () => {
    const { subject, calls } = buildTransitionService([
      updatedRow('MERCHANT_ACCEPTED'),
      NO_ERROR,
      ...MERCHANT_ACCEPTED_OUTBOX_SEGMENT,
      deliverySnapshot(),
      RESTAURANT_PICKUP,
      NO_ERROR,
      NO_ERROR,
    ]);

    await subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, ACCEPT_INPUT);

    const payload = calls.find((c) => c.table === 'deliveries')?.payload;
    expect(payload).toHaveProperty('rider_earning_satang');
    expect(payload?.rider_earning_satang).toBeNull();
  });

  it('reads dropoff from the order snapshot, never from the addresses table', async () => {
    const { subject, calls } = buildTransitionService([
      updatedRow('MERCHANT_ACCEPTED'),
      NO_ERROR,
      ...MERCHANT_ACCEPTED_OUTBOX_SEGMENT,
      deliverySnapshot(),
      RESTAURANT_PICKUP,
      NO_ERROR,
      NO_ERROR,
    ]);

    await subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, ACCEPT_INPUT);

    expect(calls.find((c) => c.table === 'addresses')).toBeUndefined();
    expect(calls.find((c) => c.table === 'deliveries')?.payload).toMatchObject({
      dropoff_lat: DELIVERY_LAT,
      dropoff_lng: DELIVERY_LNG,
    });
  });

  it('carries null coordinates through rather than inventing them when the restaurant has none', async () => {
    const { subject, calls } = buildTransitionService([
      updatedRow('MERCHANT_ACCEPTED'),
      NO_ERROR,
      ...MERCHANT_ACCEPTED_OUTBOX_SEGMENT,
      deliverySnapshot(),
      { data: { lat: null, lng: null }, error: null },
      NO_ERROR,
      NO_ERROR,
    ]);

    await subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, ACCEPT_INPUT);

    expect(calls.find((c) => c.table === 'deliveries')?.payload).toMatchObject({
      pickup_lat: null,
      pickup_lng: null,
    });
  });

  it('6. writes to no payment, ledger, settlement or reconciliation table', async () => {
    const { subject, calls } = buildTransitionService([
      updatedRow('MERCHANT_ACCEPTED'),
      NO_ERROR,
      ...MERCHANT_ACCEPTED_OUTBOX_SEGMENT,
      deliverySnapshot(),
      RESTAURANT_PICKUP,
      NO_ERROR,
      NO_ERROR,
    ]);

    await subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, ACCEPT_INPUT);

    for (const table of [
      'payments',
      'payment_attempts',
      'payment_events',
      'payment_transactions',
      'reconciliation_cases',
      'refunds',
      'ledger_entries',
      'ledger_entry_groups',
      'settlements',
    ]) {
      expect(calls.find((c) => c.table === table)).toBeUndefined();
    }
    // Only these tables are touched at all — H-3 adds `merchants` and
    // `outbox` (the MerchantAcceptedOrder and RiderSearchStarted
    // notification writes), never a money/ledger/settlement table.
    expect([...new Set(calls.map((c) => c.table))].sort()).toEqual([
      'deliveries',
      'merchants',
      'order_status_history',
      'orders',
      'outbox',
      'restaurants',
    ]);
  });

  it('surfaces a delivery insert failure as INTERNAL_ERROR rather than reporting a success that lost the row', async () => {
    const { subject } = buildTransitionService([
      updatedRow('MERCHANT_ACCEPTED'),
      NO_ERROR,
      ...MERCHANT_ACCEPTED_OUTBOX_SEGMENT,
      deliverySnapshot(),
      RESTAURANT_PICKUP,
      { data: null, error: { message: 'connection reset' } },
    ]);

    await expect(subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, ACCEPT_INPUT)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });
});

describe('OrdersService.acceptOrder — crash-window self-heal', () => {
  it('3. recreates a missing delivery when the order is already MERCHANT_ACCEPTED, while still reporting INVALID_TRANSITION', async () => {
    const { subject, calls } = buildTransitionService([
      NO_ERROR, // guarded UPDATE: 0 rows — the order is no longer PAID
      deliverySnapshot(), // diagnostic read -> MERCHANT_ACCEPTED
      deliverySnapshot(), // self-heal read
      RESTAURANT_PICKUP,
      NO_ERROR, // deliveries insert — the repair
    ]);

    // The transition genuinely did not happen on this call, so the caller is
    // told so — the established stale-state contract is unchanged.
    await expect(subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, ACCEPT_INPUT)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      details: { currentState: 'MERCHANT_ACCEPTED' },
    });

    // ...but the lost delivery row is repaired regardless.
    const deliveryInserts = calls.filter((c) => c.table === 'deliveries' && c.op === 'insert');
    expect(deliveryInserts).toHaveLength(1);
    expect(deliveryInserts[0]?.payload).toEqual(EXPECTED_DELIVERY);
  });

  it('2. does not create a second delivery when one already exists — the unique constraint decides, not a prior read', async () => {
    const { subject, calls } = buildTransitionService([
      NO_ERROR,
      deliverySnapshot(),
      deliverySnapshot(),
      RESTAURANT_PICKUP,
      { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } },
    ]);

    await expect(subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, ACCEPT_INPUT)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });

    // Exactly one INSERT was attempted, and its conflict was absorbed — never
    // a SELECT-before-INSERT, and never a retry that could write a second row.
    const deliveryCalls = calls.filter((c) => c.table === 'deliveries');
    expect(deliveryCalls).toHaveLength(1);
    expect(deliveryCalls[0]?.op).toBe('insert');
  });

  it('4. a concurrent accept losing the unique-constraint race still returns the winning transition, not an error', async () => {
    const { subject, calls } = buildTransitionService([
      updatedRow('MERCHANT_ACCEPTED'), // this caller won the orders transition
      NO_ERROR,
      ...MERCHANT_ACCEPTED_OUTBOX_SEGMENT,
      deliverySnapshot(),
      RESTAURANT_PICKUP,
      // ...but lost the deliveries race to a concurrent healer.
      { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } },
    ]);

    const result = await subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, ACCEPT_INPUT);

    expect(result).toEqual({ orderId: ORDER_ID, state: 'MERCHANT_ACCEPTED' });
    expect(calls.filter((c) => c.table === 'deliveries')).toHaveLength(1);
  });

  it('heals only MERCHANT_ACCEPTED — an order further along is left to Phase G, not resurrected at RIDER_SEARCHING', async () => {
    const { subject, calls } = buildTransitionService([
      NO_ERROR,
      deliverySnapshot('PREPARING'), // diagnostic read
      deliverySnapshot('PREPARING'), // self-heal read
    ]);

    await expect(subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, ACCEPT_INPUT)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      details: { currentState: 'PREPARING' },
    });

    expect(calls.find((c) => c.table === 'deliveries')).toBeUndefined();
  });

  it('never heals an order belonging to a restaurant the caller is not a member of', async () => {
    const { subject, calls } = buildTransitionService([
      NO_ERROR,
      deliverySnapshot('MERCHANT_ACCEPTED', RESTAURANT_A), // diagnostic read
      deliverySnapshot('MERCHANT_ACCEPTED', RESTAURANT_A), // self-heal read
    ]);

    await expect(subject.acceptOrder(merchantUser(RESTAURANT_B), ORDER_ID, ACCEPT_INPUT)).rejects.toMatchObject({
      code: 'NOT_RESTAURANT_MEMBER',
    });

    expect(calls.find((c) => c.table === 'deliveries')).toBeUndefined();
  });

  it('a failing self-heal never masks the original transition error', async () => {
    const { subject } = buildTransitionService([
      NO_ERROR,
      deliverySnapshot(),
      { data: null, error: { message: 'connection reset' } }, // self-heal read fails
    ]);

    // Still the precise stale-state answer, not a generic INTERNAL_ERROR.
    await expect(subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, ACCEPT_INPUT)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      details: { currentState: 'MERCHANT_ACCEPTED' },
    });
  });

  it('issues no query at all for a merchant with no membership — the heal path does not weaken that', async () => {
    const { subject, calls } = buildTransitionService([]);

    await expect(subject.acceptOrder(merchantUser(), ORDER_ID, ACCEPT_INPUT)).rejects.toMatchObject({
      code: 'NOT_RESTAURANT_MEMBER',
    });
    expect(calls).toHaveLength(0);
  });

  it('does not attempt a delivery for an order that does not exist', async () => {
    const { subject, calls } = buildTransitionService([
      NO_ERROR, // guarded UPDATE: 0 rows
      NO_ERROR, // diagnostic read: no such order
      NO_ERROR, // self-heal read: no such order
    ]);

    await expect(subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, ACCEPT_INPUT)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(calls.find((c) => c.table === 'deliveries')).toBeUndefined();
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

    await expect(subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, ACCEPT_INPUT)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      details: { currentState: 'MERCHANT_ACCEPTED' },
    });
  });

  it('a database error on the guarded UPDATE itself maps to INTERNAL_ERROR, not a silent success', async () => {
    const { subject } = buildTransitionService([{ data: null, error: { message: 'connection reset' } }]);

    await expect(subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, ACCEPT_INPUT)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });
});

/** The shape of every `outbox.insert(...)` call body this service writes — see `writeOutboxEvent`. */
interface OutboxInsertBody {
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: { recipients: { recipientId: string; recipientType: string }[] };
}

describe('OrdersService — H-3 outbox events', () => {
  const ACCEPTED_ROW = {
    data: { id: ORDER_ID, restaurant_id: RESTAURANT_A, state: 'MERCHANT_ACCEPTED', customer_id: 'customer-1' },
    error: null,
  };
  const READY_ROW = {
    data: { id: ORDER_ID, restaurant_id: RESTAURANT_A, state: 'READY_FOR_PICKUP', customer_id: 'customer-1' },
    error: null,
  };

  it('OrderCreated: writes CUSTOMER + MERCHANT recipients with the correct aggregate and event_type', async () => {
    const { from, calls } = outboxAwareFromStub([
      { data: { merchant_id: 'merchant-1' }, error: null }, // restaurants (merchant owner)
      { data: { owner_user_id: 'merchant-owner-1' }, error: null }, // merchants (owner)
      { data: null, error: null }, // outbox insert
    ]);
    const rpc = jest
      .fn()
      .mockResolvedValue({ data: [{ order_id: 'order-42', order_number: 'BH-1', state: 'CREATED' }], error: null });
    const supabase = { admin: { rpc, from } } as unknown as SupabaseService;
    const cart = { validate: jest.fn().mockResolvedValue(VALID_CART) } as unknown as CartService;
    const addresses = { getOwned: jest.fn().mockResolvedValue(OWNED_ADDRESS) } as unknown as AddressesService;
    const pricing = { resolveOrderFees: jest.fn().mockReturnValue(FEES) } as unknown as OrderPricingService;
    const subject = new OrdersService(supabase, cart, addresses, pricing);

    await subject.create(CUSTOMER_ID, { addressId: ADDRESS_ID, paymentMethod: 'ONLINE' });

    const outboxInsert = calls.find((c) => c.table === 'outbox');
    const body = outboxInsert?.payload as OutboxInsertBody | undefined;
    expect(body).toMatchObject({
      aggregate_type: 'order',
      aggregate_id: 'order-42',
      event_type: 'OrderCreated',
    });
    expect(body?.payload.recipients).toEqual([
      { recipientId: CUSTOMER_ID, recipientType: 'CUSTOMER' },
      { recipientId: 'merchant-owner-1', recipientType: 'MERCHANT' },
    ]);
  });

  it('MerchantAcceptedOrder: CUSTOMER only — never RIDER, since no delivery has a rider yet at this transition', async () => {
    const { supabase, calls } = ordersTableStub([
      ACCEPTED_ROW, // guarded UPDATE
      { data: null, error: null }, // order_status_history
      { data: { merchant_id: 'merchant-1' }, error: null }, // restaurants (merchant owner)
      { data: { owner_user_id: 'merchant-owner-1' }, error: null }, // merchants (owner)
      { data: null, error: null }, // outbox insert (MerchantAcceptedOrder)
      { data: { id: ORDER_ID, restaurant_id: RESTAURANT_A, state: 'MERCHANT_ACCEPTED', delivery_lat: null, delivery_lng: null, customer_id: 'customer-1' }, error: null }, // ensureDelivery order read
      { data: { lat: null, lng: null }, error: null }, // restaurants (pickup coords)
      { data: { id: 'delivery-1' }, error: null }, // deliveries insert
      { data: null, error: null }, // outbox insert (RiderSearchStarted)
    ]);
    const cart = {} as unknown as CartService;
    const addresses = {} as unknown as AddressesService;
    const pricing = {} as unknown as OrderPricingService;
    const subject = new OrdersService(supabase, cart, addresses, pricing);

    await subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, ACCEPT_INPUT);

    const outboxInserts = calls.filter((c) => c.table === 'outbox');
    const merchantAcceptedEvent = outboxInserts
      .map((c) => c.payload as unknown as OutboxInsertBody)
      .find((body) => body.event_type === 'MerchantAcceptedOrder');
    expect(merchantAcceptedEvent).toMatchObject({
      aggregate_type: 'order',
      aggregate_id: ORDER_ID,
      event_type: 'MerchantAcceptedOrder',
    });
    const recipients = merchantAcceptedEvent?.payload.recipients ?? [];
    expect(recipients).toEqual([
      { recipientId: 'customer-1', recipientType: 'CUSTOMER' },
      { recipientId: 'merchant-owner-1', recipientType: 'MERCHANT' },
    ]);
    expect(recipients.some((r) => r.recipientType === 'RIDER')).toBe(false);
  });

  it('OrderReady: adds RIDER only when deliveries.rider_id is already set for this order', async () => {
    const { supabase, calls } = ordersTableStub([
      READY_ROW, // guarded UPDATE
      { data: null, error: null }, // order_status_history
      { data: { merchant_id: 'merchant-1' }, error: null }, // restaurants (merchant owner)
      { data: { owner_user_id: 'merchant-owner-1' }, error: null }, // merchants (owner)
      { data: { rider_id: 'rider-row-1' }, error: null }, // deliveries (assigned rider lookup)
      { data: { user_id: 'rider-profile-1' }, error: null }, // riders (profile id)
      { data: null, error: null }, // outbox insert (OrderReady)
    ]);
    const cart = {} as unknown as CartService;
    const addresses = {} as unknown as AddressesService;
    const pricing = {} as unknown as OrderPricingService;
    const subject = new OrdersService(supabase, cart, addresses, pricing);

    await subject.markReady(merchantUser(RESTAURANT_A), ORDER_ID);

    const outboxInsert = calls.find((c) => c.table === 'outbox');
    const body = outboxInsert?.payload as OutboxInsertBody | undefined;
    expect(body).toMatchObject({
      aggregate_type: 'order',
      aggregate_id: ORDER_ID,
      event_type: 'OrderReady',
    });
    expect(body?.payload.recipients).toEqual([
      { recipientId: 'customer-1', recipientType: 'CUSTOMER' },
      { recipientId: 'merchant-owner-1', recipientType: 'MERCHANT' },
      { recipientId: 'rider-profile-1', recipientType: 'RIDER' },
    ]);
  });

  it('OrderReady: omits RIDER entirely (never a null/fake recipient) when no rider is assigned yet', async () => {
    const { supabase, calls } = ordersTableStub([
      READY_ROW,
      { data: null, error: null },
      { data: { merchant_id: 'merchant-1' }, error: null },
      { data: { owner_user_id: 'merchant-owner-1' }, error: null },
      { data: { rider_id: null }, error: null }, // deliveries row exists but no rider yet
      { data: null, error: null }, // outbox insert
    ]);
    const cart = {} as unknown as CartService;
    const addresses = {} as unknown as AddressesService;
    const pricing = {} as unknown as OrderPricingService;
    const subject = new OrdersService(supabase, cart, addresses, pricing);

    await subject.markReady(merchantUser(RESTAURANT_A), ORDER_ID);

    const outboxInsert = calls.find((c) => c.table === 'outbox');
    const body = outboxInsert?.payload as OutboxInsertBody | undefined;
    expect(body?.payload.recipients.map((r) => r.recipientType)).toEqual(['CUSTOMER', 'MERCHANT']);
  });

  it('a failed merchantTransition (guarded UPDATE matches 0 rows) writes no outbox event at all', async () => {
    const { subject, calls } = buildTransitionService([
      { data: null, error: null }, // guarded UPDATE: 0 rows
      { data: { id: ORDER_ID, restaurant_id: RESTAURANT_A, state: 'CREATED', customer_id: 'customer-1' }, error: null }, // diagnostic read
    ]);

    await expect(subject.acceptOrder(merchantUser(RESTAURANT_A), ORDER_ID, ACCEPT_INPUT)).rejects.toThrow();

    expect(calls.find((c) => c.table === 'outbox')).toBeUndefined();
  });
});
