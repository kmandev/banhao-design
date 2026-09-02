import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApiClient } from '@banhao/api-client';
import { createMerchantProfileRepository } from './merchantProfile';

function supabaseStub(result: { data: unknown; error: { message: string } | null }) {
  const calls: { table: string; select: string[]; eq: Record<string, unknown> }[] = [];

  const client = {
    from(table: string) {
      const call = { table, select: [] as string[], eq: {} as Record<string, unknown> };
      calls.push(call);
      const builder = {
        select(columns: string) {
          call.select.push(columns);
          return builder;
        },
        eq(column: string, value: unknown) {
          call.eq[column] = value;
          return builder;
        },
        single() {
          return Promise.resolve(result);
        },
      };
      return builder;
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

const ROW = {
  id: 'rest-1',
  name: 'ร้านตามสั่งป้าสมร',
  description: null,
  cuisine: null,
  phone: null,
  address_line: null,
  image_url: null,
  status: 'ACTIVE',
  lat: null,
  lng: null,
  updated_at: '2026-09-02T00:00:00.000Z',
};

describe('merchantProfile — read', () => {
  it('reads the restaurant row scoped by id, under RLS', async () => {
    const { client, calls } = supabaseStub({ data: ROW, error: null });
    const api = { request: jest.fn() } as unknown as ApiClient;

    const result = await createMerchantProfileRepository(client, api).getProfile('rest-1');

    expect(calls[0]?.table).toBe('restaurants');
    expect(calls[0]?.eq).toEqual({ id: 'rest-1' });
    expect(result).toEqual(ROW);
  });
});

describe('merchantProfile — write', () => {
  it('PUTs the whole editable field set to the restaurant-scoped route', async () => {
    const calls: { path: string; init: RequestInit }[] = [];
    const api = {
      request: (path: string, init: RequestInit = {}) => {
        calls.push({ path, init });
        return Promise.resolve({
          restaurantId: 'rest-1',
          name: 'ร้าน',
          description: null,
          phone: null,
          addressLine: null,
          updatedAt: '2026-09-02T00:00:00.000Z',
        });
      },
    } as unknown as ApiClient;

    const input = { name: 'ร้าน', description: '', phone: '', addressLine: '' };
    await createMerchantProfileRepository({} as SupabaseClient, api).saveProfile('rest-1', input);

    expect(calls[0]?.path).toBe('/api/v1/merchant/restaurants/rest-1/profile');
    expect(calls[0]?.init.method).toBe('PUT');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(input);
  });
});

describe('merchantProfile — cover photo (existing M-11 flow, reused exactly)', () => {
  it('requestCoverUpload POSTs to the existing upload-url route', async () => {
    const calls: { path: string; init: RequestInit }[] = [];
    const api = {
      request: (path: string, init: RequestInit = {}) => {
        calls.push({ path, init });
        return Promise.resolve({ uploadUrl: 'https://r2.example/put', objectKey: 'restaurants/rest-1/cover.webp' });
      },
    } as unknown as ApiClient;

    await createMerchantProfileRepository({} as SupabaseClient, api).requestCoverUpload(
      'rest-1',
      'image/webp',
    );

    expect(calls[0]?.path).toBe('/api/v1/merchant/restaurants/rest-1/cover/upload-url');
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ contentType: 'image/webp' });
  });

  it('completeCoverUpload POSTs to the existing complete route', async () => {
    const calls: { path: string; init: RequestInit }[] = [];
    const api = {
      request: (path: string, init: RequestInit = {}) => {
        calls.push({ path, init });
        return Promise.resolve({ imageUrl: 'restaurants/rest-1/cover.webp' });
      },
    } as unknown as ApiClient;

    await createMerchantProfileRepository({} as SupabaseClient, api).completeCoverUpload(
      'rest-1',
      'restaurants/rest-1/cover.webp',
    );

    expect(calls[0]?.path).toBe('/api/v1/merchant/restaurants/rest-1/cover/complete');
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      objectKey: 'restaurants/rest-1/cover.webp',
    });
  });

  it('introduces no second upload mechanism — no other route is ever called', async () => {
    const paths: string[] = [];
    const api = {
      request: (path: string) => {
        paths.push(path);
        return Promise.resolve({ uploadUrl: 'x', objectKey: 'x', imageUrl: 'x' });
      },
    } as unknown as ApiClient;

    const repo = createMerchantProfileRepository({} as SupabaseClient, api);
    await repo.requestCoverUpload('rest-1', 'image/jpeg');
    await repo.completeCoverUpload('rest-1', 'restaurants/rest-1/cover.jpg');

    for (const path of paths) {
      expect(path).toMatch(/\/cover\/(upload-url|complete)$/);
    }
  });
});
