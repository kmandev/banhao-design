import { randomUUID, createHmac } from 'node:crypto';
import { loadServerEnv } from '@banhao/config';
import { NULL_PROVIDER_SIGNATURE_HEADER_LOWER } from './null-payment.provider';

/** A signed request, ready to `POST` to `/webhooks/payments/null`. */
export interface SignedSimulatedEvent {
  rawBody: string;
  headers: Record<string, string>;
}

/**
 * Dev-only signed-event generator for `NullPaymentProvider` — DEC-APP-007.
 *
 * Produces a request that `NullPaymentProvider.verifyWebhookSignature` will
 * accept, exercising the exact same signature-verification code path a real
 * provider's webhook would use, without a real provider or a real network
 * call. V1.1 §8: "a local webhook simulator that produces correctly-shaped
 * signed events."
 *
 * **Never wired to an HTTP route in F-2a.** Nothing in this module registers
 * this class with Nest's DI container — that would make it eagerly
 * constructed at application boot in every environment, including
 * production, which is exactly what the constructor's own refusal below
 * exists to prevent. Callers (tests today; a dev-only consumer in a later
 * session) construct it directly with `new`.
 *
 * Refuses to construct outside development, mirroring
 * `NullPaymentProvider`'s own startup assertion — belt-and-braces, since this
 * class is a strictly more dangerous capability (it can forge a signature
 * `NullPaymentProvider` will accept) than merely holding the secret.
 */
export class NullPaymentWebhookSimulator {
  private readonly secret: string;

  constructor() {
    const env = loadServerEnv();

    if (env.nodeEnv === 'production') {
      throw new Error('NullPaymentWebhookSimulator must never run in production (DEC-APP-007).');
    }
    if (!env.paymentWebhookDevSecret) {
      throw new Error(
        'PAYMENT_WEBHOOK_DEV_SECRET is required to use the null-provider webhook simulator.',
      );
    }

    this.secret = env.paymentWebhookDevSecret;
  }

  /**
   * Signs a synthetic "payment succeeded" event.
   *
   * `providerEventId` defaults to a fresh id per call — pass the same value
   * twice to simulate a provider's retry/resend, the case
   * `payment_events`' `(provider, provider_event_id)` uniqueness exists for.
   * `amountSatang` is required (F-2b): `PaymentEventProcessingService`
   * compares it against `payments.amount_satang` before treating the event as
   * a match — pass a deliberately wrong value to simulate an amount
   * mismatch.
   *
   * The payload is unambiguously synthetic: `simulated: true` and a `source`
   * field naming this class, so a `payment_events.raw_payload` row can never
   * be mistaken for genuine provider data even by a human reading the table.
   */
  signPaymentSucceeded(input: {
    providerPaymentId: string;
    amountSatang: number;
    providerEventId?: string;
  }): SignedSimulatedEvent {
    return this.sign({
      eventType: 'payment.succeeded',
      providerEventId: input.providerEventId ?? `NULL-EVT-${randomUUID()}`,
      providerPaymentId: input.providerPaymentId,
      amountSatang: input.amountSatang,
    });
  }

  /**
   * Signs a synthetic "payment failed" event — `PAYMENT_LIFECYCLE.md` § 3's
   * `PROCESSING --> FAILED : provider reports failure` edge. Unlike
   * {@link signPaymentSucceeded}, no `amountSatang` is required: a failure
   * moves no money, so `PaymentEventProcessingService` never validates an
   * amount for this event type — nothing reads it. `reason`, when given,
   * flows to `payments.failure_reason`.
   */
  signPaymentFailed(input: { providerPaymentId: string; providerEventId?: string; reason?: string }): SignedSimulatedEvent {
    return this.sign({
      eventType: 'payment.failed',
      providerEventId: input.providerEventId ?? `NULL-EVT-${randomUUID()}`,
      providerPaymentId: input.providerPaymentId,
      reason: input.reason ?? null,
    });
  }

  private sign(fields: Record<string, unknown>): SignedSimulatedEvent {
    const payload = {
      simulated: true as const,
      source: 'NullPaymentWebhookSimulator',
      occurredAt: new Date().toISOString(),
      ...fields,
    };

    const rawBody = JSON.stringify(payload);
    const signature = createHmac('sha256', this.secret).update(rawBody, 'utf8').digest('hex');

    // Lowercased key: this is what `WebhooksController` actually receives —
    // Node/Express normalises incoming HTTP header names to lowercase before
    // application code ever sees them, and `verifyWebhookSignature` looks up
    // the lowercased key accordingly. A real HTTP client sending this over
    // the wire under any casing arrives the same way; this constructs the
    // record `verifyWebhookSignature` will actually be called with, whether
    // the caller invokes it directly (as these tests do) or via a real POST.
    return { rawBody, headers: { [NULL_PROVIDER_SIGNATURE_HEADER_LOWER]: signature } };
  }
}
