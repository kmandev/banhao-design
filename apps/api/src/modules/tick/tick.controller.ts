import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { TickHmacGuard } from '../../common/guards/tick-hmac.guard';
import { PaymentEventProcessingService } from '../payments/payment-event-processing.service';
import { PaymentAttemptExpiryService } from '../payments/payment-attempt-expiry.service';
import { DispatchService, type DispatchRoundResult } from '../rider/dispatch.service';
import {
  ProofPhotoRetentionService,
  type ProofPhotoRetentionResult,
} from '../rider/proof-photo-retention.service';
import {
  OutboxDispatchService,
  type OutboxDispatchResult,
} from '../notifications/outbox-dispatch.service';

export interface TickAcceptedResponse {
  accepted: true;
  /** F-2b — how many `payment_events` rows this tick claimed and processed. */
  paymentEvents: { processed: number; skipped: number };
  /** How many timed-out `payment_attempts` rows this tick expired. */
  paymentAttemptExpiry: { expired: number; skipped: number };
  /** G-2 — the broadcast dispatch round this tick ran (DEC-020, DEC-037). */
  dispatch: DispatchRoundResult;
  /** DEC-039 — the POD proof-photo retention purge this tick ran. */
  podRetention: ProofPhotoRetentionResult;
  /** H-2 — the outbox notification dispatch round this tick ran (ADR-005, ADR-011). */
  outboxDispatch: OutboxDispatchResult;
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
 * `outboxDispatch` (H-2, ADR-005/ADR-011) runs last, additive in the same
 * way, and follows the same never-throws contract `OutboxDispatchService`
 * documents on itself.
 */
@Controller('internal/tick')
export class TickController {
  constructor(
    private readonly paymentEvents: PaymentEventProcessingService,
    private readonly paymentAttemptExpiry: PaymentAttemptExpiryService,
    private readonly dispatch: DispatchService,
    private readonly podRetention: ProofPhotoRetentionService,
    private readonly outboxDispatch: OutboxDispatchService,
  ) {}

  @Public()
  @UseGuards(TickHmacGuard)
  @Post()
  @HttpCode(200)
  @ApiExcludeEndpoint() // Internal-only; not part of the public OpenAPI surface.
  async handle(): Promise<TickAcceptedResponse> {
    const paymentEvents = await this.paymentEvents.processPendingEvents();
    const paymentAttemptExpiry = await this.paymentAttemptExpiry.processExpiredAttempts();
    const dispatch = await this.dispatch.runDispatchRound();
    const podRetention = await this.podRetention.run();
    const outboxDispatch = await this.outboxDispatch.dispatchPending();
    return { accepted: true, paymentEvents, paymentAttemptExpiry, dispatch, podRetention, outboxDispatch };
  }
}
