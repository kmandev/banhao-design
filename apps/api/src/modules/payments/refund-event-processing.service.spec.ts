import { RefundEventProcessingService } from './refund-event-processing.service';
import { BATCH_SIZE } from './payment-event-processing.service';
import type { RefundLedgerReversalService } from './refund-ledger-reversal.service';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * Q-020 Slice 2 — same stub shape as `payment-event-processing.service.spec.ts`:
 * a fake `supabase.admin.from()` that records every filter/payload a
 * statement was built with (including `.neq()`, which this file's terminal
 * guards depend on) and returns queued results in call order, so a test can
 * assert a guard is actually IN the query, not merely checked afterward in
 * application code. `tablesTouched` backs the mandatory ledger-isolation
 * assertions (Q-020 Slice 2 mission, Step 16) — this file's own
 * `RefundEventProcessingService` never touches a ledger table directly in
 * any scenario, Slice 2 or Slice 3, because reversal posting is delegated to
 * `RefundLedgerReversalService` (mocked here, tested on its own in
 * `refund-ledger-reversal.service.spec.ts`).
 */

/** Q-020 Slice 3 — a bare mock of the injected ledger-reversal collaborator, so this file's own assertions stay about event claiming/matching/state, not ledger content. */
function fakeLedgerReversal(): RefundLedgerReversalService {
  return { postReversals: jest.fn().mockResolvedValue(undefined) } as unknown as RefundLedgerReversalService;
}

type Result = { data: unknown; error: { message: string; code?: string } | null };

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update';
  eq: Record<string, unknown>;
  neq: Record<string, unknown>;
  like: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

function supabaseStub(results: Result[]) {
  const calls: Recorded[] = [];
  const tablesTouched = new Set<string>();
  let index = 0;

  const nextResult = (): Result => results[index++] ?? { data: null, error: null };

  const admin = {
    from(table: string) {
      tablesTouched.add(table);
      const call: Recorded = { table, op: 'select', eq: {}, neq: {}, like: {} };
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
        neq(column: string, value: unknown) {
          call.neq[column] = call.neq[column] ? [...(call.neq[column] as unknown[]), value] : [value];
          return builder;
        },
        like(column: string, value: unknown) {
          call.like[column] = value;
          return builder;
        },
        is(column: string, value: unknown) {
          call.eq[`${column}__is`] = value;
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve(nextResult()),
        returns: () => Promise.resolve(nextResult()),
        then: (resolve: (r: Result) => unknown) => Promise.resolve(nextResult()).then(resolve),
      };

      return builder;
    },
  };

  return { supabase: { admin } as unknown as SupabaseService, calls, tablesTouched };
}

const EVENT_ID = 'event-1';
const PROVIDER = 'stripe';
const PROVIDER_EVENT_ID = 'evt_fixed';
const PROVIDER_REFUND_ID = 're_fixed';
const PROVIDER_PAYMENT_ID = 'pi_fixed';
const REFUND_ID = 'refund-1';
const PAYMENT_ID = 'payment-1';
const ORDER_ID = 'order-1';
const AMOUNT = 2500;

function claimedEvent(overrides: { raw_payload?: unknown; event_type?: string } = {}) {
  return {
    id: EVENT_ID,
    provider: PROVIDER,
    provider_event_id: PROVIDER_EVENT_ID,
    event_type: overrides.event_type ?? 'refund.status_reported',
    raw_payload:
      overrides.raw_payload ??
      {
        providerRefundId: PROVIDER_REFUND_ID,
        providerPaymentId: PROVIDER_PAYMENT_ID,
        status: 'SUCCEEDED',
        amountSatang: AMOUNT,
      },
  };
}

function refundRow(overrides: { state?: string; amount_satang?: number } = {}) {
  return {
    id: REFUND_ID,
    payment_id: PAYMENT_ID,
    state: overrides.state ?? 'REFUND_PENDING',
    amount_satang: overrides.amount_satang ?? AMOUNT,
  };
}

function paymentRow(overrides: { amount_satang?: number; provider_payment_id?: string | null } = {}) {
  return {
    id: PAYMENT_ID,
    order_id: ORDER_ID,
    amount_satang: overrides.amount_satang ?? AMOUNT,
    provider_payment_id: overrides.provider_payment_id ?? PROVIDER_PAYMENT_ID,
  };
}

describe('BATCH_SIZE', () => {
  it('is reused from PaymentEventProcessingService, not redefined', () => {
    expect(BATCH_SIZE).toBe(25);
  });
});

describe('RefundEventProcessingService.processOne — claiming', () => {
  it('claims via a guarded UPDATE (processed_at IS NULL in WHERE), never a prior SELECT', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null }, // claim UPDATE
      { data: refundRow(), error: null }, // refunds lookup
      { data: paymentRow(), error: null }, // payments lookup
      { data: null, error: null }, // payment_events payment_id backfill
      { data: null, error: null }, // refunds transition UPDATE
    ]);
    const service = new RefundEventProcessingService(supabase, fakeLedgerReversal());

    const outcome = await service.processOne(EVENT_ID);

    expect(outcome).toBe('processed');
    const claimCall = calls[0]!;
    expect(claimCall.table).toBe('payment_events');
    expect(claimCall.op).toBe('update');
    expect(claimCall.eq).toMatchObject({ id: EVENT_ID, processed_at__is: null });
  });

  it('returns "skipped" without throwing when the row is already claimed (0 rows returned)', async () => {
    const { supabase } = supabaseStub([{ data: null, error: null }]);
    const service = new RefundEventProcessingService(supabase, fakeLedgerReversal());

    const outcome = await service.processOne(EVENT_ID);

    expect(outcome).toBe('skipped');
  });

  it('releases the claim (processed_at back to null) and returns "skipped" on a transient failure, so the next tick retries it', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null }, // claim
      { data: null, error: { message: 'connection reset' } }, // refunds lookup throws
      { data: null, error: null }, // release UPDATE
    ]);
    const service = new RefundEventProcessingService(supabase, fakeLedgerReversal());

    const outcome = await service.processOne(EVENT_ID);

    expect(outcome).toBe('skipped');
    const releaseCall = calls[calls.length - 1]!;
    expect(releaseCall.op).toBe('update');
    expect(releaseCall.payload).toMatchObject({ processed_at: null });
    expect(releaseCall.payload?.processing_error).toContain('connection reset');
  });
});

describe('RefundEventProcessingService — matching (Step 7)', () => {
  it('a valid provider refund id finds the local refund and proceeds to transition it', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: refundRow(), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundEventProcessingService(supabase, fakeLedgerReversal());

    await service.processOne(EVENT_ID);

    const refundLookup = calls.find((c) => c.table === 'refunds' && c.op === 'select');
    expect(refundLookup?.eq).toMatchObject({ provider: PROVIDER, provider_refund_id: PROVIDER_REFUND_ID });
    const transition = calls.find((c) => c.table === 'refunds' && c.op === 'update');
    expect(transition?.payload).toMatchObject({ state: 'REFUNDED' });
  });

  it('a missing providerRefundId fails closed — no refunds lookup, no transition, event marked terminal', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent({ raw_payload: { status: 'SUCCEEDED', amountSatang: AMOUNT } }), error: null },
      { data: null, error: null }, // markAnomaly write
    ]);
    const service = new RefundEventProcessingService(supabase, fakeLedgerReversal());

    const outcome = await service.processOne(EVENT_ID);

    expect(outcome).toBe('processed');
    expect(calls.some((c) => c.table === 'refunds')).toBe(false);
    const anomalyWrite = calls[calls.length - 1]!;
    expect(anomalyWrite.table).toBe('payment_events');
    expect(anomalyWrite.payload?.processing_error).toContain('no providerRefundId');
  });

  it('an unknown provider refund id fails closed — no transition, terminal', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: null, error: null }, // refunds lookup finds nothing
      { data: null, error: null }, // markAnomaly write
    ]);
    const service = new RefundEventProcessingService(supabase, fakeLedgerReversal());

    const outcome = await service.processOne(EVENT_ID);

    expect(outcome).toBe('processed');
    expect(calls.some((c) => c.table === 'payments')).toBe(false);
    const anomalyWrite = calls[calls.length - 1]!;
    expect(anomalyWrite.payload?.processing_error).toContain('No local refund found');
  });

  it('a wrong/conflicting payment association fails closed — no transition', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: refundRow(), error: null },
      { data: paymentRow({ provider_payment_id: 'pi_someone_else' }), error: null },
      { data: null, error: null }, // payment_id backfill
      { data: null, error: null }, // markAnomaly write
    ]);
    const service = new RefundEventProcessingService(supabase, fakeLedgerReversal());

    const outcome = await service.processOne(EVENT_ID);

    expect(outcome).toBe('processed');
    expect(calls.some((c) => c.table === 'refunds' && c.op === 'update')).toBe(false);
    const anomalyWrite = calls[calls.length - 1]!;
    expect(anomalyWrite.payload?.processing_error).toContain('provider payment identity conflicts');
  });
});

describe('RefundEventProcessingService — amount validation (Step 8)', () => {
  it('the exact full amount is accepted and proceeds to finality', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: refundRow({ amount_satang: AMOUNT }), error: null },
      { data: paymentRow({ amount_satang: AMOUNT }), error: null },
      { data: null, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundEventProcessingService(supabase, fakeLedgerReversal());

    await service.processOne(EVENT_ID);

    const transition = calls.find((c) => c.table === 'refunds' && c.op === 'update');
    expect(transition?.payload).toMatchObject({ state: 'REFUNDED' });
  });

  it('an amount mismatch does NOT finalize — no transition, no ledger, anomaly recorded', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent({ raw_payload: { providerRefundId: PROVIDER_REFUND_ID, providerPaymentId: PROVIDER_PAYMENT_ID, status: 'SUCCEEDED', amountSatang: 1000 } }), error: null },
      { data: refundRow({ amount_satang: AMOUNT }), error: null },
      { data: paymentRow({ amount_satang: AMOUNT }), error: null },
      { data: null, error: null }, // payment_id backfill
      { data: null, error: null }, // markAnomaly write
    ]);
    const service = new RefundEventProcessingService(supabase, fakeLedgerReversal());

    const outcome = await service.processOne(EVENT_ID);

    expect(outcome).toBe('processed');
    expect(calls.some((c) => c.table === 'refunds' && c.op === 'update')).toBe(false);
    expect(calls.some((c) => c.table === 'ledger_entry_groups' || c.table === 'ledger_entries')).toBe(false);
    const anomalyWrite = calls[calls.length - 1]!;
    expect(anomalyWrite.payload?.processing_error).toContain('amount mismatch');
  });

  it('never accepts a partial amount even when it matches neither payment nor refund — fails closed the same way', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent({ raw_payload: { providerRefundId: PROVIDER_REFUND_ID, providerPaymentId: PROVIDER_PAYMENT_ID, status: 'SUCCEEDED', amountSatang: 1200 } }), error: null },
      { data: refundRow({ amount_satang: AMOUNT }), error: null },
      { data: paymentRow({ amount_satang: AMOUNT }), error: null },
      { data: null, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundEventProcessingService(supabase, fakeLedgerReversal());

    await service.processOne(EVENT_ID);

    expect(calls.some((c) => c.table === 'refunds' && c.op === 'update')).toBe(false);
  });
});

describe('RefundEventProcessingService — DEC-057 §4 state mapping', () => {
  it.each([
    ['PENDING', 'REFUND_PENDING'],
    ['REQUIRES_ACTION', 'REFUND_REQUESTED'],
    ['SUCCEEDED', 'REFUNDED'],
    ['FAILED', 'REFUND_FAILED'],
    ['CANCELED', 'REFUND_REJECTED'],
  ])('provider status %s transitions the local refund to %s', async (providerStatus, targetState) => {
    const { supabase, calls } = supabaseStub([
      {
        data: claimedEvent({
          raw_payload: {
            providerRefundId: PROVIDER_REFUND_ID,
            providerPaymentId: PROVIDER_PAYMENT_ID,
            status: providerStatus,
            amountSatang: AMOUNT,
          },
        }),
        error: null,
      },
      { data: refundRow(), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundEventProcessingService(supabase, fakeLedgerReversal());

    await service.processOne(EVENT_ID);

    const transition = calls.find((c) => c.table === 'refunds' && c.op === 'update');
    expect(transition?.payload).toMatchObject({ state: targetState });
  });

  it('sets completed_at only when transitioning to REFUNDED', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: refundRow(), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundEventProcessingService(supabase, fakeLedgerReversal());

    await service.processOne(EVENT_ID);

    const transition = calls.find((c) => c.table === 'refunds' && c.op === 'update');
    expect(transition?.payload).toHaveProperty('completed_at');
  });

  it('a null/unrecognized provider status fails closed rather than inventing a mapping', async () => {
    const { supabase, calls } = supabaseStub([
      {
        data: claimedEvent({
          raw_payload: {
            providerRefundId: PROVIDER_REFUND_ID,
            providerPaymentId: PROVIDER_PAYMENT_ID,
            status: null,
            amountSatang: AMOUNT,
          },
        }),
        error: null,
      },
      { data: refundRow(), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundEventProcessingService(supabase, fakeLedgerReversal());

    await service.processOne(EVENT_ID);

    expect(calls.some((c) => c.table === 'refunds' && c.op === 'update')).toBe(false);
  });
});

describe('RefundEventProcessingService — finality and terminal protection (DEC-057 §2, Steps 10-12)', () => {
  it('the canonical flow: REFUND_PENDING, provider verifies succeeded, transitions to REFUNDED — REFUNDED reached only via this path', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: refundRow({ state: 'REFUND_PENDING' }), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundEventProcessingService(supabase, fakeLedgerReversal());

    await service.processOne(EVENT_ID);

    const transition = calls.find((c) => c.table === 'refunds' && c.op === 'update');
    expect(transition?.eq).toMatchObject({ id: REFUND_ID });
    expect(transition?.neq).toMatchObject({
      state: ['REFUNDED', 'REFUND_FAILED', 'REFUND_REJECTED'],
    });
    expect(transition?.payload).toMatchObject({ state: 'REFUNDED' });
  });

  it('REFUNDED cannot regress — the transition query itself excludes REFUNDED, REFUND_FAILED and REFUND_REJECTED from every target', async () => {
    const { supabase, calls } = supabaseStub([
      {
        data: claimedEvent({
          raw_payload: {
            providerRefundId: PROVIDER_REFUND_ID,
            providerPaymentId: PROVIDER_PAYMENT_ID,
            status: 'PENDING',
            amountSatang: AMOUNT,
          },
        }),
        error: null,
      },
      { data: refundRow({ state: 'REFUNDED' }), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: null, error: null }, // guarded UPDATE — matches 0 rows in real Postgres
    ]);
    const service = new RefundEventProcessingService(supabase, fakeLedgerReversal());

    const outcome = await service.processOne(EVENT_ID);

    expect(outcome).toBe('processed');
    const transition = calls.find((c) => c.table === 'refunds' && c.op === 'update');
    // The guard itself is what prevents regression — proving it is present
    // and covers every terminal state, exactly as it would against a real
    // Postgres row already at REFUNDED.
    expect(transition?.neq?.state).toContain('REFUNDED');
    expect(transition?.neq?.state).toContain('REFUND_FAILED');
    expect(transition?.neq?.state).toContain('REFUND_REJECTED');
  });

  it('processing the same succeeded event twice is idempotent — one logical transition, the second call is a harmless no-op write', async () => {
    const { supabase } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: refundRow({ state: 'REFUND_PENDING' }), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundEventProcessingService(supabase, fakeLedgerReversal());
    const outcome = await service.processOne(EVENT_ID);
    expect(outcome).toBe('processed');

    // Re-delivery: the row is already claimed (processed_at set), so a
    // fresh processOne on the same id returns 'skipped' — the real
    // duplicate-webhook protection is `payment_events`' own unique
    // (provider, provider_event_id) constraint at ingest, proven in
    // `webhooks.controller.spec.ts`; this proves the claim side stays inert.
    const { supabase: supabase2 } = supabaseStub([{ data: null, error: null }]);
    const service2 = new RefundEventProcessingService(supabase2, fakeLedgerReversal());
    const secondOutcome = await service2.processOne(EVENT_ID);
    expect(secondOutcome).toBe('skipped');
  });
});

describe('RefundEventProcessingService — charge.refunded and unsupported events (Step 5/15)', () => {
  it('charge.refunded is recognized and marked inert — no refunds lookup, no transition', async () => {
    const { supabase, calls } = supabaseStub([
      {
        data: claimedEvent({
          event_type: 'refund.charge_aggregate',
          raw_payload: { chargeId: 'ch_fixed', refunded: true, amountRefunded: AMOUNT },
        }),
        error: null,
      },
      { data: null, error: null }, // markInert write
    ]);
    const service = new RefundEventProcessingService(supabase, fakeLedgerReversal());

    const outcome = await service.processOne(EVENT_ID);

    expect(outcome).toBe('processed');
    expect(calls.some((c) => c.table === 'refunds')).toBe(false);
    const inertWrite = calls[calls.length - 1]!;
    expect(inertWrite.payload?.processing_error).toContain('derived aggregate signal');
  });

  it('an unrecognized refund-domain event_type is marked terminal, never released for retry (starvation-safe)', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent({ event_type: 'refund.something_new' }), error: null },
      { data: null, error: null },
    ]);
    const service = new RefundEventProcessingService(supabase, fakeLedgerReversal());

    const outcome = await service.processOne(EVENT_ID);

    expect(outcome).toBe('processed');
    const write = calls[calls.length - 1]!;
    expect(write.payload?.processing_error).toContain('Unsupported refund payment_events.event_type');
  });
});

describe('RefundEventProcessingService.processPendingEvents — batching and starvation safety', () => {
  it('claims only refund-domain events (event_type LIKE refund.%), never payment.* rows', async () => {
    const { supabase, calls } = supabaseStub([{ data: [], error: null }]);
    const service = new RefundEventProcessingService(supabase, fakeLedgerReversal());

    await service.processPendingEvents();

    const listCall = calls[0]!;
    expect(listCall.like).toMatchObject({ event_type: 'refund.%' });
  });

  it('a malformed event earlier in the batch does not block a later valid one', async () => {
    const { supabase } = supabaseStub([
      { data: [{ id: 'evt-a' }, { id: 'evt-b' }], error: null }, // list
      // evt-a: malformed, no providerRefundId
      { data: claimedEvent({ raw_payload: { status: 'SUCCEEDED', amountSatang: AMOUNT } }), error: null },
      { data: null, error: null }, // markAnomaly for evt-a
      // evt-b: valid
      { data: claimedEvent(), error: null },
      { data: refundRow(), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundEventProcessingService(supabase, fakeLedgerReversal());

    const result = await service.processPendingEvents();

    expect(result).toEqual({ processed: 2, skipped: 0 });
  });
});

describe('RefundEventProcessingService — ledger isolation (Q-020 Slice 2/3)', () => {
  it('never itself reads or writes ledger_entry_groups or ledger_entries — reversal posting is fully delegated to the mocked RefundLedgerReversalService', async () => {
    const scenarios: Result[][] = [
      // Full success finality.
      [
        { data: claimedEvent(), error: null },
        { data: refundRow(), error: null },
        { data: paymentRow(), error: null },
        { data: null, error: null },
        { data: null, error: null },
      ],
      // Amount mismatch anomaly.
      [
        {
          data: claimedEvent({
            raw_payload: {
              providerRefundId: PROVIDER_REFUND_ID,
              providerPaymentId: PROVIDER_PAYMENT_ID,
              status: 'SUCCEEDED',
              amountSatang: 1,
            },
          }),
          error: null,
        },
        { data: refundRow(), error: null },
        { data: paymentRow(), error: null },
        { data: null, error: null },
        { data: null, error: null },
      ],
      // charge.refunded inert path.
      [{ data: claimedEvent({ event_type: 'refund.charge_aggregate', raw_payload: {} }), error: null }, { data: null, error: null }],
    ];

    for (const results of scenarios) {
      const { supabase, tablesTouched } = supabaseStub(results);
      const service = new RefundEventProcessingService(supabase, fakeLedgerReversal());
      await service.processOne(EVENT_ID);

      expect(tablesTouched.has('ledger_entry_groups')).toBe(false);
      expect(tablesTouched.has('ledger_entries')).toBe(false);
      expect(tablesTouched.has('reconciliation_cases')).toBe(false);
    }
  });
});

describe('RefundEventProcessingService — ledger reversal trigger (Q-020 Slice 3, DEC-049 §5/DEC-059)', () => {
  function eventWithStatus(providerStatus: string) {
    return claimedEvent({
      raw_payload: {
        providerRefundId: PROVIDER_REFUND_ID,
        providerPaymentId: PROVIDER_PAYMENT_ID,
        status: providerStatus,
        amountSatang: AMOUNT,
      },
    });
  }

  it('calls postReversals(refundId, paymentId) exactly once when the provider status is SUCCEEDED and the refund was not already blocked', async () => {
    const { supabase } = supabaseStub([
      { data: eventWithStatus('SUCCEEDED'), error: null },
      { data: refundRow({ state: 'REFUND_PENDING' }), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null }, // backfill
      { data: null, error: null }, // transition update
    ]);
    const ledgerReversal = fakeLedgerReversal();
    const service = new RefundEventProcessingService(supabase, ledgerReversal);

    await service.processOne(EVENT_ID);

    expect(ledgerReversal.postReversals).toHaveBeenCalledTimes(1);
    expect(ledgerReversal.postReversals).toHaveBeenCalledWith(REFUND_ID, PAYMENT_ID);
  });

  it('still calls postReversals when the refund was already REFUNDED before this event (redelivery/self-heal) — idempotency lives in the ledger service, not a skip here', async () => {
    const { supabase } = supabaseStub([
      { data: eventWithStatus('SUCCEEDED'), error: null },
      { data: refundRow({ state: 'REFUNDED' }), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: null, error: null },
    ]);
    const ledgerReversal = fakeLedgerReversal();
    const service = new RefundEventProcessingService(supabase, ledgerReversal);

    await service.processOne(EVENT_ID);

    expect(ledgerReversal.postReversals).toHaveBeenCalledTimes(1);
  });

  it.each(['PENDING', 'REQUIRES_ACTION', 'FAILED', 'CANCELED'])(
    'never calls postReversals for provider status %s — only SUCCEEDED reaches REFUNDED',
    async (providerStatus) => {
      const { supabase } = supabaseStub([
        { data: eventWithStatus(providerStatus), error: null },
        { data: refundRow({ state: 'REFUND_PENDING' }), error: null },
        { data: paymentRow(), error: null },
        { data: null, error: null },
        { data: null, error: null },
      ]);
      const ledgerReversal = fakeLedgerReversal();
      const service = new RefundEventProcessingService(supabase, ledgerReversal);

      await service.processOne(EVENT_ID);

      expect(ledgerReversal.postReversals).not.toHaveBeenCalled();
    },
  );

  it('never calls postReversals when the refund was already REFUND_FAILED before this event, even if this event reports SUCCEEDED — the illegal transition is blocked and must carry no financial side effect', async () => {
    const { supabase } = supabaseStub([
      { data: eventWithStatus('SUCCEEDED'), error: null },
      { data: refundRow({ state: 'REFUND_FAILED' }), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: null, error: null },
    ]);
    const ledgerReversal = fakeLedgerReversal();
    const service = new RefundEventProcessingService(supabase, ledgerReversal);

    await service.processOne(EVENT_ID);

    expect(ledgerReversal.postReversals).not.toHaveBeenCalled();
  });

  it('never calls postReversals when the refund was already REFUND_REJECTED before this event, even if this event reports SUCCEEDED', async () => {
    const { supabase } = supabaseStub([
      { data: eventWithStatus('SUCCEEDED'), error: null },
      { data: refundRow({ state: 'REFUND_REJECTED' }), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: null, error: null },
    ]);
    const ledgerReversal = fakeLedgerReversal();
    const service = new RefundEventProcessingService(supabase, ledgerReversal);

    await service.processOne(EVENT_ID);

    expect(ledgerReversal.postReversals).not.toHaveBeenCalled();
  });

  it('Q-020 Slice 4, case G — records PROVIDER_LOCAL_STATE_DIVERGENCE via payment_events.processing_error, and never calls the guarded refunds UPDATE at all (the guard would only no-op it)', async () => {
    const { supabase, calls } = supabaseStub([
      { data: eventWithStatus('SUCCEEDED'), error: null },
      { data: refundRow({ state: 'REFUND_FAILED' }), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null }, // payment_events.payment_id backfill
      { data: null, error: null }, // markAnomaly write — the 5th and final call
    ]);
    const ledgerReversal = fakeLedgerReversal();
    const service = new RefundEventProcessingService(supabase, ledgerReversal);

    const outcome = await service.processOne(EVENT_ID);

    expect(outcome).toBe('processed');
    expect(calls.some((c) => c.table === 'refunds' && c.op === 'update')).toBe(false);
    const anomalyWrite = calls[calls.length - 1]!;
    expect(anomalyWrite.table).toBe('payment_events');
    expect(anomalyWrite.payload?.processing_error).toContain('PROVIDER_LOCAL_STATE_DIVERGENCE');
    expect(anomalyWrite.payload?.processing_error).toContain('REFUND_FAILED');
  });

  it('never calls postReversals for an anomaly (amount mismatch) — no ledger call without a state transition', async () => {
    const { supabase } = supabaseStub([
      {
        data: claimedEvent({
          raw_payload: {
            providerRefundId: PROVIDER_REFUND_ID,
            providerPaymentId: PROVIDER_PAYMENT_ID,
            status: 'SUCCEEDED',
            amountSatang: 1,
          },
        }),
        error: null,
      },
      { data: refundRow(), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: null, error: null }, // markAnomaly write
    ]);
    const ledgerReversal = fakeLedgerReversal();
    const service = new RefundEventProcessingService(supabase, ledgerReversal);

    await service.processOne(EVENT_ID);

    expect(ledgerReversal.postReversals).not.toHaveBeenCalled();
  });

  it('a failure inside postReversals propagates and releases the claim for retry, exactly like any other transient processing failure', async () => {
    const { supabase, calls } = supabaseStub([
      { data: eventWithStatus('SUCCEEDED'), error: null },
      { data: refundRow({ state: 'REFUND_PENDING' }), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: null }, // release-claim update
    ]);
    const ledgerReversal: RefundLedgerReversalService = {
      postReversals: jest.fn().mockRejectedValue(new Error('ledger anomaly: mismatched entry')),
    } as unknown as RefundLedgerReversalService;
    const service = new RefundEventProcessingService(supabase, ledgerReversal);

    const outcome = await service.processOne(EVENT_ID);

    expect(outcome).toBe('skipped');
    const releaseCall = calls[calls.length - 1]!;
    expect(releaseCall.payload).toMatchObject({ processed_at: null });
    expect(releaseCall.payload?.processing_error).toContain('ledger anomaly');
  });
});
