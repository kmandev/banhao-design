import {
  ALLOWED_IMAGE_MIME_TYPES,
  InvalidObjectKeyInputError,
  isAllowedImageMimeType,
  mimeTypeForExtension,
  restaurantCoverObjectKey,
} from './object-key';

const RESTAURANT_ID = '11111111-1111-4111-8111-111111111111';

describe('restaurantCoverObjectKey', () => {
  it('produces the documented key shape for a valid UUID and jpeg', () => {
    expect(restaurantCoverObjectKey(RESTAURANT_ID, 'image/jpeg')).toBe(
      `restaurants/${RESTAURANT_ID}/cover.jpg`,
    );
  });

  it.each(Object.entries(ALLOWED_IMAGE_MIME_TYPES))(
    'maps %s to the extension .%s',
    (mimeType, ext) => {
      expect(restaurantCoverObjectKey(RESTAURANT_ID, mimeType)).toBe(
        `restaurants/${RESTAURANT_ID}/cover.${ext}`,
      );
    },
  );

  it('rejects a non-UUID restaurantId', () => {
    expect(() => restaurantCoverObjectKey('not-a-uuid', 'image/jpeg')).toThrow(
      InvalidObjectKeyInputError,
    );
  });

  it.each([
    'restaurants/../../etc/passwd',
    '../../secret',
    '11111111-1111-4111-8111-111111111111/../other',
  ])('rejects a path-traversal-shaped restaurantId: %s', (input) => {
    expect(() => restaurantCoverObjectKey(input, 'image/jpeg')).toThrow(
      InvalidObjectKeyInputError,
    );
  });

  it('rejects an unsupported MIME type', () => {
    expect(() => restaurantCoverObjectKey(RESTAURANT_ID, 'image/gif')).toThrow(
      InvalidObjectKeyInputError,
    );
  });

  it('rejects a MIME type that is not an image at all', () => {
    expect(() => restaurantCoverObjectKey(RESTAURANT_ID, 'application/x-msdownload')).toThrow(
      InvalidObjectKeyInputError,
    );
  });

  it('never trusts a client-supplied extension — only the verified MIME type decides it', () => {
    // Nothing in the function signature even accepts a filename/extension —
    // this asserts that fact stays true rather than merely hoping it does.
    expect(restaurantCoverObjectKey.length).toBe(2);
  });
});

describe('isAllowedImageMimeType', () => {
  it('accepts exactly the three documented types', () => {
    expect(Object.keys(ALLOWED_IMAGE_MIME_TYPES).sort()).toEqual(
      ['image/jpeg', 'image/png', 'image/webp'].sort(),
    );
  });

  it('rejects an arbitrary string', () => {
    expect(isAllowedImageMimeType('text/html')).toBe(false);
  });
});

describe('mimeTypeForExtension', () => {
  it.each(Object.entries(ALLOWED_IMAGE_MIME_TYPES))(
    'maps extension .%s back to %s',
    (mimeType, ext) => {
      expect(mimeTypeForExtension(ext)).toBe(mimeType);
    },
  );

  it('is the exact inverse of restaurantCoverObjectKey for every allowed type', () => {
    // M-11's complete-upload step depends on this round-tripping exactly —
    // otherwise a legitimately-uploaded object could fail its own re-derived
    // key check.
    for (const mimeType of Object.keys(ALLOWED_IMAGE_MIME_TYPES)) {
      const key = restaurantCoverObjectKey(RESTAURANT_ID, mimeType);
      const ext = key.split('.').pop() as string;
      expect(mimeTypeForExtension(ext)).toBe(mimeType);
    }
  });

  it('returns undefined for an unknown extension', () => {
    expect(mimeTypeForExtension('gif')).toBeUndefined();
    expect(mimeTypeForExtension('')).toBeUndefined();
  });
});
