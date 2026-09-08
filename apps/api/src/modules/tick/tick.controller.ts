import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { TickHmacGuard } from '../../common/guards/tick-hmac.guard';
import { PaymentEventProcessingService } from '../payments/payment-event-processing.service';
import { RefundEventProcessingService } from '../payments/refund-event-processing.service';
import { PaymentAttemptExpiryService } from '../payments/payment-attempt-expiry.service';
import { DispatchService, type DispatchRoundResult } from '../rider/dispatch.service';
import {
  NoRiderEscalationService,
  type NoRiderEscalationResult,
} from '../rider/no-rider-escalation.service';
import {
  ArrivalTimeoutEscalationService,
  type ArrivalTimeoutEscalationResult,
} from '../rider/arrival-timeout-escalation.service';
import {
  ProofPhotoRetentionService,
  type ProofPhotoRetentionResult,
} from '../rider/proof-photo-retention.service';
import {
  OutboxDispatchService,
  type OutboxDispatchResult,
} from '../notifications/outbox-dispatch.service';
import { MerchantAcceptanceTimeoutService } from '../ai-ops/merchant-acceptance-timeout.service';
import { NoRiderTriageService } from '../ai-ops/no-rider-triage.service';
import type { AiOpsRunResult } from '../ai-ops/ai-ops.types';

export interface TickAcceptedResponse {
  accepted: true;
  /** F-2b — how many `payment_events` rows this tick claimed and processed. */
  paymentEvents: { processed: number; skipped: number };
  /** Q-020 Slice 2 (DEC-057 §5) — how many refund-domain `payment_events` rows this tick claimed and processed. */
  refundEvents: { processed: number; skipped: number };
  /** How many timed-out `payment_attempts` rows this tick expired. */
  paymentAttemptExpiry: { expired: number; skipped: number };
  /** G-2 — the broadcast dispatch round this tick ran (DEC-020, DEC-037). */
  dispatch: DispatchRoundResult;
  /** DEC-022 — the no-rider escalation check this tick ran (Phase H final gap). */
  noRiderEscalation: NoRiderEscalationResult;
  /** DEC-053 § 3 — the five-minute customer-arrival wait check this tick ran (BQ-017). Escalation only; it never fails a delivery. */
  arrivalTimeoutEscalation: ArrivalTimeoutEscalationResult;
  /** DEC-039 — the POD proof-photo retention purge this tick ran. */
  podRetention: ProofPhotoRetentionResult;
  /** H-2 — the outbox notification dispatch round this tick ran (ADR-005, ADR-011). */
  outboxDispatch: OutboxDispatchResult;
  /** Phase J (DEC-040) — the AI operations merchant-acceptance-timeout pipeline run this tick. */
  aiOps: AiOpsRunResult;
  /** Phase J (DEC-040) — the AI operations no-rider triage pipeline run this tick (DEC-022's decision point). */
  aiOpsNoRider: AiOpsRunResult;
}

/**
 * `POST /internal/tick` — DEC-APP-010, transport + security boundary, now
 * also the Phase 2 payment-event processing entry point (F-2b, ADR-008) and
 * the payment-attempt (QR) expiry entry point (DEC-029).
 *
 * `@Public()` opts this route out of `SupabaseAuthGuard` (there is no
 * Supabase user behind a scheduler call); `TickHmacGuard` is what actually
 * authenticates it. The two are not redundant — removing either would either
 * lock a scheduler out (no user JWT to present) or leave the route
 * unauthenticated (`@Public()` alone grants nothing). Neither is touched by
 * this session.
 *
 * `paymentEvents`, `paymentAttemptExpiry` and `dispatch` are all additive to
 * the response shape A-6 originally shipped (`{ accepted: true }`) — a caller
 * checking only `.accepted === true` sees no change. Every other later
 * phase's tick work (`outbox`, `jobs`, ledger reconciliation) still does not
 * run here — those attach behind this same guard as their own domains land.
 *
 * `refundEvents` (Q-020 Slice 2, DEC-057 §5) runs right after `paymentEvents`
 * — same table, same claim mechanism, same "no scheduler of its own"
 * reasoning, and placed immediately alongside its sibling rather than at the
 * end because both are Phase F payment-domain work.
 * `RefundEventProcessingService` is a second, independent claim loop over
 * `payment_events` (filtered to the refund-domain event names), not a change
 * to `PaymentEventProcessingService` — see that service's own doc comment.
 * It posts no ledger entry (DEC-059 is Slice 3) and follows the same
 * never-throws-out-of-a-single-event contract every phase here already
 * follows.
 *
 * `dispatch` is G-2's broadcast round (DEC-020), attached here rather than to a
 * scheduler of its own: DEC-APP-010 fixes the Cloudflare Worker cron at 60
 * seconds as the only scheduler in the system, and DEC-037's 60-second round
 * interval was chosen to be exactly that cadence. Nothing in
 * `apps/tick-worker/` changes to add it. It runs after the payment phases and
 * shares nothing with them — a dispatch round reads and writes only delivery-
 * domain tables (DEC-018).
 *
 * `podRetention` (DEC-039) runs next, for the same "no scheduler of its own"
 * reason as `dispatch`. It is additive in exactly the same way and follows
 * the same never-throws contract `ProofPhotoRetentionService` documents on
 * itself — this handler has no per-phase try/catch of its own, so a phase
 * that *can* throw would fail every phase after it in the same tick.
 *
 * `noRiderEscalation` (DEC-022) runs right after `dispatch` — same rider/
 * delivery domain, same "no scheduler of its own" reasoning, and early enough
 * that an event it writes this tick is picked up by `outboxDispatch` later in
 * this same tick rather than waiting for the next one. It follows the same
 * never-throws contract `NoRiderEscalationService` documents on itself.
 *
 * `arrivalTimeoutEscalation` (DEC-053 § 3, BQ-017 Slice #3) runs right after
 * `noRiderEscalation` — same rider/delivery domain, same elapsed-time shape,
 * and placed among the delivery checks rather than at the end because nothing
 * else in this sequence touches an `ARRIVED` delivery: `dispatch` works
 * `RIDER_SEARCHING`, `noRiderEscalation` the same, `podRetention` only
 * `DELIVERED` ones, and the two AI phases read the outbox rather than
 * `deliveries`. No earlier phase can therefore make an eligible case
 * disappear before this one sees it.
 *
 * It is an **escalation only**. It issues no UPDATE at all: it records an
 * append-only `audit_logs` row for an operator and changes no delivery, order,
 * assignment, availability or financial row. DEC-053 § 2 reserves the failure
 * declaration for the operator, so a tick that could declare one would make
 * that authority advisory — the same reasoning `noRiderEscalation` records for
 * DEC-022's "cancellation is a decision, never a timeout". It follows the same
 * never-throws contract as every phase above it.
 *
 * `outboxDispatch` (H-2, ADR-005/ADR-011) runs next, additive in the same
 * way, and follows the same never-throws contract `OutboxDispatchService`
 * documents on itself.
 *
 * `aiOps` (Phase J, DEC-040) runs last — the merchant-acceptance-timeout
 * pipeline, attached here for the same "no scheduler of its own" reason as
 * every phase above it. It is additive in exactly the same way and follows
 * the same never-throws contract. It reads the outbox rather than claiming
 * from it, so it neither competes with nor blocks `outboxDispatch`, and with
 * BQ-013 unresolved it escalates rather than acting — see
 * `MerchantAcceptanceTimeoutService`'s own header.
 *
 * `aiOpsNoRider` (Phase J, DEC-040) runs after it, on the same terms. It reads
 * the `OrderNoRiderFound` events `noRiderEscalation` writes earlier in this
 * same tick, and turns a delivery that has crossed DEC-022's 8-minute decision
 * point into a durable `audit_logs` escalation for a supervisor. It has no
 * command at all, so it can only escalate — never cancel, never fail a
 * delivery, never message a customer. See `NoRiderTriageService`'s own header.
 */
@Controller('internal/tick')
export class TickController {
  constructor(
    private readonly paymentEvents: PaymentEventProcessingService,
    private readonly refundEvents: RefundEventProcessingService,
    private readonly paymentAttemptExpiry: PaymentAttemptExpiryService,
    private readonly dispatch: DispatchService,
    private readonly noRiderEscalation: NoRiderEscalationService,
    private readonly arrivalTimeoutEscalation: ArrivalTimeoutEscalationService,
    private readonly podRetention: ProofPhotoRetentionService,
    private readonly outboxDispatch: OutboxDispatchService,
    private readonly aiOps: MerchantAcceptanceTimeoutService,
    private readonly aiOpsNoRider: NoRiderTriageService,
  ) {}

  @Public()
  @UseGuards(TickHmacGuard)
  @Post()
  @HttpCode(200)
  @ApiExcludeEndpoint() // Internal-only; not part of the public OpenAPI surface.
  async handle(): Promise<TickAcceptedResponse> {
    const paymentEvents = await this.paymentEvents.processPendingEvents();
    const refundEvents = await this.refundEvents.processPendingEvents();
    const paymentAttemptExpiry = await this.paymentAttemptExpiry.processExpiredAttempts();
    const dispatch = await this.dispatch.runDispatchRound();
    const noRiderEscalation = await this.noRiderEscalation.run();
    const arrivalTimeoutEscalation = await this.arrivalTimeoutEscalation.run();
    const podRetention = await this.podRetention.run();
    const outboxDispatch = await this.outboxDispatch.dispatchPending();
    const aiOps = await this.aiOps.run();
    const aiOpsNoRider = await this.aiOpsNoRider.run();
    return {
      accepted: true,
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
    };
  }
}
