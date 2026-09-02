import { updateRestaurantProfileSchema } from './restaurant-profile';

describe('updateRestaurantProfileSchema', () => {
  const valid = {
    name: 'ร้านตามสั่งป้าสมร',
    description: 'ร้านก๋วยเตี๋ยวเรือและอาหารไทยตามสั่ง',
    phone: '081-234-5678',
    addressLine: '123 ถ.สถลมาร์ค ต.บุณฑริก อ.บุณฑริก จ.อุบลราชธานี 34230',
  };

  it('accepts a fully populated profile', () => {
    expect(updateRestaurantProfileSchema.safeParse(valid).success).toBe(true);
  });

  it('requires name', () => {
    const result = updateRestaurantProfileSchema.safeParse({ ...valid, name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a whitespace-only name', () => {
    const result = updateRestaurantProfileSchema.safeParse({ ...valid, name: '   ' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing name field entirely', () => {
    const { name: _name, ...withoutName } = valid;
    expect(updateRestaurantProfileSchema.safeParse(withoutName).success).toBe(false);
  });

  it.each(['description', 'phone', 'addressLine'] as const)(
    'rejects a request that omits %s — a save cannot leave an optional field unchanged by omitting it, only by sending it empty',
    (field) => {
      const { [field]: _omitted, ...withoutField } = valid;
      expect(updateRestaurantProfileSchema.safeParse(withoutField).success).toBe(false);
    },
  );

  it('accepts empty description, phone and addressLine — clearing an optional field', () => {
    const result = updateRestaurantProfileSchema.safeParse({
      ...valid,
      description: '',
      phone: '',
      addressLine: '',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown field, so a client cannot smuggle a write to a protected column', () => {
    const result = updateRestaurantProfileSchema.safeParse({ ...valid, status: 'ACTIVE' });
    expect(result.success).toBe(false);
  });

  it('rejects lat/lng smuggled through the body', () => {
    const result = updateRestaurantProfileSchema.safeParse({ ...valid, lat: 15.19, lng: 105.08 });
    expect(result.success).toBe(false);
  });

  it('rejects cuisine — not part of this contract (M10-Q-01 unresolved)', () => {
    const result = updateRestaurantProfileSchema.safeParse({ ...valid, cuisine: 'อาหารไทย' });
    expect(result.success).toBe(false);
  });
});
