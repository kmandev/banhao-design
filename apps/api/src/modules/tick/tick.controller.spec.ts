import { TickController } from './tick.controller';
import type { PaymentEventProcessingService } from '../payments/payment-event-processing.service';
import type { RefundEventProcessingService } from '../payments/refund-event-processing.service';
import type { PaymentAttemptExpiryService } from '../payments/payment-attempt-expiry.service';
import type { DispatchService } from '../rider/dispatch.service';
import type { NoRiderEscalationService } from '../rider/no-rider-escalation.service';
import type { ArrivalTimeoutEscalationService } from '../rider/arrival-timeout-escalation.service';
import type { ProofPhotoRetentionService } from '../rider/proof-photo-retention.service';
import type { OutboxDispatchService } from '../notifications/outbox-dispatch.service';
import type { MerchantAcceptanceTimeoutService } from '../ai-ops/merchant-acceptance-timeout.service';
import type { NoRiderTriageService } from '../ai-ops/no-rider-triage.service';

/**
 * F-2b: `POST /internal/tick` invokes `PaymentEventProcessingService`. Now
 * also invokes `PaymentAttemptExpiryService` (payment-attempt/QR expiry,
 * DEC-029), `DispatchService` (G-2 broadcast dispatch, DEC-020/DEC-037),
 * `NoRiderEscalationService` (DEC-022 no-rider escalation, Phase H final gap),
 * `ProofPhotoRetentionService` (POD retention, DEC-039), and
 * `OutboxDispatchService` (H-2 outbox notification dispatch, ADR-005/ADR-011),
 * `MerchantAcceptanceTimeoutService` and `NoRiderTriageService` (Phase J AI
 * operations, DEC-040).
 * Now also invokes `RefundEventProcessingService` (Q-020 Slice 2, DEC-057 §5)
 * — its own independent claim loop over the same `payment_events` table,
 * reported separately from `paymentEvents`.
 * All these services are plain stubs here — their own logic is each one's own
 * `*.spec.ts` file's job. This file proves only the wiring: the tick handler
 * calls every processor and reports what each did, additively to the
 * original `{ accepted: true }` shape.
 */
describe('TickController', () => {
  function build(
    paymentEventsResult = { processed: 2, skipped: 1 },
    expiryResult = { expired: 1, skipped: 0 },
    dispatchResult = { deliveries: 3, offers: 7, expiredOffers: 2 },
    podRetentionResult = {
      enabled: false,
      referencedCandidates: 0,
      orphanCandidates: 0,
      purged: 0,
      skipped: 0,
      failed: 0,
    },
    outboxDispatchResult = { claimed: 0, dispatched: 0, skipped: 0, failed: 0 },
    noRiderEscalationResult = { escalated: 0, decisionPointReached: 0, skipped: 0, failed: 0 },
    aiOpsResult = { examined: 0, acted: 0, escalated: 0, skipped: 0, failed: 0 },
    aiOpsNoRiderResult = { examined: 0, acted: 0, escalated: 0, skipped: 0, failed: 0 },
    arrivalTimeoutResult = { examined: 0, escalated: 0, skipped: 0, failed: 0 },
    refundEventsResult = { processed: 0, skipped: 0 },
  ) {
    const processPendingEvents = jest.fn().mockResolvedValue(paymentEventsResult);
    const processExpiredAttempts = jest.fn().mockResolvedValue(expiryResult);
    const paymentEvents = { processPendingEvents } as unknown as PaymentEventProcessingService;
    const processRefundEvents = jest.fn().mockResolvedValue(refundEventsResult);
    const refundEvents = { processPendingEvents: processRefundEvents } as unknown as RefundEventProcessingService;
    const paymentAttemptExpiry = { processExpiredAttempts } as unknown as PaymentAttemptExpiryService;
    const runDispatchRound = jest.fn().mockResolvedValue(dispatchResult);
    const dispatch = { runDispatchRound } as unknown as DispatchService;
    const runNoRiderEscalation = jest.fn().mockResolvedValue(noRiderEscalationResult);
    const noRiderEscalation = { run: runNoRiderEscalation } as unknown as NoRiderEscalationService;
    const runArrivalTimeout = jest.fn().mockResolvedValue(arrivalTimeoutResult);
    const arrivalTimeoutEscalation = {
      run: runArrivalTimeout,
    } as unknown as ArrivalTimeoutEscalationService;
    const run = jest.fn().mockResolvedValue(podRetentionResult);
    const podRetention = { run } as unknown as ProofPhotoRetentionService;
    const dispatchPending = jest.fn().mockResolvedValue(outboxDispatchResult);
    const outboxDispatch = { dispatchPending } as unknown as OutboxDispatchService;
    const runAiOps = jest.fn().mockResolvedValue(aiOpsResult);
    const aiOps = { run: runAiOps } as unknown as MerchantAcceptanceTimeoutService;
    const runAiOpsNoRider = jest.fn().mockResolvedValue(aiOpsNoRiderResult);
    const aiOpsNoRider = { run: runAiOpsNoRider } as unknown as NoRiderTriageService;
    const controller = new TickController(
      paymentEvents,
      refundEvents,
      paymentAttemptExpiry,
      dispatch,
      noRiderEscalation,
      arrivalTimeoutEscalation,
      podRetention,
      outboxDispatch,
      aiOps,
      aiOpsNoRider,
    );
    return {
      controller,
      processPendingEvents,
      processRefundEvents,
      processExpiredAttempts,
      runDispatchRound,
      runNoRiderEscalation,
      runArrivalTimeout,
      run,
      dispatchPending,
      runAiOps,
      runAiOpsNoRider,
    };
  }

  it('invokes payment-event processing and reports the outcome, additive to the original shape', async () => {
    const { controller, processPendingEvents } = build();

    const result = await controller.handle();

    expect(processPendingEvents).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      accepted: true,
      paymentEvents: { processed: 2, skipped: 1 },
      refundEvents: { processed: 0, skipped: 0 },
      paymentAttemptExpiry: { expired: 1, skipped: 0 },
      dispatch: { deliveries: 3, offers: 7, expiredOffers: 2 },
      noRiderEscalation: { escalated: 0, decisionPointReached: 0, skipped: 0, failed: 0 },
  arrivalTimeoutEscalation: { examined: 0, escalated: 0, skipped: 0, failed: 0 },
      podRetention: {
        enabled: false,
        referencedCandidates: 0,
        orphanCandidates: 0,
        purged: 0,
        skipped: 0,
        failed: 0,
      },
      outboxDispatch: { claimed: 0, dispatched: 0, skipped: 0, failed: 0 },
      aiOps: { examined: 0, acted: 0, escalated: 0, skipped: 0, failed: 0 },
      aiOpsNoRider: { examined: 0, acted: 0, escalated: 0, skipped: 0, failed: 0 },
    });
  });

  it('still reports accepted: true even when nothing was pending', async () => {
    const { controller } = build(
      { processed: 0, skipped: 0 },
      { expired: 0, skipped: 0 },
      { deliveries: 0, offers: 0, expiredOffers: 0 },
    );

    const result = await controller.handle();

    expect(result.accepted).toBe(true);
    expect(result.paymentEvents).toEqual({ processed: 0, skipped: 0 });
    expect(result.paymentAttemptExpiry).toEqual({ expired: 0, skipped: 0 });
    expect(result.dispatch).toEqual({ deliveries: 0, offers: 0, expiredOffers: 0 });
  });

  it('invokes refund-event processing exactly once per tick and reports the outcome separately from paymentEvents — Q-020 Slice 2', async () => {
    const refundEventsResult = { processed: 1, skipped: 2 };
    const { controller, processRefundEvents } = build(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      refundEventsResult,
    );

    const result = await controller.handle();

    expect(processRefundEvents).toHaveBeenCalledTimes(1);
    expect(processRefundEvents).toHaveBeenCalledWith();
    expect(result.refundEvents).toEqual(refundEventsResult);
    expect(result.accepted).toBe(true);
  });

  it('invokes payment-attempt expiry and reports the outcome, additive to the original shape', async () => {
    const { controller, processExpiredAttempts } = build();

    const result = await controller.handle();

    expect(processExpiredAttempts).toHaveBeenCalledTimes(1);
    expect(result.paymentAttemptExpiry).toEqual({ expired: 1, skipped: 0 });
  });

  it('the TickHmacGuard-protected route wiring is unchanged — handle() still requires no arguments and returns the additive shape', async () => {
    const { controller } = build();

    const result = await controller.handle();

    expect(result.accepted).toBe(true);
    expect(Object.keys(result)).toEqual([
      'accepted',
      'paymentEvents',
      'refundEvents',
      'paymentAttemptExpiry',
      'dispatch',
      'noRiderEscalation',
      // BQ-017 Slice #3 — DEC-053's five-minute customer-arrival wait, placed
      // among the delivery checks rather than at the end. Escalation only.
      'arrivalTimeoutEscalation',
      'podRetention',
      'outboxDispatch',
      'aiOps',
      'aiOpsNoRider',
    ]);
  });

  it('runs exactly one dispatch round per tick — DEC-037 aligns the 60-second round to the 60-second tick', async () => {
    const { controller, runDispatchRound } = build();

    const result = await controller.handle();

    expect(runDispatchRound).toHaveBeenCalledTimes(1);
    expect(runDispatchRound).toHaveBeenCalledWith();
    expect(result.dispatch).toEqual({ deliveries: 3, offers: 7, expiredOffers: 2 });
  });

  it('runs the no-rider escalation check exactly once per tick, additive to the existing response shape — DEC-022', async () => {
    const noRiderEscalationResult = { escalated: 2, decisionPointReached: 1, skipped: 3, failed: 0 };
    const { controller, runNoRiderEscalation } = build(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      noRiderEscalationResult,
    );

    const result = await controller.handle();

    expect(runNoRiderEscalation).toHaveBeenCalledTimes(1);
    expect(runNoRiderEscalation).toHaveBeenCalledWith();
    expect(result.noRiderEscalation).toEqual(noRiderEscalationResult);
    expect(result.accepted).toBe(true);
  });

  it('runs the customer-arrival timeout check exactly once per tick — DEC-053 § 3, BQ-017', async () => {
    const arrivalTimeoutResult = { examined: 4, escalated: 2, skipped: 2, failed: 0 };
    const { controller, runArrivalTimeout } = build(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      arrivalTimeoutResult,
    );

    const result = await controller.handle();

    expect(runArrivalTimeout).toHaveBeenCalledTimes(1);
    expect(runArrivalTimeout).toHaveBeenCalledWith();
    expect(result.arrivalTimeoutEscalation).toEqual(arrivalTimeoutResult);
    expect(result.accepted).toBe(true);
  });

  /**
   * The escalation must not run after a phase that could remove an eligible
   * case from under it. Nothing in this sequence touches an `ARRIVED`
   * delivery — dispatch and the no-rider check work `RIDER_SEARCHING`,
   * retention works `DELIVERED`, and the AI phases read the outbox — but the
   * ordering is pinned so a future phase cannot be inserted ahead of it
   * without this failing.
   */
  it('runs the arrival-timeout check after the no-rider check and before POD retention', async () => {
    const order: string[] = [];
    const { controller, runNoRiderEscalation, runArrivalTimeout, run } = build();

    runNoRiderEscalation.mockImplementation(async () => {
      order.push('noRider');
      return { escalated: 0, decisionPointReached: 0, skipped: 0, failed: 0 };
    });
    runArrivalTimeout.mockImplementation(async () => {
      order.push('arrivalTimeout');
      return { examined: 0, escalated: 0, skipped: 0, failed: 0 };
    });
    run.mockImplementation(async () => {
      order.push('podRetention');
      return {
        enabled: false,
        referencedCandidates: 0,
        orphanCandidates: 0,
        purged: 0,
        skipped: 0,
        failed: 0,
      };
    });

    await controller.handle();

    expect(order).toEqual(['noRider', 'arrivalTimeout', 'podRetention']);
  });

  it('runs the POD retention pass exactly once per tick — DEC-039, no scheduler of its own', async () => {
    const podRetentionResult = {
      enabled: true,
      referencedCandidates: 4,
      orphanCandidates: 1,
      purged: 5,
      skipped: 0,
      failed: 0,
    };
    const { controller, run } = build(undefined, undefined, undefined, podRetentionResult);

    const result = await controller.handle();

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith();
    expect(result.podRetention).toEqual(podRetentionResult);
  });

  it('runs the outbox dispatch pass exactly once per tick, additive to the existing response shape — H-2', async () => {
    const outboxDispatchResult = { claimed: 5, dispatched: 4, skipped: 1, failed: 0 };
    const { controller, dispatchPending } = build(undefined, undefined, undefined, undefined, outboxDispatchResult);

    const result = await controller.handle();

    expect(dispatchPending).toHaveBeenCalledTimes(1);
    expect(dispatchPending).toHaveBeenCalledWith();
    expect(result.outboxDispatch).toEqual(outboxDispatchResult);
    expect(result.accepted).toBe(true);
  });

  it('runs the Phase J AI operations pipeline exactly once per tick, additive to the existing response shape — DEC-040', async () => {
    const { controller, runAiOps } = build(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { examined: 3, acted: 0, escalated: 3, skipped: 0, failed: 0 },
    );

    const result = await controller.handle();

    expect(runAiOps).toHaveBeenCalledTimes(1);
    expect(result.aiOps).toEqual({ examined: 3, acted: 0, escalated: 3, skipped: 0, failed: 0 });
  });

  it('runs the Phase J no-rider triage pipeline exactly once per tick, reported separately — DEC-040 / DEC-022', async () => {
    const { controller, runAiOpsNoRider, runNoRiderEscalation } = build(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { examined: 2, acted: 0, escalated: 1, skipped: 1, failed: 0 },
    );

    const result = await controller.handle();

    expect(runAiOpsNoRider).toHaveBeenCalledTimes(1);
    expect(result.aiOpsNoRider).toEqual({
      examined: 2,
      acted: 0,
      escalated: 1,
      skipped: 1,
      failed: 0,
    });
    // The deterministic ladder still runs, and runs first: AI triage reads the
    // events it writes, and never replaces it.
    expect(runNoRiderEscalation).toHaveBeenCalledTimes(1);
    expect(result.noRiderEscalation).toBeDefined();
  });
});
