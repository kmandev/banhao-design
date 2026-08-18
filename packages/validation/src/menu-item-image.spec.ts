import {
  completeMenuItemImageUploadSchema,
  requestMenuItemImageUploadUrlSchema,
} from './menu-item-image';

describe('requestMenuItemImageUploadUrlSchema', () => {
  it('accepts a valid contentType', () => {
    expect(
      requestMenuItemImageUploadUrlSchema.safeParse({ contentType: 'image/webp' }).success,
    ).toBe(true);
  });

  it('rejects a missing contentType', () => {
    expect(requestMenuItemImageUploadUrlSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an empty contentType', () => {
    expect(
      requestMenuItemImageUploadUrlSchema.safeParse({ contentType: '' }).success,
    ).toBe(false);
  });

  it('rejects an unknown field, so a client-supplied restaurantId cannot be smuggled through', () => {
    const result = requestMenuItemImageUploadUrlSchema.safeParse({
      contentType: 'image/webp',
      restaurantId: 'someone-elses-restaurant',
    });
    expect(result.success).toBe(false);
  });
});

describe('completeMenuItemImageUploadSchema', () => {
  it('accepts a valid objectKey', () => {
    expect(
      completeMenuItemImageUploadSchema.safeParse({
        objectKey: 'menu-items/m1/11111111-1111-4111-8111-111111111111.webp',
      }).success,
    ).toBe(true);
  });

  it('rejects a missing objectKey', () => {
    expect(completeMenuItemImageUploadSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an unknown field', () => {
    const result = completeMenuItemImageUploadSchema.safeParse({
      objectKey: 'menu-items/m1/11111111-1111-4111-8111-111111111111.webp',
      bucket: 'attacker-controlled',
    });
    expect(result.success).toBe(false);
  });
});
