import { completeCoverUploadSchema, requestCoverUploadUrlSchema } from './restaurant-cover';

describe('requestCoverUploadUrlSchema', () => {
  it('accepts a valid contentType', () => {
    expect(requestCoverUploadUrlSchema.safeParse({ contentType: 'image/webp' }).success).toBe(
      true,
    );
  });

  it('rejects a missing contentType', () => {
    expect(requestCoverUploadUrlSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an empty contentType', () => {
    expect(requestCoverUploadUrlSchema.safeParse({ contentType: '' }).success).toBe(false);
  });

  it('rejects an unknown field, so a client-supplied restaurantId cannot be smuggled through', () => {
    const result = requestCoverUploadUrlSchema.safeParse({
      contentType: 'image/webp',
      restaurantId: 'someone-elses-restaurant',
    });
    expect(result.success).toBe(false);
  });
});

describe('completeCoverUploadSchema', () => {
  it('accepts a valid objectKey', () => {
    expect(
      completeCoverUploadSchema.safeParse({ objectKey: 'restaurants/r1/cover.webp' }).success,
    ).toBe(true);
  });

  it('rejects a missing objectKey', () => {
    expect(completeCoverUploadSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an unknown field', () => {
    const result = completeCoverUploadSchema.safeParse({
      objectKey: 'restaurants/r1/cover.webp',
      bucket: 'attacker-controlled',
    });
    expect(result.success).toBe(false);
  });
});
