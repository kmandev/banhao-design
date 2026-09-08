import type { Satang } from '@banhao/types';

/**
 * `POST /api/v1/orders/:id/payment` (Phase F-1) has no request body.
 *
 * Everything the payment needs — amount, currency, method — is server-derived
 * from the order itself (`orders.grand_total_satang`, DEC-035/DEC-036's own
 * pricing authority extended to this boundary). There is nothing left for a
 * client to legitimately choose: Phase 1 is online-only (DEC-016), so even
 * `method` is not a client decision. No schema is exported because there is
 * nothing to parse.
 */

/** The response `POST /api/v1/orders/:id/payment` returns on success. */
export interface PaymentInitiationResponse {
  paymentId: string;
  paymentReference: string;
  /** `PENDING` on first creation and on every idempotent retry (DEC-028) — never anything else from this endpoint. */
  state: string;
  amountSatang: Satang;
  currency: string;
  /**
   * Present whenever the provider returned a presentation — absent only if
   * it did not. Provider-neutral (DEC-055 Addendum A): `imageUrl` is a QR
   * image the client renders directly; `hostedInstructionsUrl` is an
   * optional fallback page, present only when the provider call that minted
   * this attempt supplied one. `expiresAt` is BANHAO's own payment-attempt
   * expiry (`payment_attempts.expires_at`) — never a provider-supplied
   * value; the provider contract carries no expiry field at all.
   */
  qr?: {
    type: 'QR_CODE';
    imageUrl: string;
    hostedInstructionsUrl?: string;
    expiresAt: string;
  };
}
