import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApiClient } from '@banhao/api-client';
import { createMerchantHoursRepository } from './merchantHours';

const supabase = {} as SupabaseClient;

describe('merchantHours', () => {
  it('PUTs the whole week to the restaurant-scoped route', async () => {
    const calls: { path: string; init: RequestInit }[] = [];
    const api = {
      request: (path: string, init: RequestInit = {}) => {
        calls.push({ path, init });
        return Promise.resolve({ restaurantId: 'rest-1', days: [] });
      },
    } as unknown as ApiClient;

    const week = { days: [{ dayOfWeek: 1 as const, intervals: [{ opensAt: '08:00', closesAt: '20:00' }] }] };
    await createMerchantHoursRepository(supabase, api).saveHours('rest-1', week);

    expect(calls[0]?.path).toBe('/api/v1/merchant/restaurants/rest-1/hours');
    // PUT, because the schedule is replaced wholesale — there is no per-day
    // call and there must not be one (M12-D01).
    expect(calls[0]?.init.method).toBe('PUT');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(week);
  });

  it('exposes no per-day save', () => {
    const api = { request: () => Promise.resolve({}) } as unknown as ApiClient;
    const repository = createMerchantHoursRepository(supabase, api);

    expect(Object.keys(repository).sort()).toEqual(['listHours', 'saveHours']);
  });
});
