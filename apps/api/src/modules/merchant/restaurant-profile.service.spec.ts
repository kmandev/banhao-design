import { Logger } from '@nestjs/common';
import { RestaurantProfileService } from './restaurant-profile.service';
import { DomainError } from '../../common/errors/domain-error';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * M-10 — the descriptive-field write.
 *
 * `SupabaseService` is stubbed: what matters here is the *update this service
 * builds* — which columns, which table, which filter — not PostgREST itself.
 */

const RESTAURANT_ID = '11111111-1111-4111-8111-111111111111';

interface UpdateCall {
  table: string;
  patch: Record<string, unknown>;
  eqColumn: string;
  eqValue: string;
}

function fakeSupabase(row: Record<string, unknown> | null, error: { message: string } | null = null): {
  service: SupabaseService;
  calls: UpdateCall[];
} {
  const calls: UpdateCall[] = [];

  const service = {
    admin: {
      from: (table: string) => ({
        update: (patch: Record<string, unknown>) => ({
          eq: (eqColumn: string, eqValue: string) => {
            calls.push({ table, patch, eqColumn, eqValue });
            return {
              select: () => ({
                maybeSingle: () => Promise.resolve({ data: row, error }),
              }),
            };
          },
        }),
      }),
    },
  } as unknown as SupabaseService;

  return { service, calls };
}

const INPUT = {
  name: 'ร้านตามสั่งป้าสมร',
  description: 'ร้านก๋วยเตี๋ยวเรือและอาหารไทยตามสั่ง',
  phone: '081-234-5678',
  addressLine: '123 ถ.สถลมาร์ค',
};

const STORED_ROW = {
  id: RESTAURANT_ID,
  name: INPUT.name,
  description: INPUT.description,
  phone: INPUT.phone,
  address_line: INPUT.addressLine,
  updated_at: '2026-09-02T00:00:00.000Z',
};

describe('RestaurantProfileService.updateProfile', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('updates only name/description/phone/address_line, filtered by id', async () => {
    const { service, calls } = fakeSupabase(STORED_ROW);

    await new RestaurantProfileService(service).updateProfile(RESTAURANT_ID, INPUT);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.table).toBe('restaurants');
    expect(calls[0]?.eqColumn).toBe('id');
    expect(calls[0]?.eqValue).toBe(RESTAURANT_ID);
    expect(calls[0]?.patch).toEqual({
      name: INPUT.name,
      description: INPUT.description,
      phone: INPUT.phone,
      address_line: INPUT.addressLine,
    });
  });

  it('never includes a protected column in the update patch', async () => {
    const { service, calls } = fakeSupabase(STORED_ROW);

    await new RestaurantProfileService(service).updateProfile(RESTAURANT_ID, INPUT);

    const patchKeys = Object.keys(calls[0]?.patch ?? {});
    for (const protectedColumn of [
      'merchant_id',
      'status',
      'temporarily_closed_until',
      'temporary_close_reason',
      'lat',
      'lng',
      'location',
      'zone_id',
      'rating_avg',
      'rating_count',
      'min_order_satang',
      'service_radius_m',
      'avg_prep_minutes',
      'image_url',
      'cuisine',
      'id',
    ]) {
      expect(patchKeys).not.toContain(protectedColumn);
    }
  });

  it('maps an empty optional field to null rather than storing an empty string', async () => {
    const { service, calls } = fakeSupabase({ ...STORED_ROW, description: null, phone: null, address_line: null });

    await new RestaurantProfileService(service).updateProfile(RESTAURANT_ID, {
      name: INPUT.name,
      description: '',
      phone: '',
      addressLine: '',
    });

    expect(calls[0]?.patch).toEqual({
      name: INPUT.name,
      description: null,
      phone: null,
      address_line: null,
    });
  });

  it('returns the row re-read from the database, not an echo of the request', async () => {
    const { service } = fakeSupabase(STORED_ROW);

    const result = await new RestaurantProfileService(service).updateProfile(RESTAURANT_ID, INPUT);

    expect(result).toEqual({
      restaurantId: RESTAURANT_ID,
      name: INPUT.name,
      description: INPUT.description,
      phone: INPUT.phone,
      addressLine: INPUT.addressLine,
      updatedAt: '2026-09-02T00:00:00.000Z',
    });
  });

  it('throws NOT_FOUND when no row matches — the defensive fallback for a concurrent delete', async () => {
    const { service } = fakeSupabase(null, null);

    const error = await new RestaurantProfileService(service)
      .updateProfile(RESTAURANT_ID, INPUT)
      .catch((thrown: unknown) => thrown as DomainError);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('NOT_FOUND');
  });

  it('does not leak the database error to the caller', async () => {
    const { service } = fakeSupabase(null, { message: 'pg: relation restaurants_x' });

    const error = await new RestaurantProfileService(service)
      .updateProfile(RESTAURANT_ID, INPUT)
      .catch((thrown: unknown) => thrown as DomainError);

    expect((error as DomainError).code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(error)).not.toContain('restaurants_x');
  });
});
