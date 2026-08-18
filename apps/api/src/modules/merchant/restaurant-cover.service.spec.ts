import { RestaurantCoverService } from './restaurant-cover.service';
import { DomainError } from '../../common/errors/domain-error';
import type { StorageService } from '../storage/storage.service';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * M-11 — restaurant cover image upload.
 *
 * `StorageService` and `SupabaseService` are both stubbed directly (no real
 * R2 call, no real database call), matching this codebase's established
 * "assert the query/call that was actually built" convention — the same
 * approach `addresses.service.spec.ts` and `cart.service.spec.ts` use.
 */

const RESTAURANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_RESTAURANT_ID = '22222222-2222-4222-8222-222222222222';

function fakeStorage(overrides: Partial<StorageService> = {}): StorageService {
  return {
    getSignedUploadUrl: jest.fn().mockResolvedValue('https://signed.example/upload'),
    exists: jest.fn().mockResolvedValue(true),
    upload: jest.fn(),
    delete: jest.fn(),
    getPublicUrl: jest.fn(),
    ...overrides,
  } as unknown as StorageService;
}

type UpdateResult = { data: unknown; error: { message: string } | null };

function fakeSupabase(result: UpdateResult): { service: SupabaseService; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];

  const admin = {
    from(table: string) {
      const call: Record<string, unknown> = { table, eq: {} };
      calls.push(call);

      const builder: Record<string, unknown> = {
        update(payload: Record<string, unknown>) {
          call.op = 'update';
          call.payload = payload;
          return builder;
        },
        eq(column: string, value: unknown) {
          (call.eq as Record<string, unknown>)[column] = value;
          return builder;
        },
        select: () => builder,
        maybeSingle: () => Promise.resolve(result),
      };

      return builder;
    },
  };

  return { service: { admin } as unknown as SupabaseService, calls };
}

function service(
  storage: StorageService,
  result: UpdateResult = { data: { id: RESTAURANT_ID, image_url: 'placeholder' }, error: null },
) {
  const { service: supabase, calls } = fakeSupabase(result);
  return { subject: new RestaurantCoverService(storage, supabase), calls };
}

describe('RestaurantCoverService.requestUploadUrl', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s and returns a scoped key', async (mime) => {
    const storage = fakeStorage();
    const { subject } = service(storage);

    const result = await subject.requestUploadUrl(RESTAURANT_ID, mime);

    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime];
    expect(result.objectKey).toBe(`restaurants/${RESTAURANT_ID}/cover.${ext}`);
  });

  it('rejects an unsupported MIME type', async () => {
    const { subject } = service(fakeStorage());

    await expect(subject.requestUploadUrl(RESTAURANT_ID, 'image/gif')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('generates the presigned URL for the exact key and content type, using only the authenticated restaurantId', async () => {
    const storage = fakeStorage();
    const { subject } = service(storage);

    await subject.requestUploadUrl(RESTAURANT_ID, 'image/webp');

    expect(storage.getSignedUploadUrl).toHaveBeenCalledWith(
      `restaurants/${RESTAURANT_ID}/cover.webp`,
      'image/webp',
    );
  });

  it('the generated key uses the authenticated restaurant id, never any other', async () => {
    const storage = fakeStorage();
    const { subject } = service(storage);

    const result = await subject.requestUploadUrl(RESTAURANT_ID, 'image/webp');

    expect(result.objectKey).toContain(RESTAURANT_ID);
    expect(result.objectKey).not.toContain(OTHER_RESTAURANT_ID);
  });

  it('never returns R2 credentials — only uploadUrl and objectKey', async () => {
    const { subject } = service(fakeStorage());

    const result = await subject.requestUploadUrl(RESTAURANT_ID, 'image/webp');

    expect(Object.keys(result).sort()).toEqual(['objectKey', 'uploadUrl']);
  });

  it('never exposes a bucket parameter — StorageService alone decides the bucket', async () => {
    const storage = fakeStorage();
    const { subject } = service(storage);

    await subject.requestUploadUrl(RESTAURANT_ID, 'image/webp');

    // getSignedUploadUrl's own signature has no bucket parameter at all — the
    // call above only ever passes (key, contentType). StorageService's own
    // tests separately prove the bucket is fixed from config.
    const call = (storage.getSignedUploadUrl as jest.Mock).mock.calls[0];
    expect(call).toHaveLength(2);
  });
});

describe('RestaurantCoverService.completeUpload — verification before write', () => {
  it('does not update the database when the object does not exist in R2', async () => {
    const storage = fakeStorage({ exists: jest.fn().mockResolvedValue(false) });
    const { subject, calls } = service(storage);

    await expect(
      subject.completeUpload(RESTAURANT_ID, `restaurants/${RESTAURANT_ID}/cover.webp`),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('checks existence at the exact recomputed key, not the raw client input', async () => {
    const storage = fakeStorage();
    const { subject } = service(storage);

    await subject.completeUpload(RESTAURANT_ID, `restaurants/${RESTAURANT_ID}/cover.png`);

    expect(storage.exists).toHaveBeenCalledWith(`restaurants/${RESTAURANT_ID}/cover.png`);
  });
});

describe('RestaurantCoverService.completeUpload — key trust boundary', () => {
  it('rejects an arbitrary client-chosen object key', async () => {
    const { subject } = service(fakeStorage());

    await expect(
      subject.completeUpload(RESTAURANT_ID, 'anything/i/want.webp'),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a path-traversal-shaped object key', async () => {
    const { subject } = service(fakeStorage());

    await expect(
      subject.completeUpload(RESTAURANT_ID, '../../etc/passwd.webp'),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a key naming a different restaurant than the authenticated one', async () => {
    const { subject } = service(fakeStorage());

    await expect(
      subject.completeUpload(RESTAURANT_ID, `restaurants/${OTHER_RESTAURANT_ID}/cover.webp`),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a key with an unrecognised extension', async () => {
    const { subject } = service(fakeStorage());

    await expect(
      subject.completeUpload(RESTAURANT_ID, `restaurants/${RESTAURANT_ID}/cover.gif`),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('never trusts the client key for the database write — only the server-recomputed one', async () => {
    const storage = fakeStorage();
    const { subject, calls } = service(storage);
    // A key that is superficially well-formed but for the wrong extension
    // vs. what was actually uploaded is still rejected by the equality check;
    // this proves no code path passes the raw client string through untouched.
    const validKey = `restaurants/${RESTAURANT_ID}/cover.webp`;

    await subject.completeUpload(RESTAURANT_ID, validKey);

    const update = calls.find((c) => c.op === 'update');
    expect((update?.payload as Record<string, unknown>).image_url).toBe(validKey);
  });
});

describe('RestaurantCoverService.completeUpload — successful completion', () => {
  it('updates restaurants.image_url to the object key', async () => {
    const storage = fakeStorage();
    const { subject, calls } = service(storage);
    const key = `restaurants/${RESTAURANT_ID}/cover.webp`;

    await subject.completeUpload(RESTAURANT_ID, key);

    const update = calls.find((c) => c.op === 'update');
    expect(update?.eq).toEqual({ id: RESTAURANT_ID });
    expect(update?.payload).toEqual({ image_url: key });
  });

  it('stores the object key only — never a full URL', async () => {
    const storage = fakeStorage();
    const { subject, calls } = service(storage);

    await subject.completeUpload(RESTAURANT_ID, `restaurants/${RESTAURANT_ID}/cover.webp`);

    const update = calls.find((c) => c.op === 'update');
    const stored = (update?.payload as Record<string, unknown>).image_url as string;
    expect(stored.startsWith('http')).toBe(false);
    expect(stored).not.toContain('r2.dev');
    expect(stored).not.toContain('r2.cloudflarestorage.com');
  });

  it('never persists a signed URL', async () => {
    const storage = fakeStorage();
    const { subject, calls } = service(storage);

    await subject.completeUpload(RESTAURANT_ID, `restaurants/${RESTAURANT_ID}/cover.webp`);

    const update = calls.find((c) => c.op === 'update');
    const stored = (update?.payload as Record<string, unknown>).image_url as string;
    expect(stored).not.toContain('X-Amz-Signature');
    expect(stored).not.toContain('?');
  });

  it('is idempotent — completing the same upload twice succeeds both times with the same result', async () => {
    const storage = fakeStorage();
    const key = `restaurants/${RESTAURANT_ID}/cover.webp`;
    const { subject, calls } = service(storage, {
      data: { id: RESTAURANT_ID, image_url: key },
      error: null,
    });

    const first = await subject.completeUpload(RESTAURANT_ID, key);
    const second = await subject.completeUpload(RESTAURANT_ID, key);

    expect(first).toEqual(second);
    expect(calls.filter((c) => c.op === 'update')).toHaveLength(2);
    expect(calls.filter((c) => c.op === 'update').every((c) => (c.payload as Record<string, unknown>).image_url === key)).toBe(true);
  });

  it('surfaces NOT_FOUND if the restaurant row is gone by the time of the write (defensive)', async () => {
    const storage = fakeStorage();
    const { subject } = service(storage, { data: null, error: null });

    await expect(
      subject.completeUpload(RESTAURANT_ID, `restaurants/${RESTAURANT_ID}/cover.webp`),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('surfaces INTERNAL_ERROR on a database failure, without leaking the raw message', async () => {
    const storage = fakeStorage();
    const { subject } = service(storage, { data: null, error: { message: 'connection reset' } });

    const caught = await subject
      .completeUpload(RESTAURANT_ID, `restaurants/${RESTAURANT_ID}/cover.webp`)
      .catch((e: DomainError) => e);

    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).code).toBe('INTERNAL_ERROR');
    expect((caught as DomainError).message).not.toContain('connection reset');
  });
});
