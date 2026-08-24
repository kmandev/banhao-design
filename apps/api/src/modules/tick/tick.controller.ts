import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { TickHmacGuard } from '../../common/guards/tick-hmac.guard';
import { PaymentEventProcessingService } from '../payments/payment-event-processing.service';

export interface TickAcceptedResponse {
  accepted: true;
  /** F-2b — how many `payment_events` rows this tick claimed and processed. */
  paymentEvents: { processed: number; skipped: number };
}

/**
 * `POST /internal/tick` — DEC-APP-010, transport + security boundary, now
 * also the Phase 2 payment-event processing entry point (F-2b, ADR-008).
 *
 * `@Public()` opts this route out of `SupabaseAuthGuard` (there is no
 * Supabase user behind a scheduler call); `TickHmacGuard` is what actually
 * authenticates it. The two are not redundant — removing either would either
 * lock a scheduler out (no user JWT to present) or leave the route
 * unauthenticated (`@Public()` alone grants nothing). Neither is touched by
 * this session.
 *
 * `paymentEvents` is additive to the response shape A-6 originally shipped
 * (`{ accepted: true }`) — a caller checking only `.accepted === true` sees
 * no change. Every other later phase's tick work (`outbox`, `jobs`, QR
 * expiry, ledger reconciliation) still does not run here — those attach
 * behind this same guard as their own domains land.
 */
@Controller('internal/tick')
export class TickController {
  constructor(private readonly paymentEvents: PaymentEventProcessingService) {}

  @Public()
  @UseGuards(TickHmacGuard)
  @Post()
  @HttpCode(200)
  @ApiExcludeEndpoint() // Internal-only; not part of the public OpenAPI surface.
  async handle(): Promise<TickAcceptedResponse> {
    const paymentEvents = await this.paymentEvents.processPendingEvents();
    return { accepted: true, paymentEvents };
  }
}
