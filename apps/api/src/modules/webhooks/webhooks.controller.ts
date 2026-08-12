import {
  Controller,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { RawResponse } from '../../common/decorators/raw-response.decorator';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../payments/payment-provider.interface';

/**
 * `POST /webhooks/payments/:provider` — DEC-APP-005, transport only.
 *
 * This controller's entire job is getting the exact bytes a provider signed to
 * `PaymentProvider.verifyWebhookSignature` and reporting the outcome. It does
 * not write `payment_events`, does not touch `payments`/`orders`/ledger state,
 * and does not run outbox processing — that is Phase 2 processing (V1.1 §6),
 * gated on Q-001 (which provider) being resolved. Until then, the only bound
 * provider is `NullPaymentProvider`, which fails every signature closed.
 *
 * `:provider` selects nothing today — there is exactly one bound
 * `PaymentProvider`, matching `PaymentsModule`'s single-binding shape. The
 * segment exists so the route matches V1.1's documented shape in advance of
 * Q-001; it becomes a real lookup only if a second provider is ever bound.
 */
@Controller('webhooks/payments')
export class WebhooksController {
  constructor(@Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider) {}

  @Public()
  @RawResponse()
  @Post(':provider')
  @HttpCode(200)
  @ApiExcludeEndpoint() // Not a client-facing operation; excluded from the OpenAPI doc.
  handle(@Param('provider') _provider: string, @Req() req: Request): { received: true } {
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
      // field of the body or any header is trusted for anything else.
      throw new UnauthorizedException('Webhook signature verification failed');
    }

    // Verified. Phase 2 (persist payment_events, advance payment/order state,
    // enqueue outbox) is explicitly out of scope for A-5 — see the class doc.
    return { received: true };
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
