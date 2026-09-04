import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApiClient } from '@banhao/api-client';
import { createMerchantAvailabilityRepository } from './merchantAvailability';

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
  availability_mode: 'NORMAL' as const,
  busy_prep_minutes: null,
  updated_at: '2026-09-04T00:00:00.000Z',
};

describe('merchantAvailability — read (M-13)', () => {
  it('reads availability_mode/busy_prep_minutes scoped by id, under RLS — no endpoint needed', async () => {
    const { client, calls } = supabaseStub({ data: ROW, error: null });
    const api = { request: jest.fn() } as unknown as ApiClient;

    const result = await createMerchantAvailabilityRepository(client, api).getAvailability('rest-1');

    expect(calls[0]?.table).toBe('restaurants');
    expect(calls[0]?.eq).toEqual({ id: 'rest-1' });
    expect(calls[0]?.select[0]).toContain('availability_mode');
    expect(calls[0]?.select[0]).toContain('busy_prep_minutes');
    expect(result).toEqual(ROW);
  });

  it('throws when Supabase reports an error — never silently returns a fabricated NORMAL row', async () => {
    const { client } = supabaseStub({ data: null, error: { message: 'boom' } });
    const api = { request: jest.fn() } as unknown as ApiClient;

    await expect(
      createMerchantAvailabilityRepository(client, api).getAvailability('rest-1'),
    ).rejects.toThrow('boom');
  });
});

describe('merchantAvailability — write (M-13)', () => {
  it('PUTs a NORMAL/PAUSED body with no busyPrepMinutes to the restaurant-scoped route', async () => {
    const calls: { path: string; init: RequestInit }[] = [];
    const api = {
      request: (path: string, init: RequestInit = {}) => {
        calls.push({ path, init });
        return Promise.resolve({
          restaurantId: 'rest-1',
          availabilityMode: 'PAUSED',
          busyPrepMinutes: null,
          updatedAt: '2026-09-04T00:00:00.000Z',
        });
      },
    } as unknown as ApiClient;

    await createMerchantAvailabilityRepository({} as SupabaseClient, api).setAvailability('rest-1', {
      mode: 'PAUSED',
    });

    expect(calls[0]?.path).toBe('/api/v1/merchant/restaurants/rest-1/availability');
    expect(calls[0]?.init.method).toBe('PUT');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ mode: 'PAUSED' });
  });

  it('PUTs a BUSY body carrying busyPrepMinutes', async () => {
    const calls: { path: string; init: RequestInit }[] = [];
    const api = {
      request: (path: string, init: RequestInit = {}) => {
        calls.push({ path, init });
        return Promise.resolve({
          restaurantId: 'rest-1',
          availabilityMode: 'BUSY',
          busyPrepMinutes: 30,
          updatedAt: '2026-09-04T00:00:00.000Z',
        });
      },
    } as unknown as ApiClient;

    await createMerchantAvailabilityRepository({} as SupabaseClient, api).setAvailability('rest-1', {
      mode: 'BUSY',
      busyPrepMinutes: 30,
    });

    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ mode: 'BUSY', busyPrepMinutes: 30 });
  });

  it('returns the server-confirmed response, not an echo of the request', async () => {
    const api = {
      request: () =>
        Promise.resolve({
          restaurantId: 'rest-1',
          availabilityMode: 'BUSY',
          busyPrepMinutes: 45,
          updatedAt: '2026-09-04T01:00:00.000Z',
        }),
    } as unknown as ApiClient;

    const result = await createMerchantAvailabilityRepository({} as SupabaseClient, api).setAvailability(
      'rest-1',
      { mode: 'BUSY', busyPrepMinutes: 30 },
    );

    // The response's busyPrepMinutes (45) is what is returned, not the
    // request's (30) — the server-read pattern every M-10/M-12/M-13 write
    // shares.
    expect(result.busyPrepMinutes).toBe(45);
  });
});
