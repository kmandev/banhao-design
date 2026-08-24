import { randomUUID } from 'node:crypto';
import { Injectable, NotImplementedException } from '@nestjs/common';
import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  RefundInput,
  RefundResult,
  WebhookVerification,
} from '../payment-provider.interface';

/** How long a simulated QR stays valid — matches `docs/PAYMENT_LIFECYCLE.md` § 4's 10-minute window. */
const SIMULATED_QR_TTL_MS = 10 * 60 * 1000;

/**
 * The dev/null provider — DEC-APP-007.
 *
 * `createPayment` now returns a real, usable (but explicitly fake) payment
 * intent rather than throwing, so Phase E through I can be built and tested
 * against it (V1.1 §8: "Phases E through I are built and shipped against the
 * existing `NullPaymentProvider`"). This supersedes the earlier
 * `docs/PAYMENT_LIFECYCLE.md` § 0 note that it "throws on every call by
 * design" — that note predates V1.1's approval (2026-08-10 vs 2026-08-12) and
 * describes the Phase A/D-era placeholder, not the Phase F deliverable V1.1
 * explicitly specifies. Per `CLAUDE.md`'s own precedence rule, V1.1 wins.
 *
 * `refund()` and `verifyWebhookSignature()` are deliberately **unchanged** —
 * still refusing — because nothing in this session calls them: refunds and
 * webhook ingestion are Phase F session 2's work, and implementing signature
 * logic with no consumer would be untestable in isolation and out of scope.
 *
 * This provider is not, and must never become, a real payment integration:
 *
 * - Every identifier it mints is prefixed `NULL-`, unambiguous in a log or a
 *   database row.
 * - The "QR" is a labelled placeholder string, never a real PromptPay
 *   payload — V1.1 §8's own explicit non-goal: "no PromptPay QR rendering
 *   until a provider issues real payloads."
 * - No network call, no SDK, no credential of any kind is used or read.
 */
@Injectable()
export class NullPaymentProvider implements PaymentProvider {
  readonly name = 'null';

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const providerPaymentId = `NULL-${randomUUID()}`;
    const expiresAt = new Date(Date.now() + SIMULATED_QR_TTL_MS).toISOString();

    return {
      providerPaymentId,
      presentation: {
        type: 'QR_STRING',
        // Deliberately not QR-shaped data — a real provider's payload would
        // be, but rendering this as an actual scannable code would blur the
        // line V1.1 §8 draws. Any value derived from `input` here is for
        // traceability in logs only, never money: `input.amount` never
        // reaches this string.
        value: `NULL-QR:${input.orderId}:${providerPaymentId}`,
        expiresAt,
      },
    };
  }

  async refund(_input: RefundInput): Promise<RefundResult> {
    this.fail('refund');
  }

  verifyWebhookSignature(_rawBody: string, _headers: Record<string, string>): WebhookVerification {
    // Fails closed: an unverifiable webhook must never be treated as verified.
    // No webhook route exists yet to call this (Phase F session 2) — left
    // unchanged rather than growing dev-signing logic with no caller to prove
    // it against.
    return { verified: false, reason: 'No payment provider configured' };
  }

  private fail(operation: string): never {
    throw new NotImplementedException(
      `The null payment provider does not implement ${operation} yet. ` +
        'This lands in a later Phase F session — see docs/BANHAO-APP-ARCHITECTURE-V1.md § 8.',
    );
  }
}
