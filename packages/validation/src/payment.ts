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
  /** Present whenever the (simulated, dev-only) provider returned one — absent only if it did not. */
  qr?: {
    value: string;
    expiresAt: string;
  };
}
