import { MenuItemImageService } from './menu-item-image.service';
import { DomainError } from '../../common/errors/domain-error';
import { NO_CAPABILITIES, type ActorCapabilities } from '../../common/types';
import type { StorageService } from '../storage/storage.service';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * M-12 — menu item image upload.
 *
 * `StorageService` and `SupabaseService` are both stubbed (no real R2 call,
 * no real database call), matching M-11's own test convention — assert the
 * query/call actually built, not just the mapped output.
 *
 * Unlike M-11 (whose `restaurantId` arrives pre-authorized from
 * `@RestaurantScope()`), this service resolves ownership itself from
 * `menu_items`, so the stub needs to answer TWO different reads on the same
 * table: the ownership lookup (`select ... maybeSingle`) and, for
 * `completeUpload`, the write (`update ... select ... maybeSingle`).
 */

const MENU_ITEM_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_MENU_ITEM_ID = '44444444-4444-4444-8444-444444444444';
const RESTAURANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_RESTAURANT_ID = '22222222-2222-4222-8222-222222222222';

const MERCHANT_OF_RESTAURANT_A: ActorCapabilities = {
  ...NO_CAPABILITIES,
  merchant: [{ restaurantId: RESTAURANT_ID, memberRole: 'OWNER' }],
};

const MERCHANT_OF_RESTAURANT_B: ActorCapabilities = {
  ...NO_CAPABILITIES,
  merchant: [{ restaurantId: OTHER_RESTAURANT_ID, memberRole: 'OWNER' }],
};

const NON_MERCHANT: ActorCapabilities = { ...NO_CAPABILITIES, customer: true };

function fakeStorage(overrides: Partial<StorageService> = {}): StorageService {
  return {
    getSignedUploadUrl: jest.fn().mockResolvedValue('https://signed.example/upload'),
    exists: jest.fn().mockResolvedValue(true),
    getPublicUrl: jest.fn((key: string) => `https://assets.example.com/${key}`),
    upload: jest.fn(),
    delete: jest.fn(),
    ...overrides,
  } as unknown as StorageService;
}

type Result = { data: unknown; error: { message: string } | null };
interface Recorded {
  table: string;
  op: 'select' | 'update';
  eq: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

/** `results` is consumed in order, one per `.from('menu_items')` call. */
function fakeSupabase(results: Result[]): { service: SupabaseService; calls: Recorded[] } {
  const calls: Recorded[] = [];
  let index = 0;
  const next = (): Result => results[index++] ?? { data: null, error: null };

  const admin = {
    from(table: string) {
      const call: Recorded = { table, op: 'select', eq: {} };
      calls.push(call);

      const builder: Record<string, unknown> = {
        select: () => builder,
        update(payload: Record<string, unknown>) {
          call.op = 'update';
          call.payload = payload;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.eq[column] = value;
          return builder;
        },
        maybeSingle: () => Promise.resolve(next()),
      };

      return builder;
    },
  };

  return { service: { admin } as unknown as SupabaseService, calls };
}

const LOOKUP_A: Result = { data: { id: MENU_ITEM_ID, restaurant_id: RESTAURANT_ID }, error: null };
const NOT_FOUND: Result = { data: null, error: null };

function service(storage: StorageService, results: Result[]) {
  const { service: supabase, calls } = fakeSupabase(results);
  return { subject: new MenuItemImageService(storage, supabase), calls };
}

describe('MenuItemImageService.requestUploadUrl', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])(
    'accepts %s and returns a key scoped to the menu item',
    async (mime) => {
      const { subject } = service(fakeStorage(), [LOOKUP_A]);

      const result = await subject.requestUploadUrl(MENU_ITEM_ID, mime, MERCHANT_OF_RESTAURANT_A);

      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime];
      expect(result.objectKey).toMatch(
        new RegExp(`^menu-items/${MENU_ITEM_ID}/[0-9a-f-]+\\.${ext}$`),
      );
    },
  );

  it('resolves ownership via menu_items, scoped to the exact menuItemId', async () => {
    const { subject, calls } = service(fakeStorage(), [LOOKUP_A]);

    await subject.requestUploadUrl(MENU_ITEM_ID, 'image/webp', MERCHANT_OF_RESTAURANT_A);

    expect(calls[0]?.table).toBe('menu_items');
    expect(calls[0]?.eq).toEqual({ id: MENU_ITEM_ID });
  });

  it('rejects a merchant who is not a member of the owning restaurant', async () => {
    const { subject } = service(fakeStorage(), [LOOKUP_A]);

    await expect(
      subject.requestUploadUrl(MENU_ITEM_ID, 'image/webp', MERCHANT_OF_RESTAURANT_B),
    ).rejects.toMatchObject({ code: 'NOT_RESTAURANT_MEMBER' });
  });

  it('rejects a caller with no merchant capability at all', async () => {
    const { subject } = service(fakeStorage(), [LOOKUP_A]);

    await expect(
      subject.requestUploadUrl(MENU_ITEM_ID, 'image/webp', NON_MERCHANT),
    ).rejects.toMatchObject({ code: 'NOT_RESTAURANT_MEMBER' });
  });

  it('rejects a nonexistent menu item with the SAME error as unauthorized — no existence leak', async () => {
    const { subject } = service(fakeStorage(), [NOT_FOUND]);

    await expect(
      subject.requestUploadUrl(MENU_ITEM_ID, 'image/webp', MERCHANT_OF_RESTAURANT_A),
    ).rejects.toMatchObject({ code: 'NOT_RESTAURANT_MEMBER' });
  });

  it('rejects an unsupported MIME type', async () => {
    const { subject } = service(fakeStorage(), [LOOKUP_A]);

    await expect(
      subject.requestUploadUrl(MENU_ITEM_ID, 'image/gif', MERCHANT_OF_RESTAURANT_A),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('never returns R2 credentials — only uploadUrl and objectKey', async () => {
    const { subject } = service(fakeStorage(), [LOOKUP_A]);

    const result = await subject.requestUploadUrl(
      MENU_ITEM_ID,
      'image/webp',
      MERCHANT_OF_RESTAURANT_A,
    );

    expect(Object.keys(result).sort()).toEqual(['objectKey', 'uploadUrl']);
  });

  it('never exposes a bucket parameter — StorageService alone decides the bucket', async () => {
    const storage = fakeStorage();
    const { subject } = service(storage, [LOOKUP_A]);

    await subject.requestUploadUrl(MENU_ITEM_ID, 'image/webp', MERCHANT_OF_RESTAURANT_A);

    const call = (storage.getSignedUploadUrl as jest.Mock).mock.calls[0];
    expect(call).toHaveLength(2);
  });

  it('generates a different UUID on every call, so the client cannot predict or choose it', async () => {
    const { subject } = service(fakeStorage(), [LOOKUP_A, LOOKUP_A]);

    const a = await subject.requestUploadUrl(MENU_ITEM_ID, 'image/webp', MERCHANT_OF_RESTAURANT_A);
    const b = await subject.requestUploadUrl(MENU_ITEM_ID, 'image/webp', MERCHANT_OF_RESTAURANT_A);

    expect(a.objectKey).not.toBe(b.objectKey);
  });
});

describe('MenuItemImageService.completeUpload — key trust boundary', () => {
  it('rejects an arbitrary client-chosen object key', async () => {
    const { subject } = service(fakeStorage(), [LOOKUP_A]);

    await expect(
      subject.completeUpload(MENU_ITEM_ID, 'anything/i/want.webp', MERCHANT_OF_RESTAURANT_A),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a path-traversal-shaped object key', async () => {
    const { subject } = service(fakeStorage(), [LOOKUP_A]);

    await expect(
      subject.completeUpload(MENU_ITEM_ID, '../../etc/passwd.webp', MERCHANT_OF_RESTAURANT_A),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a full URL submitted as the object key', async () => {
    const { subject } = service(fakeStorage(), [LOOKUP_A]);

    await expect(
      subject.completeUpload(
        MENU_ITEM_ID,
        `https://pub-example.r2.dev/menu-items/${MENU_ITEM_ID}/${MENU_ITEM_ID}.webp`,
        MERCHANT_OF_RESTAURANT_A,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a key belonging to a different menu item (cross-menu-item)', async () => {
    const { subject } = service(fakeStorage(), [LOOKUP_A]);

    await expect(
      subject.completeUpload(
        MENU_ITEM_ID,
        `menu-items/${OTHER_MENU_ITEM_ID}/${OTHER_MENU_ITEM_ID}.webp`,
        MERCHANT_OF_RESTAURANT_A,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a key with an unrecognised extension', async () => {
    const { subject } = service(fakeStorage(), [LOOKUP_A]);

    await expect(
      subject.completeUpload(
        MENU_ITEM_ID,
        `menu-items/${MENU_ITEM_ID}/${MENU_ITEM_ID}.gif`,
        MERCHANT_OF_RESTAURANT_A,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects an invalid UUID filename', async () => {
    const { subject } = service(fakeStorage(), [LOOKUP_A]);

    await expect(
      subject.completeUpload(MENU_ITEM_ID, `menu-items/${MENU_ITEM_ID}/not-a-uuid.webp`, MERCHANT_OF_RESTAURANT_A),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('MenuItemImageService.completeUpload — authorization re-checked independently', () => {
  it('rejects completion by a merchant of a different restaurant, even with a structurally valid key', async () => {
    const { subject } = service(fakeStorage(), [LOOKUP_A]);
    const key = `menu-items/${MENU_ITEM_ID}/${MENU_ITEM_ID}.webp`;

    await expect(
      subject.completeUpload(MENU_ITEM_ID, key, MERCHANT_OF_RESTAURANT_B),
    ).rejects.toMatchObject({ code: 'NOT_RESTAURANT_MEMBER' });
  });

  it('checks ownership before checking the object key at all', async () => {
    const storage = fakeStorage();
    const { subject } = service(storage, [LOOKUP_A]);

    await subject
      .completeUpload(MENU_ITEM_ID, 'garbage-key', MERCHANT_OF_RESTAURANT_B)
      .catch(() => undefined);

    // Never even reached the point of asking R2 about a key it wasn't
    // authorized to name in the first place.
    expect(storage.exists).not.toHaveBeenCalled();
  });
});

describe('MenuItemImageService.completeUpload — verification before write', () => {
  it('does not update the database when the object does not exist in R2', async () => {
    const storage = fakeStorage({ exists: jest.fn().mockResolvedValue(false) });
    const { subject, calls } = service(storage, [LOOKUP_A]);
    const key = `menu-items/${MENU_ITEM_ID}/${MENU_ITEM_ID}.webp`;

    await expect(
      subject.completeUpload(MENU_ITEM_ID, key, MERCHANT_OF_RESTAURANT_A),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('checks existence at the exact submitted (and now-parsed) key', async () => {
    const storage = fakeStorage();
    const key = `menu-items/${MENU_ITEM_ID}/${MENU_ITEM_ID}.png`;
    const { subject } = service(storage, [
      LOOKUP_A,
      { data: { id: MENU_ITEM_ID, image_url: key }, error: null },
    ]);

    await subject.completeUpload(MENU_ITEM_ID, key, MERCHANT_OF_RESTAURANT_A);

    expect(storage.exists).toHaveBeenCalledWith(key);
  });

  it('propagates an unexpected storage error rather than treating it as "not uploaded"', async () => {
    const storage = fakeStorage({ exists: jest.fn().mockRejectedValue(new Error('R2 unreachable')) });
    const { subject } = service(storage, [LOOKUP_A]);
    const key = `menu-items/${MENU_ITEM_ID}/${MENU_ITEM_ID}.webp`;

    await expect(
      subject.completeUpload(MENU_ITEM_ID, key, MERCHANT_OF_RESTAURANT_A),
    ).rejects.toThrow('R2 unreachable');
  });
});

describe('MenuItemImageService.completeUpload — successful completion', () => {
  it('updates menu_items.image_url to the object key', async () => {
    const storage = fakeStorage();
    const { subject, calls } = service(storage, [
      LOOKUP_A,
      { data: { id: MENU_ITEM_ID, image_url: 'placeholder' }, error: null },
    ]);
    const key = `menu-items/${MENU_ITEM_ID}/${MENU_ITEM_ID}.webp`;

    await subject.completeUpload(MENU_ITEM_ID, key, MERCHANT_OF_RESTAURANT_A);

    const update = calls.find((c) => c.op === 'update');
    expect(update?.eq).toEqual({ id: MENU_ITEM_ID });
    expect(update?.payload).toEqual({ image_url: key });
  });

  it('database stores the object key only — never a full URL', async () => {
    const storage = fakeStorage();
    const { subject, calls } = service(storage, [
      LOOKUP_A,
      { data: { id: MENU_ITEM_ID, image_url: 'x' }, error: null },
    ]);
    const key = `menu-items/${MENU_ITEM_ID}/${MENU_ITEM_ID}.webp`;

    await subject.completeUpload(MENU_ITEM_ID, key, MERCHANT_OF_RESTAURANT_A);

    const update = calls.find((c) => c.op === 'update');
    const stored = (update?.payload as Record<string, unknown>).image_url as string;
    expect(stored.startsWith('http')).toBe(false);
    expect(stored).not.toContain('r2.dev');
    expect(stored).not.toContain('r2.cloudflarestorage.com');
    expect(stored).not.toContain('?');
  });

  it('response resolves the public URL through StorageService.getPublicUrl', async () => {
    const storage = fakeStorage();
    const key = `menu-items/${MENU_ITEM_ID}/${MENU_ITEM_ID}.webp`;
    const { subject } = service(storage, [
      LOOKUP_A,
      { data: { id: MENU_ITEM_ID, image_url: key }, error: null },
    ]);

    const result = await subject.completeUpload(MENU_ITEM_ID, key, MERCHANT_OF_RESTAURANT_A);

    expect(storage.getPublicUrl).toHaveBeenCalledWith(key);
    expect(result.imageUrl).toBe(`https://assets.example.com/${key}`);
  });

  it('is idempotent — completing the same upload twice succeeds both times with the same result', async () => {
    const storage = fakeStorage();
    const key = `menu-items/${MENU_ITEM_ID}/${MENU_ITEM_ID}.webp`;
    const writeResult = { data: { id: MENU_ITEM_ID, image_url: key }, error: null };
    const { subject, calls } = service(storage, [LOOKUP_A, writeResult, LOOKUP_A, writeResult]);

    const first = await subject.completeUpload(MENU_ITEM_ID, key, MERCHANT_OF_RESTAURANT_A);
    const second = await subject.completeUpload(MENU_ITEM_ID, key, MERCHANT_OF_RESTAURANT_A);

    expect(first).toEqual(second);
    expect(calls.filter((c) => c.op === 'update')).toHaveLength(2);
  });

  it('replacement with a different extension overwrites image_url to the new key', async () => {
    const storage = fakeStorage();
    const newKey = `menu-items/${MENU_ITEM_ID}/${MENU_ITEM_ID}.jpg`;
    const { subject, calls } = service(storage, [
      LOOKUP_A,
      { data: { id: MENU_ITEM_ID, image_url: newKey }, error: null },
    ]);

    const result = await subject.completeUpload(MENU_ITEM_ID, newKey, MERCHANT_OF_RESTAURANT_A);

    const update = calls.find((c) => c.op === 'update');
    expect((update?.payload as Record<string, unknown>).image_url).toBe(newKey);
    expect(result.imageUrl).toContain(newKey);
  });

  it('surfaces NOT_FOUND if the menu item row is gone by the time of the write (defensive)', async () => {
    const storage = fakeStorage();
    const { subject } = service(storage, [LOOKUP_A, { data: null, error: null }]);
    const key = `menu-items/${MENU_ITEM_ID}/${MENU_ITEM_ID}.webp`;

    await expect(
      subject.completeUpload(MENU_ITEM_ID, key, MERCHANT_OF_RESTAURANT_A),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('surfaces INTERNAL_ERROR on a database write failure, without leaking the raw message', async () => {
    const storage = fakeStorage();
    const { subject } = service(storage, [
      LOOKUP_A,
      { data: null, error: { message: 'connection reset' } },
    ]);
    const key = `menu-items/${MENU_ITEM_ID}/${MENU_ITEM_ID}.webp`;

    const caught = await subject
      .completeUpload(MENU_ITEM_ID, key, MERCHANT_OF_RESTAURANT_A)
      .catch((e: DomainError) => e);

    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).code).toBe('INTERNAL_ERROR');
    expect((caught as DomainError).message).not.toContain('connection reset');
  });

  it('surfaces INTERNAL_ERROR on the ownership-lookup failing, without leaking the raw message', async () => {
    const storage = fakeStorage();
    const { subject } = service(storage, [{ data: null, error: { message: 'connection reset' } }]);

    const caught = await subject
      .requestUploadUrl(MENU_ITEM_ID, 'image/webp', MERCHANT_OF_RESTAURANT_A)
      .catch((e: DomainError) => e);

    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).code).toBe('INTERNAL_ERROR');
    expect((caught as DomainError).message).not.toContain('connection reset');
  });
});
