import { thaiPhoneSchema, satangSchema, roleSchema } from './common';

describe('thaiPhoneSchema', () => {
  it('accepts a valid Thai mobile number in E.164 form', () => {
    expect(thaiPhoneSchema.safeParse('+66812345678').success).toBe(true);
  });

  it('rejects the local 0-prefixed format', () => {
    expect(thaiPhoneSchema.safeParse('0812345678').success).toBe(false);
  });

  it('rejects a number with the wrong digit count', () => {
    expect(thaiPhoneSchema.safeParse('+6681234567').success).toBe(false);
  });
});

describe('satangSchema', () => {
  it('accepts an integer amount', () => {
    expect(satangSchema.safeParse(13050).success).toBe(true);
  });

  it('rejects fractional satang, since money must never be floating point', () => {
    expect(satangSchema.safeParse(130.5).success).toBe(false);
  });

  it('rejects negative amounts', () => {
    expect(satangSchema.safeParse(-1).success).toBe(false);
  });
});

describe('roleSchema', () => {
  it('accepts each of the four BANHAO roles', () => {
    for (const role of ['CUSTOMER', 'MERCHANT', 'DRIVER', 'ADMIN']) {
      expect(roleSchema.safeParse(role).success).toBe(true);
    }
  });

  it('rejects an unknown role', () => {
    expect(roleSchema.safeParse('SUPERUSER').success).toBe(false);
  });
});
