import { acceptOrderRequestSchema, cancelOrderRequestSchema, createOrderRequestSchema } from './order';

const ADDRESS_ID = '11111111-1111-4111-8111-111111111111';

describe('createOrderRequestSchema', () => {
  it('accepts the minimum valid body', () => {
    const result = createOrderRequestSchema.safeParse({
      addressId: ADDRESS_ID,
      paymentMethod: 'ONLINE',
    });
    expect(result.success).toBe(true);
  });

  it('accepts expectedLines, optional and same shape as cart/validate', () => {
    const result = createOrderRequestSchema.safeParse({
      addressId: ADDRESS_ID,
      paymentMethod: 'ONLINE',
      expectedLines: [{ cartItemId: ADDRESS_ID, expectedUnitPriceSatang: 6000 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing addressId', () => {
    const result = createOrderRequestSchema.safeParse({ paymentMethod: 'ONLINE' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID addressId', () => {
    const result = createOrderRequestSchema.safeParse({
      addressId: 'not-a-uuid',
      paymentMethod: 'ONLINE',
    });
    expect(result.success).toBe(false);
  });

  it('rejects CASH — DEC-016 disables Cash on Delivery at this service boundary', () => {
    const result = createOrderRequestSchema.safeParse({
      addressId: ADDRESS_ID,
      paymentMethod: 'CASH',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unsupported payment method string', () => {
    const result = createOrderRequestSchema.safeParse({
      addressId: ADDRESS_ID,
      paymentMethod: 'PROMPTPAY',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing paymentMethod', () => {
    const result = createOrderRequestSchema.safeParse({ addressId: ADDRESS_ID });
    expect(result.success).toBe(false);
  });

  it('rejects a client-supplied customerId — never trusted from the body', () => {
    const result = createOrderRequestSchema.safeParse({
      addressId: ADDRESS_ID,
      paymentMethod: 'ONLINE',
      customerId: 'someone-else',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a client-supplied restaurantId', () => {
    const result = createOrderRequestSchema.safeParse({
      addressId: ADDRESS_ID,
      paymentMethod: 'ONLINE',
      restaurantId: '22222222-2222-4222-8222-222222222222',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a client-supplied orderNumber', () => {
    const result = createOrderRequestSchema.safeParse({
      addressId: ADDRESS_ID,
      paymentMethod: 'ONLINE',
      orderNumber: 'BH-20260101-0001',
    });
    expect(result.success).toBe(false);
  });

  it.each(['subtotalSatang', 'deliveryFeeSatang', 'serviceFeeSatang', 'discountSatang', 'grandTotalSatang'])(
    'rejects a client-supplied %s — every money value is server-derived (DEC-E-01)',
    (field) => {
      const result = createOrderRequestSchema.safeParse({
        addressId: ADDRESS_ID,
        paymentMethod: 'ONLINE',
        [field]: 12345,
      });
      expect(result.success).toBe(false);
    },
  );
});

describe('cancelOrderRequestSchema', () => {
  it('accepts an empty body — reason is optional', () => {
    const result = cancelOrderRequestSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts a reason', () => {
    const result = cancelOrderRequestSchema.safeParse({ reason: 'เปลี่ยนใจ' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty-string reason', () => {
    const result = cancelOrderRequestSchema.safeParse({ reason: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a reason over 500 characters', () => {
    const result = cancelOrderRequestSchema.safeParse({ reason: 'x'.repeat(501) });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown field — strict, like every other order schema', () => {
    const result = cancelOrderRequestSchema.safeParse({ reason: 'ok', causeCode: 'CUSTOMER_CANCELLED' });
    expect(result.success).toBe(false);
  });
});

describe('acceptOrderRequestSchema (M-05)', () => {
  it.each([10, 20, 30, 45, 60])('accepts the %i-minute UI preset', (prepMinutes) => {
    const result = acceptOrderRequestSchema.safeParse({ prepMinutes });
    expect(result.success).toBe(true);
  });

  // M05-Q-01 leaves the preset policy open, and orders.prep_minutes is
  // constrained to `> 0` and nothing narrower. A shared schema that rejected
  // 25 would be answering an undecided product question in the wrong place.
  it('accepts a positive value the current UI does not offer', () => {
    const result = acceptOrderRequestSchema.safeParse({ prepMinutes: 25 });
    expect(result.success).toBe(true);
  });

  it('rejects a missing prepMinutes — M-05 makes the answer required', () => {
    const result = acceptOrderRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects a non-integer prepMinutes', () => {
    const result = acceptOrderRequestSchema.safeParse({ prepMinutes: 20.5 });
    expect(result.success).toBe(false);
  });

  it('rejects zero', () => {
    const result = acceptOrderRequestSchema.safeParse({ prepMinutes: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects a negative value', () => {
    const result = acceptOrderRequestSchema.safeParse({ prepMinutes: -20 });
    expect(result.success).toBe(false);
  });

  it.each([['a string', '20'], ['null', null], ['an array', []], ['a string body', 'prepMinutes=20']])(
    'rejects a malformed body — %s',
    (_label, body) => {
      const result = acceptOrderRequestSchema.safeParse(body as unknown);
      expect(result.success).toBe(false);
    },
  );

  it('rejects an unknown field — strict, like every other order schema', () => {
    const result = acceptOrderRequestSchema.safeParse({ prepMinutes: 20, restaurantId: 'x' });
    expect(result.success).toBe(false);
  });
});
