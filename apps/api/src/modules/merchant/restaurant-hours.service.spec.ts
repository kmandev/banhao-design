import { Logger } from '@nestjs/common';
import { RestaurantHoursService, groupByDay } from './restaurant-hours.service';
import { DomainError } from '../../common/errors/domain-error';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * M-12 — the weekly schedule write.
 *
 * `SupabaseService` is stubbed: what matters here is the *call this service
 * builds*, not PostgREST. The database half — atomicity, the CHECK
 * constraints, day 0 round-tripping — is proven by execution against real
 * Postgres in `supabase/tests/merchant_catalog_write_test.sql`, which is
 * where those belong.
 */

const RESTAURANT_ID = '11111111-1111-4111-8111-111111111111';

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

function fakeSupabase(result: { data: unknown; error: { message: string } | null }): {
  service: SupabaseService;
  calls: RpcCall[];
} {
  const calls: RpcCall[] = [];
  const service = {
    admin: {
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return Promise.resolve(result);
      },
    },
  } as unknown as SupabaseService;

  return { service, calls };
}

/** What `replace_restaurant_hours` returns: flat rows, `HH:MM:SS` from a `time` column. */
function storedRows(rows: [number, string, string][]) {
  return rows.map(([day_of_week, opens_at, closes_at]) => ({ day_of_week, opens_at, closes_at }));
}

describe('RestaurantHoursService.replaceHours', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calls replace_restaurant_hours — never a bare delete and insert', async () => {
    // The whole reason the function exists (M-12 §11 C-02): outside one
    // transaction a failure between the two leaves a restaurant with no hours,
    // which the derived open/closed reads as permanently closed.
    const { service, calls } = fakeSupabase({ data: storedRows([[1, '08:00:00', '20:00:00']]), error: null });

    await new RestaurantHoursService(service).replaceHours(RESTAURANT_ID, {
      days: [{ dayOfWeek: 1, intervals: [{ opensAt: '08:00', closesAt: '20:00' }] }],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.fn).toBe('replace_restaurant_hours');
  });

  it('flattens the week to one row per interval, preserving a split shift', async () => {
    const { service, calls } = fakeSupabase({ data: storedRows([]), error: null });

    await new RestaurantHoursService(service).replaceHours(RESTAURANT_ID, {
      days: [
        { dayOfWeek: 1, intervals: [{ opensAt: '08:00', closesAt: '20:00' }] },
        {
          dayOfWeek: 6,
          intervals: [
            { opensAt: '07:00', closesAt: '13:00' },
            { opensAt: '16:00', closesAt: '20:00' },
          ],
        },
      ],
    });

    expect(calls[0]?.args).toEqual({
      p_restaurant_id: RESTAURANT_ID,
      p_hours: [
        { dayOfWeek: 1, opensAt: '08:00', closesAt: '20:00' },
        { dayOfWeek: 6, opensAt: '07:00', closesAt: '13:00' },
        { dayOfWeek: 6, opensAt: '16:00', closesAt: '20:00' },
      ],
    });
  });

  it('sends no rows for a closed day — absence is the whole representation', async () => {
    const { service, calls } = fakeSupabase({ data: storedRows([]), error: null });

    await new RestaurantHoursService(service).replaceHours(RESTAURANT_ID, {
      days: [
        { dayOfWeek: 0, intervals: [] },
        { dayOfWeek: 1, intervals: [] },
      ],
    });

    expect(calls[0]?.args.p_hours).toEqual([]);
  });

  it('sends the times verbatim — no Date is constructed anywhere in this path', async () => {
    // A `Date` here is how a server, CI or browser timezone silently shifts a
    // schedule. `opens_at` is a wall-clock `time` column and needs none.
    const { service, calls } = fakeSupabase({ data: storedRows([]), error: null });

    await new RestaurantHoursService(service).replaceHours(RESTAURANT_ID, {
      days: [{ dayOfWeek: 3, intervals: [{ opensAt: '00:00', closesAt: '23:59' }] }],
    });

    expect(calls[0]?.args.p_hours).toEqual([
      { dayOfWeek: 3, opensAt: '00:00', closesAt: '23:59' },
    ]);
  });

  it('returns the week the database reports, not an echo of the request', async () => {
    // M-12 S4: "The saved week is re-read rather than assumed."
    const { service } = fakeSupabase({
      data: storedRows([
        [6, '16:00:00', '20:00:00'],
        [0, '09:00:00', '12:00:00'],
        [6, '07:00:00', '13:00:00'],
      ]),
      error: null,
    });

    const result = await new RestaurantHoursService(service).replaceHours(RESTAURANT_ID, {
      days: [],
    });

    expect(result).toEqual({
      restaurantId: RESTAURANT_ID,
      days: [
        { dayOfWeek: 0, intervals: [{ opensAt: '09:00', closesAt: '12:00' }] },
        {
          dayOfWeek: 6,
          intervals: [
            { opensAt: '07:00', closesAt: '13:00' },
            { opensAt: '16:00', closesAt: '20:00' },
          ],
        },
      ],
    });
  });

  describe('server-side validation — the client is never trusted', () => {
    it.each([
      { label: 'an overnight span', intervals: [{ opensAt: '18:00', closesAt: '02:00' }] },
      { label: 'equal times', intervals: [{ opensAt: '08:00', closesAt: '08:00' }] },
      {
        label: 'overlapping intervals',
        intervals: [
          { opensAt: '08:00', closesAt: '14:00' },
          { opensAt: '12:00', closesAt: '20:00' },
        ],
      },
      {
        label: 'a duplicate interval',
        intervals: [
          { opensAt: '08:00', closesAt: '20:00' },
          { opensAt: '08:00', closesAt: '20:00' },
        ],
      },
    ])('rejects $label before any write reaches the database', async ({ intervals }) => {
      const { service, calls } = fakeSupabase({ data: storedRows([]), error: null });

      await expect(
        new RestaurantHoursService(service).replaceHours(RESTAURANT_ID, {
          days: [{ dayOfWeek: 5, intervals }],
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

      expect(calls).toEqual([]);
    });

    it('names the offending day and interval, so a field can take focus', async () => {
      const { service } = fakeSupabase({ data: storedRows([]), error: null });

      const error = await new RestaurantHoursService(service)
        .replaceHours(RESTAURANT_ID, {
          days: [
            { dayOfWeek: 1, intervals: [{ opensAt: '08:00', closesAt: '20:00' }] },
            {
              dayOfWeek: 6,
              intervals: [
                { opensAt: '07:00', closesAt: '13:00' },
                { opensAt: '20:00', closesAt: '16:00' },
              ],
            },
          ],
        })
        .catch((thrown: unknown) => thrown as DomainError);

      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).details).toEqual({
        intervals: [{ dayOfWeek: 6, intervalIndex: 1, code: 'OVERNIGHT_UNSUPPORTED' }],
      });
    });
  });

  it('does not leak the database error to the caller', async () => {
    const { service } = fakeSupabase({ data: null, error: { message: 'pg: relation r_hours' } });

    const error = await new RestaurantHoursService(service)
      .replaceHours(RESTAURANT_ID, { days: [] })
      .catch((thrown: unknown) => thrown as DomainError);

    expect((error as DomainError).code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(error)).not.toContain('r_hours');
  });
});

describe('groupByDay', () => {
  it('orders days ascending and intervals by opening time', () => {
    expect(
      groupByDay([
        { day_of_week: 6, opens_at: '16:00:00', closes_at: '20:00:00' },
        { day_of_week: 0, opens_at: '09:00:00', closes_at: '12:00:00' },
        { day_of_week: 6, opens_at: '07:00:00', closes_at: '13:00:00' },
      ]),
    ).toEqual([
      { dayOfWeek: 0, intervals: [{ opensAt: '09:00', closesAt: '12:00' }] },
      {
        dayOfWeek: 6,
        intervals: [
          { opensAt: '07:00', closesAt: '13:00' },
          { opensAt: '16:00', closesAt: '20:00' },
        ],
      },
    ]);
  });

  it('omits a day with no rows rather than inventing an empty entry', () => {
    // The absence IS the closed state. Emitting `{ dayOfWeek: 2, intervals: [] }`
    // would blur that back into a flag the schema does not have.
    expect(groupByDay([{ day_of_week: 1, opens_at: '08:00:00', closes_at: '20:00:00' }])).toEqual([
      { dayOfWeek: 1, intervals: [{ opensAt: '08:00', closesAt: '20:00' }] },
    ]);
  });

  it('returns nothing for a restaurant with no hours at all', () => {
    expect(groupByDay([])).toEqual([]);
  });
});
