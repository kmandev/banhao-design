import { OfferAcceptanceService } from './offer-acceptance.service';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * `POST /api/v1/rider/offers/:id/accept` — DEC-020's first-accept-wins and
 * DEC-037's one-active-delivery rule.
 *
 * The stub records the filters each statement was built with, which is the
 * whole point of these tests: the invariants have to be provably IN the
 * guarded `UPDATE`s. A test that only checked the thrown error would pass
 * against a pre-check implementation that a race walks straight through.
 */

type Result = { data: unknown; error: { message: string; code?: string } | null };

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update';
  eq: Record<string, unknown>;
  in: Record<string, unknown[]>;
  is: Record<string, unknown>;
  neq: Record<string, unknown>;
  gt: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

function supabaseStub(results: Result[]) {
  const calls: Recorded[] = [];
  let index = 0;
  const nextResult = (): Result => results[index++] ?? { data: null, error: null };

  const admin = {
    from(table: string) {
      const call: Recorded = { table, op: 'select', eq: {}, in: {}, is: {}, neq: {}, gt: {} };
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
        in(column: string, values: unknown[]) {
          call.in[column] = values;
          return builder;
        },
        is(column: string, value: unknown) {
          call.is[column] = value;
          return builder;
        },
        neq(column: string, value: unknown) {
          call.neq[column] = value;
          return builder;
        },
        gt(column: string, value: unknown) {
          call.gt[column] = value;
          return builder;
        },
        not: () => builder,
        lt: () => builder,
        order: () => builder,
        limit: () => builder,
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
const OFFER_ID = 'offer-1';
const DELIVERY_ID = 'delivery-1';
const OTHER_DELIVERY_ID = 'delivery-2';

function riderUser(riderId: string | null = RIDER_ID): AuthenticatedUser {
  return {
    id: 'user-1',
    phone: '+66812345678',
    capabilities: {
      customer: true,
      merchant: [],
      rider: riderId ? { riderId } : null,
      platformStaff: null,
    },
  };
}

const LIVE_OFFER = {
  id: OFFER_ID,
  delivery_id: DELIVERY_ID,
  rider_id: RIDER_ID,
  outcome: 'PENDING',
  expires_at: new Date(Date.now() + 30_000).toISOString(),
};

const CLAIMED_SLOT = { data: { rider_id: RIDER_ID, active_delivery_count: 1 }, error: null };
const SLOT_TAKEN: Result = { data: null, error: null };
const ASSIGNED_DELIVERY = {
  data: { id: DELIVERY_ID, state: 'RIDER_ASSIGNED', rider_id: RIDER_ID },
  error: null,
};
const OK: Result = { data: null, error: null };

async function expectDomainError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await promise.catch((error: DomainError) => expect(error.code).toBe(code));
}

describe('OfferAcceptanceService — accepting an offer', () => {
  it('a rider accepts their own live offer: the delivery is claimed, the assignment recorded, the offer marked ACCEPTED', async () => {
    const { supabase, calls } = supabaseStub([
      { data: LIVE_OFFER, error: null },
      CLAIMED_SLOT,
      ASSIGNED_DELIVERY,
      OK, // rider_assignments insert
      OK, // this offer -> ACCEPTED
      OK, // siblings -> SUPERSEDED
    ]);

    const result = await new OfferAcceptanceService(supabase).acceptOffer(riderUser(), OFFER_ID);

    expect(result).toEqual({ deliveryId: DELIVERY_ID, state: 'RIDER_ASSIGNED', riderId: RIDER_ID });

    const assignment = calls.find((c) => c.table === 'rider_assignments' && c.op === 'insert');
    expect(assignment?.payload).toEqual({
      delivery_id: DELIVERY_ID,
      rider_id: RIDER_ID,
      status: 'ACCEPTED',
    });

    const offerOutcome = calls.find(
      (c) => c.table === 'rider_assignment_attempts' && c.op === 'update' && c.eq.id === OFFER_ID,
    );
    expect(offerOutcome?.payload).toEqual({ outcome: 'ACCEPTED' });
    // Guarded on PENDING, so a retry cannot rewrite a settled outcome.
    expect(offerOutcome?.eq).toMatchObject({ outcome: 'PENDING' });
  });

  it('the delivery transition is a guarded UPDATE — state list and rider_id IS NULL are both in the WHERE clause', async () => {
    const { supabase, calls } = supabaseStub([
      { data: LIVE_OFFER, error: null },
      CLAIMED_SLOT,
      ASSIGNED_DELIVERY,
      OK,
      OK,
      OK,
    ]);

    await new OfferAcceptanceService(supabase).acceptOffer(riderUser(), OFFER_ID);

    const claim = calls.find((c) => c.table === 'deliveries' && c.op === 'update');
    expect(claim?.payload).toMatchObject({ state: 'RIDER_ASSIGNED', rider_id: RIDER_ID });
    expect(claim?.payload).toHaveProperty('assigned_at');
    expect(claim?.eq).toMatchObject({ id: DELIVERY_ID });
    expect(claim?.in).toMatchObject({ state: ['RIDER_SEARCHING', 'RIDER_REASSIGNING'] });
    expect(claim?.is).toMatchObject({ rider_id: null });
  });

  it('every other rider\'s pending offer for the delivery becomes SUPERSEDED, and the winner\'s is left alone', async () => {
    const { supabase, calls } = supabaseStub([
      { data: LIVE_OFFER, error: null },
      CLAIMED_SLOT,
      ASSIGNED_DELIVERY,
      OK,
      OK,
      OK,
    ]);

    await new OfferAcceptanceService(supabase).acceptOffer(riderUser(), OFFER_ID);

    const siblings = calls.find(
      (c) => c.table === 'rider_assignment_attempts' && c.op === 'update' && c.neq.id === OFFER_ID,
    );
    expect(siblings?.payload).toEqual({ outcome: 'SUPERSEDED' });
    expect(siblings?.eq).toMatchObject({ delivery_id: DELIVERY_ID, outcome: 'PENDING' });
  });

  it('reads the offer scoped to its own rider, so another rider\'s offer is an indistinguishable NOT_FOUND', async () => {
    const { supabase, calls } = supabaseStub([{ data: null, error: null }]);
    const service = new OfferAcceptanceService(supabase);

    await expectDomainError(service.acceptOffer(riderUser(OTHER_RIDER_ID), OFFER_ID), 'NOT_FOUND');

    const read = calls.find((c) => c.table === 'rider_assignment_attempts');
    // Ownership is a query filter, not a comparison after the read.
    expect(read?.eq).toMatchObject({ id: OFFER_ID, rider_id: OTHER_RIDER_ID });
    // Nothing was written on the rejected path.
    expect(calls.filter((c) => c.op !== 'select')).toHaveLength(0);
  });
});

describe('OfferAcceptanceService — the 60-second window (DEC-037 / BQ-020)', () => {
  it('an offer past its expires_at is refused with OFFER_EXPIRED and writes nothing', async () => {
    const { supabase, calls } = supabaseStub([
      {
        data: { ...LIVE_OFFER, expires_at: new Date(Date.now() - 1_000).toISOString() },
        error: null,
      },
    ]);
    const service = new OfferAcceptanceService(supabase);

    await expectDomainError(service.acceptOffer(riderUser(), OFFER_ID), 'OFFER_EXPIRED');

    expect(calls.filter((c) => c.op !== 'select')).toHaveLength(0);
  });

  it('an offer the sweep already marked EXPIRED is refused with OFFER_EXPIRED', async () => {
    const { supabase } = supabaseStub([{ data: { ...LIVE_OFFER, outcome: 'EXPIRED' }, error: null }]);
    const service = new OfferAcceptanceService(supabase);

    await expectDomainError(service.acceptOffer(riderUser(), OFFER_ID), 'OFFER_EXPIRED');
  });

  it('an offer superseded by another rider\'s win is refused with OFFER_TAKEN', async () => {
    const { supabase } = supabaseStub([
      { data: { ...LIVE_OFFER, outcome: 'SUPERSEDED' }, error: null },
    ]);
    const service = new OfferAcceptanceService(supabase);

    await expectDomainError(service.acceptOffer(riderUser(), OFFER_ID), 'OFFER_TAKEN');
  });

  it('an offer with no window at all is treated as closed, never as open forever', async () => {
    const { supabase } = supabaseStub([{ data: { ...LIVE_OFFER, expires_at: null }, error: null }]);
    const service = new OfferAcceptanceService(supabase);

    await expectDomainError(service.acceptOffer(riderUser(), OFFER_ID), 'OFFER_EXPIRED');
  });
});

describe('OfferAcceptanceService — first accept wins (DEC-020)', () => {
  it('the loser of the delivery race gets OFFER_TAKEN and creates no assignment', async () => {
    const { supabase, calls } = supabaseStub([
      { data: LIVE_OFFER, error: null },
      CLAIMED_SLOT,
      { data: null, error: null }, // guarded delivery UPDATE matched 0 rows — someone else won
      OK, // rider slot handed back
    ]);
    const service = new OfferAcceptanceService(supabase);

    await expectDomainError(service.acceptOffer(riderUser(), OFFER_ID), 'OFFER_TAKEN');

    expect(calls.find((c) => c.table === 'rider_assignments')).toBeUndefined();
  });

  it('a losing attempt is never falsely marked ACCEPTED', async () => {
    const { supabase, calls } = supabaseStub([
      { data: LIVE_OFFER, error: null },
      CLAIMED_SLOT,
      { data: null, error: null },
      OK,
    ]);
    const service = new OfferAcceptanceService(supabase);

    await expectDomainError(service.acceptOffer(riderUser(), OFFER_ID), 'OFFER_TAKEN');

    const acceptedWrites = calls.filter(
      (c) => c.table === 'rider_assignment_attempts' && c.payload?.outcome === 'ACCEPTED',
    );
    expect(acceptedWrites).toHaveLength(0);
  });

  it('the loser hands its rider slot back, guarded on the value this request set', async () => {
    const { supabase, calls } = supabaseStub([
      { data: LIVE_OFFER, error: null },
      CLAIMED_SLOT,
      { data: null, error: null },
      OK,
    ]);
    const service = new OfferAcceptanceService(supabase);

    await expectDomainError(service.acceptOffer(riderUser(), OFFER_ID), 'OFFER_TAKEN');

    const release = calls.filter((c) => c.table === 'rider_availability' && c.op === 'update').at(-1);
    expect(release?.payload).toEqual({ active_delivery_count: 0 });
    expect(release?.eq).toMatchObject({ rider_id: RIDER_ID, active_delivery_count: 1 });
  });
});

describe('OfferAcceptanceService — one active delivery per rider (DEC-037 / BQ-021)', () => {
  it('THE INVARIANT IS IN THE GUARDED WRITE: the claim UPDATE carries active_delivery_count = 0 in its WHERE clause', async () => {
    const { supabase, calls } = supabaseStub([
      { data: LIVE_OFFER, error: null },
      CLAIMED_SLOT,
      ASSIGNED_DELIVERY,
      OK,
      OK,
      OK,
    ]);

    await new OfferAcceptanceService(supabase).acceptOffer(riderUser(), OFFER_ID);

    const claim = calls.find((c) => c.table === 'rider_availability' && c.op === 'update');
    expect(claim?.op).toBe('update');
    expect(claim?.payload).toEqual({ active_delivery_count: 1 });
    expect(claim?.eq).toMatchObject({ rider_id: RIDER_ID, active_delivery_count: 0 });

    // And it is not merely a pre-check: no SELECT of the rider's availability
    // or deliveries precedes it on the happy path.
    const beforeClaim = calls.slice(0, calls.indexOf(claim as Recorded));
    expect(beforeClaim.every((c) => c.table === 'rider_assignment_attempts')).toBe(true);
  });

  it('a rider already holding another delivery cannot acquire a second — and the delivery is never touched', async () => {
    const { supabase, calls } = supabaseStub([
      { data: LIVE_OFFER, error: null },
      SLOT_TAKEN,
      { data: [{ id: OTHER_DELIVERY_ID, state: 'PICKED_UP' }], error: null },
    ]);
    const service = new OfferAcceptanceService(supabase);

    await expectDomainError(service.acceptOffer(riderUser(), OFFER_ID), 'RIDER_HAS_ACTIVE_DELIVERY');

    expect(calls.find((c) => c.table === 'deliveries' && c.op === 'update')).toBeUndefined();
    expect(calls.find((c) => c.table === 'rider_assignments')).toBeUndefined();
  });

  it('two concurrent accepts by the SAME rider: the second loses the row-level compare-and-set, not a pre-check', async () => {
    // Both requests contend for one `rider_availability` row. The first sets the
    // count to 1; the second's `WHERE active_delivery_count = 0` re-evaluates
    // against the committed row and matches nothing.
    const first = supabaseStub([
      { data: LIVE_OFFER, error: null },
      CLAIMED_SLOT,
      ASSIGNED_DELIVERY,
      OK,
      OK,
      OK,
    ]);
    const second = supabaseStub([
      { data: { ...LIVE_OFFER, id: 'offer-2', delivery_id: OTHER_DELIVERY_ID }, error: null },
      SLOT_TAKEN,
      { data: [{ id: DELIVERY_ID, state: 'RIDER_ASSIGNED' }], error: null },
    ]);

    const won = await new OfferAcceptanceService(first.supabase).acceptOffer(riderUser(), OFFER_ID);
    expect(won.deliveryId).toBe(DELIVERY_ID);

    await expectDomainError(
      new OfferAcceptanceService(second.supabase).acceptOffer(riderUser(), 'offer-2'),
      'RIDER_HAS_ACTIVE_DELIVERY',
    );

    // Exactly one delivery was ever claimed across the two requests.
    const deliveryClaims = [...first.calls, ...second.calls].filter(
      (c) => c.table === 'deliveries' && c.op === 'update',
    );
    expect(deliveryClaims).toHaveLength(1);
    expect(deliveryClaims[0]?.eq.id).toBe(DELIVERY_ID);
  });

  it('the active-delivery diagnosis uses the canonical rider-engaged states', async () => {
    const { supabase, calls } = supabaseStub([
      { data: LIVE_OFFER, error: null },
      SLOT_TAKEN,
      { data: [{ id: OTHER_DELIVERY_ID, state: 'AT_MERCHANT' }], error: null },
    ]);
    const service = new OfferAcceptanceService(supabase);

    await expectDomainError(service.acceptOffer(riderUser(), OFFER_ID), 'RIDER_HAS_ACTIVE_DELIVERY');

    const activeRead = calls.find((c) => c.table === 'deliveries' && c.op === 'select');
    expect(activeRead?.eq).toMatchObject({ rider_id: RIDER_ID });
    expect(activeRead?.in).toMatchObject({
      state: ['RIDER_ASSIGNED', 'RIDER_REASSIGNING', 'AT_MERCHANT', 'PICKED_UP', 'EN_ROUTE'],
    });
  });
});

describe('OfferAcceptanceService — crash windows', () => {
  it('Case B: a crash after the delivery was claimed is repaired on retry, without assigning a second rider', async () => {
    // The retry finds its slot already taken and its own delivery already
    // assigned to it, so it finishes the tail instead of re-racing.
    const { supabase, calls } = supabaseStub([
      { data: LIVE_OFFER, error: null },
      SLOT_TAKEN,
      { data: [{ id: DELIVERY_ID, state: 'RIDER_ASSIGNED' }], error: null },
      OK, // rider_assignments insert (the write the crash lost)
      OK, // offer -> ACCEPTED
      OK, // siblings -> SUPERSEDED
    ]);

    const result = await new OfferAcceptanceService(supabase).acceptOffer(riderUser(), OFFER_ID);

    expect(result).toEqual({ deliveryId: DELIVERY_ID, state: 'RIDER_ASSIGNED', riderId: RIDER_ID });
    // Crucially: no second guarded delivery UPDATE, which would have failed on
    // `rider_id IS NULL` and turned a completed accept into a spurious 409.
    expect(calls.find((c) => c.table === 'deliveries' && c.op === 'update')).toBeUndefined();
    expect(calls.find((c) => c.table === 'rider_assignments' && c.op === 'insert')).toBeDefined();
  });

  it('Case A: a slot left behind by a crash is repaired, then reclaimed, and the accept proceeds', async () => {
    const { supabase, calls } = supabaseStub([
      { data: LIVE_OFFER, error: null },
      SLOT_TAKEN,
      { data: [], error: null }, // no active delivery accounts for the slot
      { data: { rider_id: RIDER_ID, active_delivery_count: 0 }, error: null }, // guarded reset
      CLAIMED_SLOT, // re-claim
      ASSIGNED_DELIVERY,
      OK,
      OK,
      OK,
    ]);

    const result = await new OfferAcceptanceService(supabase).acceptOffer(riderUser(), OFFER_ID);

    expect(result.deliveryId).toBe(DELIVERY_ID);
    const reset = calls.filter((c) => c.table === 'rider_availability' && c.op === 'update')[1];
    expect(reset?.payload).toEqual({ active_delivery_count: 0 });
    // The repair is itself a guarded write, not a blind overwrite.
    expect(reset?.gt).toMatchObject({ active_delivery_count: 0 });
  });

  it('a repaired slot taken by another concurrent accept in between still yields RIDER_HAS_ACTIVE_DELIVERY, never a double assignment', async () => {
    const { supabase, calls } = supabaseStub([
      { data: LIVE_OFFER, error: null },
      SLOT_TAKEN,
      { data: [], error: null },
      { data: { rider_id: RIDER_ID, active_delivery_count: 0 }, error: null },
      SLOT_TAKEN, // the re-claim lost too
    ]);
    const service = new OfferAcceptanceService(supabase);

    await expectDomainError(service.acceptOffer(riderUser(), OFFER_ID), 'RIDER_HAS_ACTIVE_DELIVERY');

    expect(calls.find((c) => c.table === 'deliveries' && c.op === 'update')).toBeUndefined();
  });

  it('a rider with an offer but no availability row is an invariant break, not a rider-facing conflict', async () => {
    const { supabase } = supabaseStub([
      { data: LIVE_OFFER, error: null },
      SLOT_TAKEN,
      { data: [], error: null },
      { data: null, error: null }, // nothing to reset: the row does not exist
    ]);
    const service = new OfferAcceptanceService(supabase);

    await expectDomainError(service.acceptOffer(riderUser(), OFFER_ID), 'INTERNAL_ERROR');
  });

  it('a duplicate rider_assignments row is absorbed — the one-active index refusing a repeat is the retry working', async () => {
    const { supabase } = supabaseStub([
      { data: LIVE_OFFER, error: null },
      CLAIMED_SLOT,
      ASSIGNED_DELIVERY,
      { data: null, error: { message: 'duplicate key value', code: '23505' } },
      OK,
      OK,
    ]);

    const result = await new OfferAcceptanceService(supabase).acceptOffer(riderUser(), OFFER_ID);

    expect(result.state).toBe('RIDER_ASSIGNED');
  });
});

describe('OfferAcceptanceService — isolation', () => {
  it('touches no payment, ledger, refund, reconciliation, settlement or order table', async () => {
    const { supabase, calls } = supabaseStub([
      { data: LIVE_OFFER, error: null },
      CLAIMED_SLOT,
      ASSIGNED_DELIVERY,
      OK,
      OK,
      OK,
    ]);

    await new OfferAcceptanceService(supabase).acceptOffer(riderUser(), OFFER_ID);

    expect([...new Set(calls.map((c) => c.table))].sort()).toEqual([
      'deliveries',
      'rider_assignment_attempts',
      'rider_assignments',
      'rider_availability',
    ]);
  });

  it('writes no money: rider_earning_satang is never in any payload', async () => {
    const { supabase, calls } = supabaseStub([
      { data: LIVE_OFFER, error: null },
      CLAIMED_SLOT,
      ASSIGNED_DELIVERY,
      OK,
      OK,
      OK,
    ]);

    await new OfferAcceptanceService(supabase).acceptOffer(riderUser(), OFFER_ID);

    for (const call of calls) {
      const keys = Object.keys(call.payload ?? {});
      expect(keys).not.toContain('rider_earning_satang');
      expect(keys.filter((k) => k.includes('satang'))).toEqual([]);
    }
  });

  it('fails closed if the route is ever wired without @Roles(\'RIDER\')', async () => {
    const { supabase, calls } = supabaseStub([]);
    const service = new OfferAcceptanceService(supabase);

    await expectDomainError(service.acceptOffer(riderUser(null), OFFER_ID), 'FORBIDDEN');

    expect(calls).toHaveLength(0);
  });
});
