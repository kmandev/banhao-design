import { RiderLocationService } from './rider-location.service';
import { RiderController } from './rider.controller';
import { DomainError } from '../../common/errors/domain-error';
import type { OfferAcceptanceService } from './offer-acceptance.service';
import type { DeliveryReleaseService } from './delivery-release.service';
import type { DeliveryArrivalService } from './delivery-arrival.service';
import type { AuthenticatedUser } from '../../common/types';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * `POST /api/v1/rider/location` — the minimum write path DEC-037's
 * "valid recorded location" needs, and nothing more.
 *
 * The privacy claims in `RiderLocationService`'s doc comment are asserted here
 * rather than trusted: exactly one table, exactly three columns, no history
 * row, and no rider id accepted from the caller.
 */

type Result = { data: unknown; error: { message: string; code?: string } | null };

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update';
  eq: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

function supabaseStub(results: Result[]) {
  const calls: Recorded[] = [];
  let index = 0;
  const nextResult = (): Result => results[index++] ?? { data: null, error: null };

  const admin = {
    from(table: string) {
      const call: Recorded = { table, op: 'select', eq: {} };
      calls.push(call);

      const builder: Record<string, unknown> = {
        select: () => builder,
        insert(payload: Record<string, unknown>) {
          call.op = 'insert';
          call.payload = payload;
          return builder;
        },
        update(payload: Record<string, unknown>) {
          call.op = 'update';
          call.payload = payload;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.eq[column] = value;
          return builder;
        },
        maybeSingle: () => Promise.resolve(nextResult()),
        returns: () => Promise.resolve(nextResult()),
        then: (resolve: (r: Result) => unknown) => Promise.resolve(nextResult()).then(resolve),
      };

      return builder;
    },
  };

  return { supabase: { admin } as unknown as SupabaseService, calls };
}

const RIDER_ID = 'rider-1';
const OTHER_RIDER_ID = 'rider-2';
const BUNTHARIK = { lat: 14.7802, lng: 105.4321 };

const EXISTING_ROW: Result = {
  data: { rider_id: RIDER_ID, location_updated_at: '2026-08-24T10:00:00.000Z' },
  error: null,
};
const NO_ROW: Result = { data: null, error: null };

function riderUser(riderId: string): AuthenticatedUser {
  return {
    id: 'user-1',
    phone: '+66812345678',
    capabilities: {
      customer: true,
      merchant: [],
      rider: { riderId },
      platformStaff: null,
    },
  };
}

describe('RiderLocationService.updateLocation', () => {
  it('writes the rider\'s own coordinates and stamps location_updated_at', async () => {
    const { supabase, calls } = supabaseStub([EXISTING_ROW]);

    const result = await new RiderLocationService(supabase).updateLocation(RIDER_ID, BUNTHARIK);

    expect(result.riderId).toBe(RIDER_ID);
    expect(Date.parse(result.locationUpdatedAt)).not.toBeNaN();

    const write = calls.find((c) => c.table === 'rider_availability' && c.op === 'update');
    expect(write?.payload).toEqual({
      last_lat: BUNTHARIK.lat,
      last_lng: BUNTHARIK.lng,
      location_updated_at: result.locationUpdatedAt,
    });
    expect(write?.eq).toEqual({ rider_id: RIDER_ID });
  });

  it('never writes the generated `location` column — Postgres derives the point, and therefore eligibility, from the pair', async () => {
    const { supabase, calls } = supabaseStub([EXISTING_ROW]);

    await new RiderLocationService(supabase).updateLocation(RIDER_ID, BUNTHARIK);

    for (const call of calls) {
      expect(Object.keys(call.payload ?? {})).not.toContain('location');
    }
    // Both halves are always written together: a lone coordinate would leave
    // the generated column null and the rider silently undispatchable.
    const write = calls.find((c) => c.op === 'update');
    expect(write?.payload).toHaveProperty('last_lat');
    expect(write?.payload).toHaveProperty('last_lng');
  });

  it('creates no location history: one table, one row, no append log of any kind', async () => {
    const { supabase, calls } = supabaseStub([EXISTING_ROW]);

    await new RiderLocationService(supabase).updateLocation(RIDER_ID, BUNTHARIK);

    expect([...new Set(calls.map((c) => c.table))]).toEqual(['rider_availability']);
    expect(calls).toHaveLength(1);
  });

  it('scopes the write to the caller\'s own row, so one rider can never move another', async () => {
    const other = supabaseStub([EXISTING_ROW]);

    await new RiderLocationService(other.supabase).updateLocation(OTHER_RIDER_ID, BUNTHARIK);

    const write = other.calls.find((c) => c.op === 'update');
    expect(write?.eq).toEqual({ rider_id: OTHER_RIDER_ID });
    // The id is the WHERE clause and is never part of the written payload.
    expect(Object.keys(write?.payload ?? {})).not.toContain('rider_id');
  });

  it('a rider who has never been online gets a row created, without being marked online', async () => {
    const { supabase, calls } = supabaseStub([NO_ROW, { data: null, error: null }]);

    const result = await new RiderLocationService(supabase).updateLocation(RIDER_ID, BUNTHARIK);

    expect(result.riderId).toBe(RIDER_ID);
    const insert = calls.find((c) => c.op === 'insert');
    expect(insert?.payload).toEqual({
      rider_id: RIDER_ID,
      last_lat: BUNTHARIK.lat,
      last_lng: BUNTHARIK.lng,
      location_updated_at: result.locationUpdatedAt,
    });
    // Reporting a position is not a statement of availability.
    expect(Object.keys(insert?.payload ?? {})).not.toContain('is_online');
  });

  it('a concurrent first write is absorbed as 23505 and retried as an update — the primary key is the authority', async () => {
    const { supabase, calls } = supabaseStub([
      NO_ROW,
      { data: null, error: { message: 'duplicate key value', code: '23505' } },
      EXISTING_ROW,
    ]);

    const result = await new RiderLocationService(supabase).updateLocation(RIDER_ID, BUNTHARIK);

    expect(result.riderId).toBe(RIDER_ID);
    expect(calls.filter((c) => c.op === 'update')).toHaveLength(2);
    // Never a SELECT to decide which branch to take.
    expect(calls.filter((c) => c.op === 'select')).toHaveLength(0);
  });

  it('a failed write is reported as INTERNAL_ERROR, never as a silent success', async () => {
    const { supabase } = supabaseStub([{ data: null, error: { message: 'connection reset' } }]);
    const service = new RiderLocationService(supabase);

    await expect(service.updateLocation(RIDER_ID, BUNTHARIK)).rejects.toBeInstanceOf(DomainError);
  });
});

describe('RiderController — the location route accepts no rider identity from the caller', () => {
  const offers = {} as OfferAcceptanceService;
  const releases = {} as DeliveryReleaseService;
  const arrivals = {} as DeliveryArrivalService;

  it('passes the JWT-resolved rider id to the service, ignoring anything the body might claim', async () => {
    const updateLocation = jest.fn().mockResolvedValue({
      riderId: RIDER_ID,
      locationUpdatedAt: '2026-08-24T10:00:00.000Z',
    });
    const controller = new RiderController(
      { updateLocation } as unknown as RiderLocationService,
      offers,
      releases,
      arrivals,
    );

    await controller.updateLocation(riderUser(RIDER_ID), BUNTHARIK);

    expect(updateLocation).toHaveBeenCalledWith(RIDER_ID, BUNTHARIK);
  });

  it('rejects a body that tries to name a rider — the schema is strict, so it never reaches the service', async () => {
    const updateLocation = jest.fn();
    const controller = new RiderController(
      { updateLocation } as unknown as RiderLocationService,
      offers,
      releases,
      arrivals,
    );

    await expect(
      controller.updateLocation(riderUser(RIDER_ID), { ...BUNTHARIK, riderId: OTHER_RIDER_ID }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(updateLocation).not.toHaveBeenCalled();
  });

  it('rejects a half coordinate pair, which would leave the rider undispatchable', async () => {
    const updateLocation = jest.fn();
    const controller = new RiderController(
      { updateLocation } as unknown as RiderLocationService,
      offers,
      releases,
      arrivals,
    );

    await expect(
      controller.updateLocation(riderUser(RIDER_ID), { lat: BUNTHARIK.lat }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(updateLocation).not.toHaveBeenCalled();
  });
});
