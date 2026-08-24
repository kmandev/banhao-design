import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, NotImplementedException } from '@nestjs/common';
import { loadServerEnv } from '@banhao/config';
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

/** The header {@link NullPaymentWebhookSimulator} signs into. Canonical casing, for docs and tests. */
export const NULL_PROVIDER_SIGNATURE_HEADER = 'X-Null-Signature';

/** Node lowercases incoming header names; this is the lookup key. */
export const NULL_PROVIDER_SIGNATURE_HEADER_LOWER = NULL_PROVIDER_SIGNATURE_HEADER.toLowerCase();

/** The shape a verified simulated event payload must have — see {@link NullPaymentWebhookSimulator}. */
interface SimulatedEventPayload {
  providerPaymentId: string;
  providerEventId: string;
  eventType: string;
}

function isSimulatedEventPayload(value: unknown): value is SimulatedEventPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.providerPaymentId === 'string' &&
    typeof candidate.providerEventId === 'string' &&
    typeof candidate.eventType === 'string'
  );
}

/**
 * The dev/null provider — DEC-APP-007.
 *
 * `createPayment` (F-1) and `verifyWebhookSignature` (F-2a) both return real,
 * usable (but explicitly fake) results rather than throwing, so Phase E
 * through I can be built and tested against this provider (V1.1 §8: "Phases
 * E through I are built and shipped against the existing
 * `NullPaymentProvider`"). This supersedes the earlier
 * `docs/PAYMENT_LIFECYCLE.md` § 0 note that it "throws on every call by
 * design" — that note predates V1.1's approval (2026-08-10 vs 2026-08-12) and
 * describes the Phase A/D-era placeholder, not the Phase F deliverable V1.1
 * explicitly specifies. Per `CLAUDE.md`'s own precedence rule, V1.1 wins.
 *
 * `refund()` remains **unchanged** — still refusing — because nothing in F-2a
 * calls it; refunds are a later Phase F session's work.
 *
 * ## Webhook signature verification — mirrors `TickHmacGuard`
 *
 * Same algorithm as `apps/api/src/common/guards/tick-hmac.guard.ts`:
 * HMAC-SHA256 over the *exact* raw request body bytes, hex-encoded, compared
 * with `timingSafeEqual`. The secret (`PAYMENT_WEBHOOK_DEV_SECRET`) is
 * dev-only, optional in `ServerEnv`, and read only here — never logged, never
 * sent to a client. Verification fails closed on: no secret configured (the
 * pre-F-2a default — nothing can be a real provider signature without a
 * provider), a missing/malformed signature header, a signature mismatch, or a
 * payload that does not parse into the expected shape.
 *
 * ## Production safety — DEC-APP-007's "startup assertion"
 *
 * The constructor refuses to construct if `NODE_ENV=production` **and** the
 * dev secret happens to be set. A normal production deployment never sets
 * `PAYMENT_WEBHOOK_DEV_SECRET`, so this never fires there — but if it were
 * ever misconfigured, the app fails to boot rather than silently accepting
 * forged "payment succeeded" events in production. This is the concrete
 * mechanism behind V1.1 §8's "env-gated at module registration, plus a
 * startup assertion."
 *
 * This provider is not, and must never become, a real payment integration:
 *
 * - Every identifier it mints is prefixed `NULL-`, unambiguous in a log or a
 *   database row.
 * - The "QR" is a labelled placeholder string, never a real PromptPay
 *   payload — V1.1 §8's own explicit non-goal: "no PromptPay QR rendering
 *   until a provider issues real payloads."
 * - No network call, no SDK, no real credential of any kind is used or read.
 */
@Injectable()
export class NullPaymentProvider implements PaymentProvider {
  readonly name = 'null';

  private readonly devWebhookSecret: string | undefined;

  constructor() {
    const env = loadServerEnv();
    this.devWebhookSecret = env.paymentWebhookDevSecret;

    if (env.nodeEnv === 'production' && this.devWebhookSecret) {
      throw new Error(
        'PAYMENT_WEBHOOK_DEV_SECRET must never be set in production — the null-provider webhook ' +
          'simulator is development-only (DEC-APP-007).',
      );
    }
  }

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

  verifyWebhookSignature(rawBody: string, headers: Record<string, string>): WebhookVerification {
    // No secret configured — the pre-F-2a default. Fails closed exactly as
    // it always has: without a secret, nothing can be a genuine signature.
    if (!this.devWebhookSecret) {
      return { verified: false, reason: 'No payment provider configured' };
    }

    const signatureHeader = headers[NULL_PROVIDER_SIGNATURE_HEADER_LOWER];
    if (!signatureHeader) {
      return { verified: false, reason: 'Missing signature header' };
    }

    const expected = createHmac('sha256', this.devWebhookSecret).update(rawBody, 'utf8').digest();
    const received = decodeSignature(signatureHeader, expected.length);
    if (!received || !timingSafeEqual(received, expected)) {
      return { verified: false, reason: 'Signature mismatch' };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return { verified: false, reason: 'Malformed payload' };
    }

    if (!isSimulatedEventPayload(payload)) {
      return { verified: false, reason: 'Malformed payload' };
    }

    return {
      verified: true,
      providerPaymentId: payload.providerPaymentId,
      providerEventId: payload.providerEventId,
      providerEvent: payload.eventType,
      rawPayload: payload,
    };
  }

  private fail(operation: string): never {
    throw new NotImplementedException(
      `The null payment provider does not implement ${operation} yet. ` +
        'This lands in a later Phase F session — see docs/BANHAO-APP-ARCHITECTURE-V1.md § 8.',
    );
  }
}

/**
 * Hex-decodes a signature, but only if it is *exactly* `expectedByteLength`
 * bytes of valid hex — same discipline as `TickHmacGuard.decodeSignature`.
 * `Buffer.from(str, 'hex')` silently truncates at the first invalid
 * character rather than throwing, which could otherwise turn a malformed
 * value into a shorter buffer that happens to pass a naive length check.
 * Validating the shape up front guarantees `timingSafeEqual` only ever
 * receives two equal-length buffers.
 */
function decodeSignature(value: string, expectedByteLength: number): Buffer | undefined {
  const hexPattern = new RegExp(`^[0-9a-f]{${expectedByteLength * 2}}$`, 'i');
  if (!hexPattern.test(value)) {
    return undefined;
  }
  return Buffer.from(value, 'hex');
}
