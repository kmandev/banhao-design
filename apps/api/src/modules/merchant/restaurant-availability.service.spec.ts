import { Logger } from '@nestjs/common';
import { RestaurantAvailabilityService } from './restaurant-availability.service';
import { DomainError } from '../../common/errors/domain-error';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * M-13 — the merchant availability mode write path.
 *
 * `SupabaseService` is stubbed with an in-memory `restaurants` row and an
 * `audit_logs` insert log, so what is asserted is the guard, the pairing and
 * the audit shape this service builds — not PostgREST itself. The stub
 * mirrors the real chain shapes exactly: `select().eq().maybeSingle()` for a
 * read, `update().eq().in().select().maybeSingle()` for the guarded write
 * (ADR-003 — the transition guard rides in the same `WHERE`, via `.in()`),
 * and a bare awaited `insert()` for the audit row, matching `AiAuditService`'s
 * own established shape.
 */

const RESTAURANT_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';

interface Row {
  id: string;
  availability_mode: 'NORMAL' | 'BUSY' | 'PAUSED';
  busy_prep_minutes: number | null;
  updated_at: string;
}

interface AuditInsert {
  actor_type: string;
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before: unknown;
  after: unknown;
  reason: unknown;
  source: string;
}

interface UpdateCall {
  patch: Record<string, unknown>;
  allowedFrom: string[];
}

function fakeSupabase(initialRow: Row | null): {
  service: SupabaseService;
  updateCalls: UpdateCall[];
  auditInserts: AuditInsert[];
} {
  let row: Row | null = initialRow;
  const updateCalls: UpdateCall[] = [];
  const auditInserts: AuditInsert[] = [];

  const service = {
    admin: {
      from: (table: string) => {
        if (table === 'audit_logs') {
          return {
            insert: (payload: AuditInsert) => {
              auditInserts.push(payload);
              return Promise.resolve({ error: null });
            },
          };
        }

        // 'restaurants'
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: row, error: null }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: () => ({
              in: (_column: string, allowedFrom: string[]) => {
                updateCalls.push({ patch, allowedFrom });
                return {
                  select: () => ({
                    maybeSingle: () => {
                      if (row && allowedFrom.includes(row.availability_mode)) {
                        row = {
                          ...row,
                          availability_mode: patch.availability_mode as Row['availability_mode'],
                          busy_prep_minutes: patch.busy_prep_minutes as number | null,
                          updated_at: '2026-09-04T00:00:00.000Z',
                        };
                        return Promise.resolve({ data: row, error: null });
                      }
                      // The guard matched 0 rows.
                      return Promise.resolve({ data: null, error: null });
                    },
                  }),
                };
              },
            }),
          }),
        };
      },
    },
  } as unknown as SupabaseService;

  return { service, updateCalls, auditInserts };
}

const NORMAL_ROW: Row = {
  id: RESTAURANT_ID,
  availability_mode: 'NORMAL',
  busy_prep_minutes: null,
  updated_at: '2026-09-01T00:00:00.000Z',
};

describe('RestaurantAvailabilityService.setAvailability', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('NORMAL -> BUSY: writes both columns and records one MERCHANT audit row', async () => {
    const { service, updateCalls, auditInserts } = fakeSupabase(NORMAL_ROW);

    const result = await new RestaurantAvailabilityService(service).setAvailability(
      RESTAURANT_ID,
      ACTOR_ID,
      { mode: 'BUSY', busyPrepMinutes: 20 },
    );

    expect(result).toEqual({
      restaurantId: RESTAURANT_ID,
      availabilityMode: 'BUSY',
      busyPrepMinutes: 20,
      updatedAt: '2026-09-04T00:00:00.000Z',
    });
    expect(updateCalls[0]?.patch).toEqual({ availability_mode: 'BUSY', busy_prep_minutes: 20 });
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]).toMatchObject({
      actor_type: 'MERCHANT',
      actor_id: ACTOR_ID,
      action: 'MerchantAvailabilityChanged',
      entity_type: 'restaurant',
      entity_id: RESTAURANT_ID,
      before: { availabilityMode: 'NORMAL', busyPrepMinutes: null },
      after: { availabilityMode: 'BUSY', busyPrepMinutes: 20 },
      source: 'api',
    });
  });

  it('never writes availability_set_by or any column beyond availability_mode/busy_prep_minutes', async () => {
    const { service, updateCalls } = fakeSupabase(NORMAL_ROW);

    await new RestaurantAvailabilityService(service).setAvailability(RESTAURANT_ID, ACTOR_ID, {
      mode: 'BUSY',
      busyPrepMinutes: 30,
    });

    expect(Object.keys(updateCalls[0]?.patch ?? {}).sort()).toEqual([
      'availability_mode',
      'busy_prep_minutes',
    ]);
  });

  it('NORMAL -> PAUSED: writes no timestamp, no reason — indefinite, no sentinel', async () => {
    const { service, updateCalls } = fakeSupabase(NORMAL_ROW);

    await new RestaurantAvailabilityService(service).setAvailability(RESTAURANT_ID, ACTOR_ID, {
      mode: 'PAUSED',
    });

    expect(updateCalls[0]?.patch).toEqual({ availability_mode: 'PAUSED', busy_prep_minutes: null });
  });

  it('BUSY -> NORMAL: allowed, clears busy_prep_minutes', async () => {
    const { service } = fakeSupabase({ ...NORMAL_ROW, availability_mode: 'BUSY', busy_prep_minutes: 45 });

    const result = await new RestaurantAvailabilityService(service).setAvailability(
      RESTAURANT_ID,
      ACTOR_ID,
      { mode: 'NORMAL' },
    );

    expect(result.availabilityMode).toBe('NORMAL');
    expect(result.busyPrepMinutes).toBeNull();
  });

  it('PAUSED -> NORMAL: allowed (resume)', async () => {
    const { service } = fakeSupabase({ ...NORMAL_ROW, availability_mode: 'PAUSED', busy_prep_minutes: null });

    const result = await new RestaurantAvailabilityService(service).setAvailability(
      RESTAURANT_ID,
      ACTOR_ID,
      { mode: 'NORMAL' },
    );

    expect(result.availabilityMode).toBe('NORMAL');
  });

  it('PAUSED -> BUSY: rejected with INVALID_TRANSITION — resume must go through NORMAL first', async () => {
    const { service, updateCalls } = fakeSupabase({
      ...NORMAL_ROW,
      availability_mode: 'PAUSED',
      busy_prep_minutes: null,
    });

    const error = await new RestaurantAvailabilityService(service)
      .setAvailability(RESTAURANT_ID, ACTOR_ID, { mode: 'BUSY', busyPrepMinutes: 20 })
      .catch((thrown: unknown) => thrown as DomainError);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('INVALID_TRANSITION');
    // Never reaches the database at all — rejected before the guarded UPDATE.
    expect(updateCalls).toHaveLength(0);
  });

  it('idempotent: an identical mode change (same mode, same minutes) is a no-op — no UPDATE, no audit row (AC-12)', async () => {
    const { service, updateCalls, auditInserts } = fakeSupabase({
      ...NORMAL_ROW,
      availability_mode: 'BUSY',
      busy_prep_minutes: 30,
    });

    const result = await new RestaurantAvailabilityService(service).setAvailability(
      RESTAURANT_ID,
      ACTOR_ID,
      { mode: 'BUSY', busyPrepMinutes: 30 },
    );

    expect(result).toEqual({
      restaurantId: RESTAURANT_ID,
      availabilityMode: 'BUSY',
      busyPrepMinutes: 30,
      updatedAt: NORMAL_ROW.updated_at,
    });
    expect(updateCalls).toHaveLength(0);
    expect(auditInserts).toHaveLength(0);
  });

  it('idempotent: repeated PAUSED is a no-op (AC-12)', async () => {
    const { service, updateCalls, auditInserts } = fakeSupabase({
      ...NORMAL_ROW,
      availability_mode: 'PAUSED',
      busy_prep_minutes: null,
    });

    await new RestaurantAvailabilityService(service).setAvailability(RESTAURANT_ID, ACTOR_ID, {
      mode: 'PAUSED',
    });

    expect(updateCalls).toHaveLength(0);
    expect(auditInserts).toHaveLength(0);
  });

  it('re-selecting a different busy value while already Busy is allowed (not idempotent, not a status round trip)', async () => {
    const { service, updateCalls } = fakeSupabase({
      ...NORMAL_ROW,
      availability_mode: 'BUSY',
      busy_prep_minutes: 20,
    });

    const result = await new RestaurantAvailabilityService(service).setAvailability(
      RESTAURANT_ID,
      ACTOR_ID,
      { mode: 'BUSY', busyPrepMinutes: 45 },
    );

    expect(result.busyPrepMinutes).toBe(45);
    expect(updateCalls).toHaveLength(1);
  });

  it('throws NOT_FOUND when the restaurant does not exist', async () => {
    const { service } = fakeSupabase(null);

    const error = await new RestaurantAvailabilityService(service)
      .setAvailability(RESTAURANT_ID, ACTOR_ID, { mode: 'PAUSED' })
      .catch((thrown: unknown) => thrown as DomainError);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('NOT_FOUND');
  });

  it('a failed audit write never fails the caller — the mode change already committed', async () => {
    // A dedicated fake whose restaurants chain works but whose audit insert
    // fails, matching AiAuditService's own never-throws contract.
    let row: Row | null = NORMAL_ROW;
    const failingService = {
      admin: {
        from: (table: string) => {
          if (table === 'audit_logs') {
            return { insert: () => Promise.resolve({ error: { message: 'boom' } }) };
          }
          return {
            select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: row, error: null }) }) }),
            update: (patch: Record<string, unknown>) => ({
              eq: () => ({
                in: () => ({
                  select: () => ({
                    maybeSingle: () => {
                      row = {
                        ...(row as Row),
                        availability_mode: patch.availability_mode as Row['availability_mode'],
                        busy_prep_minutes: patch.busy_prep_minutes as number | null,
                        updated_at: '2026-09-04T00:00:00.000Z',
                      };
                      return Promise.resolve({ data: row, error: null });
                    },
                  }),
                }),
              }),
            }),
          };
        },
      },
    } as unknown as SupabaseService;

    const result = await new RestaurantAvailabilityService(failingService).setAvailability(
      RESTAURANT_ID,
      ACTOR_ID,
      { mode: 'PAUSED' },
    );

    expect(result.availabilityMode).toBe('PAUSED');
  });
});
