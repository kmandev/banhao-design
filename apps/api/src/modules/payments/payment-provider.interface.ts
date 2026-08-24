import type { Money } from '@banhao/types';

/**
 * Provider-agnostic payment abstraction.
 *
 * NO PROVIDER IS IMPLEMENTED. Q-001 (which payment provider) is still OPEN, and
 * Q-002 (the legal/settlement model) must be resolved first — see
 * ai/RESEARCH/PAYMENT_RESEARCH.md and ai/KNOWLEDGE/QUESTIONS.md.
 *
 * This interface exists so that when a provider IS chosen, business logic never
 * has to import an Omise/Xendit/2C2P SDK directly. Rules this shape enforces:
 *
 *  - CON-002: only a verified provider webhook may confirm a payment. Hence
 *    `verifyWebhookSignature` is a required capability, not an optional extra.
 *  - REQ-003: webhook handling must be idempotent, keyed on a single payment
 *    reference. Hence every operation carries an explicit `idempotencyKey`.
 *  - CON-001: Payment state is separate from Order state. Nothing here returns
 *    or accepts an order status.
 *
 * ⚠️ Known constraint from research: no examined provider supports native
 * PromptPay refunds (Q-020). `refund()` is declared because the domain needs
 * the concept, but the mechanism is undecided — do not assume a provider call
 * will satisfy it.
 */

export type PaymentMethod = 'PROMPTPAY_QR' | 'CASH';

export interface CreatePaymentInput {
  /** BANHAO's own payment reference — the idempotency key for this operation. */
  idempotencyKey: string;
  orderId: string;
  amount: Money;
  method: PaymentMethod;
  /** Absolute URL the provider should call on state change. */
  webhookUrl: string;
}

export interface CreatePaymentResult {
  /** The provider's identifier for this payment. */
  providerPaymentId: string;
  /** Payload the client renders, e.g. a PromptPay QR string. Never a secret. */
  presentation?: { type: 'QR_STRING'; value: string; expiresAt: string };
}

export interface RefundInput {
  idempotencyKey: string;
  providerPaymentId: string;
  amount: Money;
  reason: string;
}

export interface RefundResult {
  providerRefundId: string;
}

/**
 * The result of verifying an inbound webhook. `verified: false` means the
 * request must be rejected without touching any payment or ledger state.
 */
export type WebhookVerification =
  | {
      verified: true;
      providerPaymentId: string;
      /** The provider's own identifier for this specific event — the idempotency anchor (`payment_events.provider_event_id`, DEC-028). */
      providerEventId: string;
      /** The kind of event, e.g. `payment.succeeded` — `payment_events.event_type`. */
      providerEvent: string;
      rawPayload: unknown;
    }
  | { verified: false; reason: string };

export interface PaymentProvider {
  readonly name: string;

  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;

  refund(input: RefundInput): Promise<RefundResult>;

  /**
   * Verifies a webhook's cryptographic signature. This is the ONLY path by
   * which a payment may be confirmed (CON-002) — never client-reported state.
   */
  verifyWebhookSignature(rawBody: string, headers: Record<string, string>): WebhookVerification;
}

/** DI token for the active provider. */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
