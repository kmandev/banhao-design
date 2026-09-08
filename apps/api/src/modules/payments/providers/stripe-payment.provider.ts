import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { loadServerEnv } from '@banhao/config';
import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  RefundInput,
  RefundResult,
  WebhookVerification,
} from '../payment-provider.interface';

/** Node lowercases incoming header names — same lookup convention as `NullPaymentProvider`. */
const STRIPE_SIGNATURE_HEADER = 'stripe-signature';

/** Stripe's own event names — DEC-055 clause 7's exactly-three Phase 1 subscription. */
const STRIPE_SUCCEEDED_EVENT = 'payment_intent.succeeded';
const STRIPE_FAILED_EVENT = 'payment_intent.payment_failed';
const STRIPE_CANCELED_EVENT = 'payment_intent.canceled';

/**
 * Stripe's own refund-related event names — Q-020 Slice 2 (DEC-057 §5). Not
 * yet subscribed in any Stripe Dashboard endpoint (that is deployment
 * configuration, out of scope for this slice) — verification and
 * normalization are provider-signature-driven, not subscription-driven, so
 * handling them here is correct regardless of dashboard state.
 */
const STRIPE_REFUND_CREATED_EVENT = 'refund.created';
const STRIPE_REFUND_UPDATED_EVENT = 'refund.updated';
const STRIPE_CHARGE_REFUNDED_EVENT = 'charge.refunded';

/** BANHAO's own normalized vocabulary — `PaymentEventProcessingService`'s existing, unmodified constants. */
const BANHAO_SUCCEEDED_EVENT = 'payment.succeeded';
const BANHAO_FAILED_EVENT = 'payment.failed';
/**
 * Deliberately **not** recognized by `PaymentEventProcessingService` — see
 * this file's own class doc comment, "Cancellation has no generic BANHAO
 * state yet".
 */
const BANHAO_CANCELED_EVENT = 'payment.canceled';

/**
 * BANHAO's own normalized name for a refund status report. `refund.created`
 * and `refund.updated` collapse into this single name deliberately — DEC-057
 * §5 established live that both can carry the identical `status`, and that
 * `refund.updated` must never be assumed to mean the status changed.
 * `RefundEventProcessingService` treats every delivery of this event
 * identically regardless of which of the two Stripe event types produced it.
 */
const BANHAO_REFUND_STATUS_EVENT = 'refund.status_reported';

/**
 * BANHAO's own normalized name for `charge.refunded` — a derived aggregate
 * signal about the underlying charge (DEC-057 §5), never the identity of any
 * individual refund. Captured for audit only; `RefundEventProcessingService`
 * recognizes this name specifically so it can mark it inert rather than
 * folding it into "unsupported event type".
 */
const BANHAO_CHARGE_REFUNDED_EVENT = 'refund.charge_aggregate';

/**
 * Stripe's five refund-object status literals, mapped 1:1 to a
 * provider-neutral vocabulary — DEC-057 §4. Nothing outside this file ever
 * sees a Stripe status string; `RefundEventProcessingService` reads only
 * this normalized value.
 */
type NormalizedRefundStatus = 'PENDING' | 'REQUIRES_ACTION' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';

function normalizeRefundStatus(status: string | null): NormalizedRefundStatus | null {
  switch (status) {
    case 'pending':
      return 'PENDING';
    case 'requires_action':
      return 'REQUIRES_ACTION';
    case 'succeeded':
      return 'SUCCEEDED';
    case 'failed':
      return 'FAILED';
    case 'canceled':
      return 'CANCELED';
    default:
      // Unrecognized/null — never guessed. The generic processor fails
      // closed on a null status rather than this adapter inventing one.
      return null;
  }
}

/** `refund.payment_intent`/`charge.payment_intent` are `string | PaymentIntent | null` — always a string on a real webhook delivery (never expanded), but read defensively rather than assumed. */
function readPaymentIntentId(
  paymentIntent: string | Stripe.PaymentIntent | null,
  fallback: string,
): string {
  if (typeof paymentIntent === 'string') {
    return paymentIntent;
  }
  return paymentIntent?.id ?? fallback;
}

/** Thrown when Stripe is used before `STRIPE_SECRET_KEY` is configured. */
export class StripeConfigError extends Error {
  constructor(missing: string[]) {
    super(
      `Stripe is not configured. Missing: ${missing.join(', ')}. ` +
        'Set STRIPE_SECRET_KEY (and STRIPE_WEBHOOK_SECRET, for webhook verification) — see .env.example.',
    );
    this.name = 'StripeConfigError';
  }
}

/**
 * The production `PaymentProvider` — DEC-055, Q-001 resolved 2026-09-08.
 *
 * Every behavioural claim in this file traces to
 * `docs/STRIPE_PROMPTPAY_SANDBOX_SPIKE.md`'s live, captured Stripe test-mode
 * evidence — nothing here is inferred from documentation alone. Presentation
 * shape follows DEC-055 Addendum A exactly; customer email follows DEC-056.
 *
 * ## Two calls, not one — matches only what the spike actually verified
 *
 * `createPayment` calls `paymentIntents.create` then `paymentIntents.confirm`
 * as two separate requests, exactly the sequence the spike exercised (§ 2).
 * Stripe's API can also confirm inline via `confirm: true` on the create
 * call, but that combination was never tested against a real PromptPay
 * PaymentIntent in this codebase's own evidence, so it is not used here — a
 * real-money adapter follows verified behaviour, not a plausible shortcut.
 * PaymentIntent creation alone never returns `next_action` (§ 2); confirming
 * is what reaches it.
 *
 * ## Config — validated at construction, the `StorageService`/R2 pattern
 *
 * `STRIPE_SECRET_KEY` is required to construct at all (DEC-055 clause 13:
 * optional at the `ServerEnv` schema level so unrelated routes' startup never
 * fails; validated here, "where the capability is actually constructed").
 * `STRIPE_WEBHOOK_SECRET` is checked lazily inside `verifyWebhookSignature`
 * instead, mirroring `NullPaymentProvider`'s own `PAYMENT_WEBHOOK_DEV_SECRET`
 * handling exactly — it is needed for that one operation only.
 *
 * `apiVersion` is deliberately not pinned in the `Stripe` client config: the
 * installed SDK's own bundled default (`2026-08-26.dahlia`) already matches
 * the exact version the spike's live calls were made against, so pinning it
 * explicitly would only risk a compile-time literal mismatch on a future SDK
 * upgrade for zero behavioural gain today.
 *
 * ## Idempotency — DEC-055 clause 8, CRITICAL
 *
 * `PaymentsService` computes `input.idempotencyKey`'s *value* — `orderId` for
 * the initial attempt, `${orderId}:${attemptNo}` for a regenerated one —
 * never this adapter. Reusing `orderId` alone for a regenerated attempt would
 * make Stripe replay the *first* attempt's now-stale PaymentIntent instead of
 * minting a new one; the spike's own § 6 is the evidence this key strategy
 * actually produces the right Stripe behaviour (same key → same PaymentIntent;
 * different key → a new one).
 *
 * This adapter does **not** send `input.idempotencyKey` bare to both calls,
 * though — it suffixes it per endpoint (`:create`, `:confirm`). Live evidence
 * from this task's own Stripe Test-mode verification pass (beyond what the
 * original spike checked): Stripe rejects reusing one idempotency key across
 * two different endpoints outright —
 * *"Keys for idempotent requests can only be used for the same endpoint they
 * were first used for"* — a real `create`-then-`confirm` pair with the same
 * bare key fails on the second call. The suffix keeps both calls fully
 * deterministic per attempt (retrying `createPayment` with the same
 * `input.idempotencyKey` still replays the exact same create-then-confirm
 * pair) while giving each endpoint the endpoint-scoped key Stripe actually
 * requires.
 *
 * ## Presentation — DEC-055 Addendum A
 *
 * Maps `next_action.promptpay_display_qr_code.image_url_png` →
 * `presentation.imageUrl` (PNG, never SVG — the customer app has no SVG
 * renderer) and `.hosted_instructions_url` → `presentation.hostedInstructionsUrl`.
 * Stripe's own `data` field is read by nothing here and never leaves this
 * file — provider-internal by design (Addendum A-5). No expiry is read from
 * Stripe (none exists for this flow, confirmed by the spike's own exhaustive
 * key search) or invented here; `payment_attempts.expires_at` stays entirely
 * `PaymentsService`'s own policy, computed after this method returns.
 *
 * If confirmation succeeds but returns no `promptpay_display_qr_code`
 * `next_action` — an unexpected shape, not a modelled outcome — this throws
 * rather than returning a `CreatePaymentResult` with no presentation, which
 * would otherwise look to `PaymentsService` like an ordinary "no QR for this
 * method" case (a real possibility for a future non-QR method, but never
 * correct for a confirmed PromptPay attempt). `PaymentsService`'s existing
 * try/catch around `provider.createPayment()` turns this into
 * `PROVIDER_UNAVAILABLE`, the same existing domain-error path a network
 * failure already takes — no new error code, no adapter-side `DomainError`
 * import.
 *
 * ## Webhook normalization — DEC-055 clause 5
 *
 * `verifyWebhookSignature` is where the translation happens, before the
 * generic `WebhooksController`/`PaymentEventProcessingService` ever see a
 * Stripe-shaped field. The returned `rawPayload` carries flat top-level
 * `providerPaymentId`/`amountSatang`/`reason` — exactly what
 * `PaymentEventProcessingService`'s existing `readString`/`readAmount`
 * helpers already read — **and** the complete original Stripe event under
 * `stripeEvent`, so nothing is lost for forensics or audit (Addendum A's own
 * requirement). The generic processor is not modified and stays entirely
 * Stripe-unaware; every Stripe-specific field name and every nested
 * `data.object` lookup is confined to this one file.
 *
 * ## Cancellation has no generic BANHAO state yet
 *
 * `payment_intent.canceled` is verified-real, distinct from `payment.failed`
 * (retryable) and never BANHAO's own `EXPIRED` (`docs/STRIPE_PROMPTPAY_SANDBOX_SPIKE.md`
 * § 5). But `PaymentProvider` has no `cancel()` method and nothing in this
 * codebase's own call graph ever cancels a Stripe PaymentIntent — so in
 * ordinary operation this event should not occur, and no generic
 * `payments`/`payment_events` "cancelled" vocabulary is authorized by any
 * locked decision to invent here. The signature is still verified and the
 * event is still persisted (`payment_events`, full audit trail, per
 * `WebhooksController`'s existing ingest-only behaviour) — its normalized
 * `providerEvent` (`payment.canceled`) is simply a name
 * `PaymentEventProcessingService` does not recognize, so it lands in that
 * service's existing, already-tested `markUnsupportedEventType` path:
 * terminal, audited, never retried, never starving the queue. This is a
 * deliberate consequence of the currently-locked architecture, not a gap —
 * building real BANHAO-side cancellation-state handling is separate,
 * not-yet-authorized work.
 *
 * ## Refunds — Q-020 Slice 1 (DEC-057/058/059)
 *
 * `refund()` makes one real `POST /v1/refunds` call against the PaymentIntent
 * this provider originally confirmed. It returns only `providerRefundId`
 * (DEC-057 §7): the generic refund domain (`RefundService`) must never see a
 * Stripe `Refund` object, a Stripe `status` literal
 * (`requires_action`/`pending`/`succeeded`/`failed`/`canceled`), or any other
 * Stripe-specific field. Reading that status, and everything downstream of it
 * — provider-status verification, finality, and the DEC-049 ledger reversal —
 * is Slice 2's work, not this method's: DEC-057 §2 forbids treating this
 * call's synchronous response as refund finality, so nothing here is asked to
 * decide whether the refund actually completed.
 *
 * `input.amount`/`input.reason`/`input.providerPaymentId` are `RefundService`'s
 * own determination, sourced from the original payment's recorded amount
 * (DEC-057 §1 — full refund only, never a caller-chosen amount) — this
 * adapter neither derives nor validates any of them.
 *
 * `input.idempotencyKey` is the caller's already-deterministic local refund
 * identity (`refunds.id`, DEC-057 §7), used as-is. Unlike `createPayment`'s
 * create-then-confirm pair, a refund is exactly one Stripe call, so no
 * per-endpoint suffix is needed or applied.
 *
 * ## Refund webhook normalization — Q-020 Slice 2 (DEC-057 §5)
 *
 * `refund.created`/`refund.updated`/`charge.refunded` are normalized in
 * `normalizeEvent`, the same single place every other event's translation
 * already happens. `event.type` alone never decides anything (DEC-057 §5):
 * the refund object's own `status` is read and mapped through
 * `normalizeRefundStatus` — a private, file-local, five-way switch — before
 * it ever reaches `rawPayload`. `refund.created` and `refund.updated` are
 * folded into one BANHAO event name (`BANHAO_REFUND_STATUS_EVENT`) because
 * the two can carry an identical status and must be handled identically;
 * `charge.refunded` gets its own distinct name
 * (`BANHAO_CHARGE_REFUNDED_EVENT`) because it is a derived aggregate signal,
 * never a specific refund's identity, and must never be matched or finalized
 * against one. `RefundEventProcessingService` — the tick-side consumer,
 * mirroring `PaymentEventProcessingService`'s existing split — never sees a
 * Stripe status literal, a Stripe object shape, or a `re_...`/`ch_...` id
 * outside the flat `providerRefundId`/`providerPaymentId` fields this method
 * already produces for every other event.
 *
 * ## No Stripe Connect
 *
 * Every call in this file is a plain platform-account PaymentIntent —
 * no `on_behalf_of`, no `transfer_data`, no `application_fee_amount`, no
 * connected account of any kind (DEC-055 clause 4).
 */
@Injectable()
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';

  private readonly logger = new Logger(StripePaymentProvider.name);
  private readonly stripe: Stripe;
  private readonly webhookSecret: string | undefined;

  constructor() {
    const env = loadServerEnv();

    if (!env.stripeSecretKey) {
      throw new StripeConfigError(['STRIPE_SECRET_KEY']);
    }

    this.stripe = new Stripe(env.stripeSecretKey);
    this.webhookSecret = env.stripeWebhookSecret;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    // Suffixed, not reused bare, across the two calls — sandbox-verified live
    // (this task's own verification pass, not the original spike): Stripe
    // rejects an idempotency key at a second endpoint with "Keys for
    // idempotent requests can only be used for the same endpoint they were
    // first used for". Each suffix is still fully deterministic per attempt
    // (same `input.idempotencyKey` in → same two suffixed keys out every
    // time), so crash-recovery/retry behaviour is unchanged — a retried
    // `createPayment` call still replays the exact same create-then-confirm
    // pair rather than minting anything new.
    const createIdempotencyKey = `${input.idempotencyKey}:create`;
    const confirmIdempotencyKey = `${input.idempotencyKey}:confirm`;

    const intent = await this.stripe.paymentIntents.create(
      {
        amount: input.amount.amount,
        // Stripe's THB amount is already the smallest unit (satang), 1:1 —
        // confirmed by the spike (§ 2): no conversion is applied anywhere on
        // this path, matching CON-003's integer-satang discipline.
        currency: input.amount.currency.toLowerCase(),
        payment_method_types: ['promptpay'],
        metadata: {
          orderId: input.orderId,
          paymentReference: input.paymentReference,
        },
      },
      { idempotencyKey: createIdempotencyKey },
    );

    const confirmed = await this.stripe.paymentIntents.confirm(
      intent.id,
      {
        // billing_details[email] is required server-side for a PromptPay
        // confirm — a real HTTP 400 without it, per the spike (§ 2). `email`
        // is DEC-056's already-resolved, already-validated authoritative
        // customer email; this adapter neither derives nor re-validates it.
        payment_method_data: {
          type: 'promptpay',
          billing_details: { email: input.email },
        },
      },
      { idempotencyKey: confirmIdempotencyKey },
    );

    const qr = confirmed.next_action?.promptpay_display_qr_code;
    if (!qr) {
      throw new Error(
        `Stripe PromptPay confirm returned no promptpay_display_qr_code next_action for ` +
          `PaymentIntent ${confirmed.id} (status: ${confirmed.status}, ` +
          `next_action type: ${confirmed.next_action?.type ?? 'none'})`,
      );
    }

    return {
      providerPaymentId: confirmed.id,
      presentation: {
        type: 'QR_CODE',
        imageUrl: qr.image_url_png,
        hostedInstructionsUrl: qr.hosted_instructions_url,
        // qr.data intentionally not read — provider-internal (Addendum A-5).
        // No expiry read or invented — none exists on this flow (Addendum A).
      },
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const refund = await this.stripe.refunds.create(
      {
        payment_intent: input.providerPaymentId,
        amount: input.amount.amount,
        metadata: { reason: input.reason },
      },
      { idempotencyKey: input.idempotencyKey },
    );

    return { providerRefundId: refund.id };
  }

  /**
   * `constructEvent` is Stripe's own official verification — HMAC over the
   * *exact* raw bytes `WebhooksController` hands this method, never a
   * re-serialized reconstruction (CON-002's whole point: only a genuinely
   * signature-verified request may ever confirm a payment).
   */
  verifyWebhookSignature(rawBody: string, headers: Record<string, string>): WebhookVerification {
    if (!this.webhookSecret) {
      return { verified: false, reason: 'No payment provider configured' };
    }

    const signature = headers[STRIPE_SIGNATURE_HEADER];
    if (!signature) {
      return { verified: false, reason: 'Missing signature header' };
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch (cause) {
      return { verified: false, reason: (cause as Error).message };
    }

    return this.normalizeEvent(event);
  }

  /**
   * DEC-055 clause 5's translation, done once, here — the only place a
   * `data.object` lookup or a Stripe event-name literal is allowed to exist
   * in this codebase.
   */
  private normalizeEvent(event: Stripe.Event): WebhookVerification {
    switch (event.type) {
      case STRIPE_SUCCEEDED_EVENT: {
        const intent = event.data.object as Stripe.PaymentIntent;
        return {
          verified: true,
          providerPaymentId: intent.id,
          providerEventId: event.id,
          providerEvent: BANHAO_SUCCEEDED_EVENT,
          rawPayload: {
            providerPaymentId: intent.id,
            amountSatang: intent.amount_received,
            stripeEvent: event,
          },
        };
      }

      case STRIPE_FAILED_EVENT: {
        const intent = event.data.object as Stripe.PaymentIntent;
        return {
          verified: true,
          providerPaymentId: intent.id,
          providerEventId: event.id,
          providerEvent: BANHAO_FAILED_EVENT,
          rawPayload: {
            providerPaymentId: intent.id,
            reason: intent.last_payment_error?.message,
            stripeEvent: event,
          },
        };
      }

      case STRIPE_CANCELED_EVENT: {
        // Terminal, verified-real, and deliberately not mapped onto any
        // BANHAO EXPIRED/FAILED state — see this class's own doc comment,
        // "Cancellation has no generic BANHAO state yet". `providerEvent`
        // here is a name `PaymentEventProcessingService` does not recognize
        // on purpose, so it is captured (signature-verified, persisted) and
        // then safely, terminally set aside by that service's own existing
        // `markUnsupportedEventType` path — never retried, never starving.
        const intent = event.data.object as Stripe.PaymentIntent;
        return {
          verified: true,
          providerPaymentId: intent.id,
          providerEventId: event.id,
          providerEvent: BANHAO_CANCELED_EVENT,
          rawPayload: {
            providerPaymentId: intent.id,
            stripeEvent: event,
          },
        };
      }

      case STRIPE_REFUND_CREATED_EVENT:
      case STRIPE_REFUND_UPDATED_EVENT: {
        // Q-020 Slice 2 (DEC-057 §5) — the object's own status is the
        // evidence, read here and nowhere else. `refund.created` and
        // `refund.updated` are deliberately folded into the same BANHAO
        // event name; see BANHAO_REFUND_STATUS_EVENT's own comment.
        const refund = event.data.object as Stripe.Refund;
        const providerPaymentId = readPaymentIntentId(refund.payment_intent, event.id);
        return {
          verified: true,
          providerPaymentId,
          providerEventId: event.id,
          providerEvent: BANHAO_REFUND_STATUS_EVENT,
          rawPayload: {
            providerRefundId: refund.id,
            providerPaymentId,
            status: normalizeRefundStatus(refund.status),
            amountSatang: refund.amount,
            stripeEvent: event,
          },
        };
      }

      case STRIPE_CHARGE_REFUNDED_EVENT: {
        // A derived aggregate signal about the charge, never a specific
        // refund's identity (DEC-057 §5) — captured for forensics only.
        // `RefundEventProcessingService` recognizes this name and marks it
        // inert without attempting to match or finalize any refund from it.
        const charge = event.data.object as Stripe.Charge;
        const providerPaymentId = readPaymentIntentId(charge.payment_intent, event.id);
        return {
          verified: true,
          providerPaymentId,
          providerEventId: event.id,
          providerEvent: BANHAO_CHARGE_REFUNDED_EVENT,
          rawPayload: {
            chargeId: charge.id,
            providerPaymentId,
            refunded: charge.refunded,
            amountRefunded: charge.amount_refunded,
            stripeEvent: event,
          },
        };
      }

      default: {
        // Any event type outside DEC-055 clause 7's subscribed three (plus
        // the refund-domain events handled above, DEC-057 §5) — the Stripe
        // Dashboard endpoint should not be configured to send one, but this
        // must never crash if it does. Most Stripe resources carry `id`;
        // falls back to the event's own id rather than guessing one.
        this.logger.warn(`Received an unsubscribed Stripe event type: ${event.type}`);
        const objectWithId = event.data.object as { id?: string };
        return {
          verified: true,
          providerPaymentId: objectWithId?.id ?? event.id,
          providerEventId: event.id,
          providerEvent: event.type,
          rawPayload: { stripeEvent: event },
        };
      }
    }
  }

}
