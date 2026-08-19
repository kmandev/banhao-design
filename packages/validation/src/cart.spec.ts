import { cartValidateRequestSchema } from './cart';

describe('cartValidateRequestSchema', () => {
  it('accepts an empty body', () => {
    expect(cartValidateRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a valid expectedLines array', () => {
    const result = cartValidateRequestSchema.safeParse({
      expectedLines: [{ cartItemId: '11111111-1111-4111-8111-111111111111', expectedUnitPriceSatang: 6000 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-UUID cartItemId', () => {
    const result = cartValidateRequestSchema.safeParse({
      expectedLines: [{ cartItemId: 'not-a-uuid', expectedUnitPriceSatang: 6000 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a fractional satang amount', () => {
    const result = cartValidateRequestSchema.safeParse({
      expectedLines: [{ cartItemId: '11111111-1111-4111-8111-111111111111', expectedUnitPriceSatang: 60.5 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a negative satang amount', () => {
    const result = cartValidateRequestSchema.safeParse({
      expectedLines: [{ cartItemId: '11111111-1111-4111-8111-111111111111', expectedUnitPriceSatang: -1 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown top-level field, so a client-supplied userId cannot be smuggled through', () => {
    const result = cartValidateRequestSchema.safeParse({ userId: 'someone-else' });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown field inside expectedLines, so a price snapshot cannot be smuggled in', () => {
    const result = cartValidateRequestSchema.safeParse({
      expectedLines: [
        {
          cartItemId: '11111111-1111-4111-8111-111111111111',
          expectedUnitPriceSatang: 6000,
          subtotalSatang: 99999,
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
