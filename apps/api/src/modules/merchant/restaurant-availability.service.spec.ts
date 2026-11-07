import { Logger } from '@nestjs/common';
import { RestaurantAvailabilityService, type AvailabilityActor } from './restaurant-availability.service';
import { DomainError } from '../../common/errors/domain-error';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * M-AV availability mode write path, after DEC-068 C3-A.
 *
 * The transition rules, the no-op rule and the atomic audit now live in
 * `public.set_restaurant_availability()` and are proven against real Postgres
 * in `supabase/tests/set_restaurant_availability_test.sql`. What this file
 * proves is the service's half of that contract: the exact arguments it sends
 * (actor, role, reason, source), how it maps each result, and — the point of
 * C3-A — that a database failure is reported as a failure and never swallowed.
 */

const RESTAURANT_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';

const MEMBER: AvailabilityActor = { actorType: 'MERCHANT', userId: ACTOR_ID, role: 'OWNER' };
const STAFF: AvailabilityActor = { actorType: 'OPERATOR', userId: ACTOR_ID, role: 'ADMIN', reason: 'ร้านแจ้งว่าไฟดับ' };

type RpcReply = { data: unknown; error: { message: string } | null };

function fakeSupabase(reply: RpcReply) {
  const rpc = jest.fn().mockResolvedValue(reply);
  const from = jest.fn();
  const service = { admin: { rpc, from } } as unknown as SupabaseService;
  return { service, rpc, from };
}

const CHANGED_BUSY = {
  result: 'CHANGED',
  restaurantId: RESTAURANT_ID,
  availabilityMode: 'BUSY',
  busyPrepMinutes: 20,
  updatedAt: '2026-11-07T00:00:00.000Z',
};

describe('RestaurantAvailabilityService.setAvailability', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('makes one call to the atomic function and nothing else — no separate UPDATE or audit insert', async () => {
    const { service, rpc, from } = fakeSupabase({ data: CHANGED_BUSY, error: null });

    await new RestaurantAvailabilityService(service).setAvailability(RESTAURANT_ID, MEMBER, {
      mode: 'BUSY',
      busyPrepMinutes: 20,
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[0]).toBe('set_restaurant_availability');
    // The audit row is the function's job, in its own transaction. This
    // service touching a table directly would reintroduce the two-write window.
    expect(from).not.toHaveBeenCalled();
  });

  it('sends a member change as MERCHANT with the member role and no reason', async () => {
    const { service, rpc } = fakeSupabase({ data: CHANGED_BUSY, error: null });

    await new RestaurantAvailabilityService(service).setAvailability(RESTAURANT_ID, MEMBER, {
      mode: 'BUSY',
      busyPrepMinutes: 20,
    });

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_restaurant_id: RESTAURANT_ID,
      p_mode: 'BUSY',
      p_busy_prep_minutes: 20,
      p_actor_id: ACTOR_ID,
      p_actor_type: 'MERCHANT',
      p_actor_role: 'OWNER',
      p_reason: null,
      p_source: 'api',
    });
  });

  it('sends a staff change as OPERATOR with the staff role and the reason', async () => {
    const { service, rpc } = fakeSupabase({
      data: { ...CHANGED_BUSY, availabilityMode: 'PAUSED', busyPrepMinutes: null },
      error: null,
    });

    await new RestaurantAvailabilityService(service).setAvailability(RESTAURANT_ID, STAFF, { mode: 'PAUSED' });

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_mode: 'PAUSED',
      p_busy_prep_minutes: null,
      p_actor_type: 'OPERATOR',
      p_actor_role: 'ADMIN',
      p_reason: 'ร้านแจ้งว่าไฟดับ',
    });
  });

  it('never sends busy minutes for NORMAL or PAUSED', async () => {
    const { service, rpc } = fakeSupabase({
      data: { ...CHANGED_BUSY, availabilityMode: 'NORMAL', busyPrepMinutes: null },
      error: null,
    });

    await new RestaurantAvailabilityService(service).setAvailability(RESTAURANT_ID, MEMBER, { mode: 'NORMAL' });

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_mode: 'NORMAL', p_busy_prep_minutes: null });
  });

  it('maps CHANGED to the saved availability', async () => {
    const { service } = fakeSupabase({ data: CHANGED_BUSY, error: null });

    await expect(
      new RestaurantAvailabilityService(service).setAvailability(RESTAURANT_ID, MEMBER, {
        mode: 'BUSY',
        busyPrepMinutes: 20,
      }),
    ).resolves.toEqual({
      restaurantId: RESTAURANT_ID,
      availabilityMode: 'BUSY',
      busyPrepMinutes: 20,
      updatedAt: '2026-11-07T00:00:00.000Z',
    });
  });

  it('maps NOOP to the current state, without error (AC-12)', async () => {
    const { service } = fakeSupabase({
      data: { ...CHANGED_BUSY, result: 'NOOP', availabilityMode: 'PAUSED', busyPrepMinutes: null },
      error: null,
    });

    const result = await new RestaurantAvailabilityService(service).setAvailability(RESTAURANT_ID, MEMBER, {
      mode: 'PAUSED',
    });

    expect(result.availabilityMode).toBe('PAUSED');
  });

  it('maps INVALID_TRANSITION to the 409 code, carrying the current and target mode', async () => {
    const { service } = fakeSupabase({
      data: { result: 'INVALID_TRANSITION', currentMode: 'PAUSED' },
      error: null,
    });

    const error = await new RestaurantAvailabilityService(service)
      .setAvailability(RESTAURANT_ID, MEMBER, { mode: 'BUSY', busyPrepMinutes: 20 })
      .catch((thrown: unknown) => thrown as DomainError);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('INVALID_TRANSITION');
    expect(JSON.stringify((error as DomainError).details)).toContain('PAUSED');
  });

  it('maps NOT_FOUND to NOT_FOUND', async () => {
    const { service } = fakeSupabase({ data: { result: 'NOT_FOUND' }, error: null });

    await expect(
      new RestaurantAvailabilityService(service).setAvailability(RESTAURANT_ID, MEMBER, { mode: 'PAUSED' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('FAIL-CLOSED (DEC-068 C3-A): a database error — including an unwritable audit row — is a failure, not a success', async () => {
    const { service } = fakeSupabase({
      data: null,
      error: { message: 'new row for relation "audit_logs" violates check constraint' },
    });

    const error = await new RestaurantAvailabilityService(service)
      .setAvailability(RESTAURANT_ID, MEMBER, { mode: 'PAUSED' })
      .catch((thrown: unknown) => thrown as DomainError);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('INTERNAL_ERROR');
  });

  it('treats an unrecognised function result as a failure rather than guessing success', async () => {
    const { service } = fakeSupabase({ data: { result: 'SOMETHING_NEW' }, error: null });

    await expect(
      new RestaurantAvailabilityService(service).setAvailability(RESTAURANT_ID, MEMBER, { mode: 'PAUSED' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('treats an empty function result as a failure', async () => {
    const { service } = fakeSupabase({ data: null, error: null });

    await expect(
      new RestaurantAvailabilityService(service).setAvailability(RESTAURANT_ID, MEMBER, { mode: 'PAUSED' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
