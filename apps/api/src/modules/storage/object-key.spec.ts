import {
  ALLOWED_IMAGE_MIME_TYPES,
  InvalidObjectKeyInputError,
  isAllowedImageMimeType,
  menuItemImageObjectKey,
  mimeTypeForExtension,
  parseMenuItemImageObjectKey,
  restaurantCoverObjectKey,
} from './object-key';

const RESTAURANT_ID = '11111111-1111-4111-8111-111111111111';
const MENU_ITEM_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_MENU_ITEM_ID = '44444444-4444-4444-8444-444444444444';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

describe('menuItemImageObjectKey', () => {
  it('produces the documented key shape with a real UUID filename', () => {
    const key = menuItemImageObjectKey(MENU_ITEM_ID, 'image/webp');

    const match = key.match(
      new RegExp(`^menu-items/${MENU_ITEM_ID}/([0-9a-f-]+)\\.webp$`),
    );
    expect(match).not.toBeNull();
    expect(match?.[1]).toMatch(UUID_PATTERN);
  });

  it.each(Object.entries(ALLOWED_IMAGE_MIME_TYPES))('maps %s to the extension .%s', (mimeType, ext) => {
    expect(menuItemImageObjectKey(MENU_ITEM_ID, mimeType).endsWith(`.${ext}`)).toBe(true);
  });

  it('generates a different key on every call — never deterministic', () => {
    const a = menuItemImageObjectKey(MENU_ITEM_ID, 'image/webp');
    const b = menuItemImageObjectKey(MENU_ITEM_ID, 'image/webp');
    expect(a).not.toBe(b);
  });

  it('rejects a non-UUID menuItemId', () => {
    expect(() => menuItemImageObjectKey('not-a-uuid', 'image/webp')).toThrow(
      InvalidObjectKeyInputError,
    );
  });

  it('rejects an unsupported MIME type', () => {
    expect(() => menuItemImageObjectKey(MENU_ITEM_ID, 'image/gif')).toThrow(
      InvalidObjectKeyInputError,
    );
  });

  it('never accepts a filename, UUID or extension from the caller — only menuItemId and mimeType', () => {
    expect(menuItemImageObjectKey.length).toBe(2);
  });
});

describe('parseMenuItemImageObjectKey', () => {
  it('accepts a key genuinely produced by menuItemImageObjectKey', () => {
    const key = menuItemImageObjectKey(MENU_ITEM_ID, 'image/webp');

    expect(parseMenuItemImageObjectKey(key, MENU_ITEM_ID)).toEqual({
      menuItemId: MENU_ITEM_ID,
      mimeType: 'image/webp',
    });
  });

  it.each(Object.keys(ALLOWED_IMAGE_MIME_TYPES))('round-trips every allowed type: %s', (mimeType) => {
    const key = menuItemImageObjectKey(MENU_ITEM_ID, mimeType);
    expect(parseMenuItemImageObjectKey(key, MENU_ITEM_ID)).toEqual({
      menuItemId: MENU_ITEM_ID,
      mimeType,
    });
  });

  it('rejects a key belonging to a different menu item (cross-menu-item)', () => {
    const key = menuItemImageObjectKey(OTHER_MENU_ITEM_ID, 'image/webp');
    expect(parseMenuItemImageObjectKey(key, MENU_ITEM_ID)).toBeNull();
  });

  it('rejects when the expected menuItemId itself is not a UUID', () => {
    const key = menuItemImageObjectKey(MENU_ITEM_ID, 'image/webp');
    expect(parseMenuItemImageObjectKey(key, 'not-a-uuid')).toBeNull();
  });

  it.each([
    'restaurants/11111111-1111-4111-8111-111111111111/cover.webp',
    `menu-items/${MENU_ITEM_ID}/../../etc/passwd`,
    `../../menu-items/${MENU_ITEM_ID}/x.webp`,
    `/menu-items/${MENU_ITEM_ID}/${MENU_ITEM_ID}.webp`,
    `menu-items//${MENU_ITEM_ID}.webp`,
    `menu-items/${MENU_ITEM_ID}/${MENU_ITEM_ID}.webp/`,
    `https://pub-example.r2.dev/menu-items/${MENU_ITEM_ID}/${MENU_ITEM_ID}.webp`,
    `menu-items/${MENU_ITEM_ID}/${MENU_ITEM_ID}.webp?x=1`,
    `menu-items/${MENU_ITEM_ID}/not-a-uuid.webp`,
    `menu-items/${MENU_ITEM_ID}/${MENU_ITEM_ID}.gif`,
    `menu-items/${MENU_ITEM_ID}/${MENU_ITEM_ID}`,
    '',
  ])('rejects a structurally invalid key: %s', (badKey) => {
    expect(parseMenuItemImageObjectKey(badKey, MENU_ITEM_ID)).toBeNull();
  });
});
