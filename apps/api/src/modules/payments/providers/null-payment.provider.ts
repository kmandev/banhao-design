import { Injectable, NotImplementedException } from '@nestjs/common';
import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  RefundInput,
  RefundResult,
  WebhookVerification,
} from '../payment-provider.interface';

/**
 * Placeholder provider used while Q-001 (payment provider) is OPEN.
 *
 * Every method throws rather than returning a fake success. Silently succeeding
 * would be far more dangerous here than failing loudly: it could let money-
 * related code paths appear to work in development and be shipped untested.
 */
@Injectable()
export class NullPaymentProvider implements PaymentProvider {
  readonly name = 'null';

  private fail(operation: string): never {
    throw new NotImplementedException(
      `No payment provider is configured (attempted: ${operation}). ` +
        'Q-001 is still OPEN — see ai/KNOWLEDGE/QUESTIONS.md.',
    );
  }

  // `async` so callers get a rejected promise rather than a synchronous throw —
  // matching how a real provider's network call would fail.
  async createPayment(_input: CreatePaymentInput): Promise<CreatePaymentResult> {
    this.fail('createPayment');
  }

  async refund(_input: RefundInput): Promise<RefundResult> {
    this.fail('refund');
  }

  verifyWebhookSignature(_rawBody: string, _headers: Record<string, string>): WebhookVerification {
    // Fails closed: an unverifiable webhook must never be treated as verified.
    return { verified: false, reason: 'No payment provider configured' };
  }
}
