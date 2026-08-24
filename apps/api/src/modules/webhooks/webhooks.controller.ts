import {
  Controller,
  HttpCode,
  Inject,
  InternalServerErrorException,
  Logger,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { RawResponse } from '../../common/decorators/raw-response.decorator';
import { SupabaseService } from '../../supabase/supabase.service';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type WebhookVerification,
} from '../payments/payment-provider.interface';

/** The `verified: true` branch of {@link WebhookVerification} — what `persistEvent` needs. */
type VerifiedWebhookEvent = Extract<WebhookVerification, { verified: true }>;

/**
 * `POST /webhooks/payments/:provider` — DEC-APP-005, Phase 1 ingest only
 * (ADR-008).
 *
 * This controller's job is: get the exact bytes a provider signed to
 * `PaymentProvider.verifyWebhookSignature`, and — once verified — persist
 * exactly one `payment_events` row as evidence the event arrived. It does
 * **not** touch `payments`, `payment_attempts`, `orders`, `payment_transactions`,
 * any ledger table, or `reconciliation_cases`, and it does not process the
 * event — that is Phase 2, tick-driven (V1.1 §8), a later session's work.
 * The reason for the split: a crash after this request commits cannot erase
 * the evidence that a verified event arrived, even if Phase 2 processing
 * never runs.
 *
 * `:provider` selects nothing today — there is exactly one bound
 * `PaymentProvider`, matching `PaymentsModule`'s single-binding shape. The
 * segment exists so the route matches V1.1's documented shape in advance of
 * Q-001; it becomes a real lookup only if a second provider is ever bound.
 */
@Controller('webhooks/payments')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly supabase: SupabaseService,
  ) {}

  @Public()
  @RawResponse()
  @Post(':provider')
  @HttpCode(200)
  @ApiExcludeEndpoint() // Not a client-facing operation; excluded from the OpenAPI doc.
  async handle(@Param('provider') provider: string, @Req() req: Request): Promise<{ received: true }> {
    // rawBody is a Buffer (main.ts enables { rawBody: true }). Decoding to a
    // UTF-8 string is a byte-preserving transcode, never a JSON parse —
    // verification must see exactly what the provider signed, not a
    // reconstructed representation of it.
    const rawBody = req.rawBody ?? Buffer.alloc(0);

    const result = this.provider.verifyWebhookSignature(
      rawBody.toString('utf8'),
      this.headersAsRecord(req.headers),
    );

    if (!result.verified) {
      // Fails closed (CON-002): an unverified request is rejected before any
      // field of the body or any header is trusted for anything else, and
      // nothing is persisted for it.
      throw new UnauthorizedException('Webhook signature verification failed');
    }

    await this.persistEvent(provider, result);

    return { received: true };
  }

  /**
   * Records that a *verified* event arrived. DEC-028's idempotency guarantee
   * lives entirely in `payment_events`' own `(provider, provider_event_id)`
   * unique constraint — this method attempts the `INSERT` directly and lets
   * that constraint be the concurrency authority, never a prior `SELECT` to
   * decide whether one is needed (the same "guarded write, not
   * check-then-act" discipline `OrdersService`'s transitions already follow).
   * A duplicate delivery reads the existing row back for the caller's log,
   * but the response is 200 either way — a provider must see success or it
   * retries forever.
   */
  private async persistEvent(provider: string, result: VerifiedWebhookEvent): Promise<void> {
    const { error } = await this.supabase.admin.from('payment_events').insert({
      provider,
      provider_event_id: result.providerEventId,
      event_type: result.providerEvent,
      signature_verified: true,
      raw_payload: result.rawPayload,
    });

    if (!error) {
      return;
    }

    if (isUniqueViolation(error)) {
      const { error: readError } = await this.supabase.admin
        .from('payment_events')
        .select('id')
        .eq('provider', provider)
        .eq('provider_event_id', result.providerEventId)
        .maybeSingle();

      if (readError) {
        this.logger.error(
          `payment_events read-back failed after a duplicate ${provider}/${result.providerEventId}: ${readError.message}`,
        );
      }
      return;
    }

    this.logger.error(`payment_events insert failed for ${provider}/${result.providerEventId}: ${error.message}`);
    // 500, not 401: the signature was genuinely valid — this is our own
    // persistence failing, and a 5xx is what makes a real provider retry,
    // which is the correct recovery for a transient write failure.
    throw new InternalServerErrorException('Webhook could not be recorded');
  }

  private headersAsRecord(headers: Request['headers']): Record<string, string> {
    const record: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string') {
        record[key] = value;
      } else if (Array.isArray(value)) {
        record[key] = value.join(', ');
      }
    }
    return record;
  }
}

function isUniqueViolation(error: { code?: string; message: string }): boolean {
  return error.code === '23505' || error.message.includes('duplicate key');
}
