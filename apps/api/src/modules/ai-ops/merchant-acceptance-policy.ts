import { Injectable } from '@nestjs/common';
import type { PolicyResolution } from './ai-ops.types';

/** The policy inputs the Merchant Acceptance Timeout playbook needs before it may act. */
export interface MerchantAcceptanceTimeoutPolicy {
  /** How long a merchant has to accept a `PAID` order before the timeout fires. */
  readonly acceptanceDeadlineSeconds: number;
  /**
   * How long before the deadline a reminder is sent. Optional because no value
   * is approved: DEC-068 C1 says the system "may" remind the restaurant but
   * names no lead time, and DEC-040 §5 forbids supplying one.
   */
  readonly reminderLeadSeconds?: number;
}

/**
 * The port. Injected, so a test can supply a resolved policy and exercise the
 * downstream command path without a value ever existing in production code.
 */
export abstract class MerchantAcceptancePolicySource {
  abstract resolve(): PolicyResolution<MerchantAcceptanceTimeoutPolicy>;
}

/**
 * The merchant acceptance deadline: **5 minutes** from payment confirmation.
 *
 * Source: DEC-068 C1 (Product Owner, 2026-11-02), answering the deadline half
 * of BQ-013. The clock starts when the order is `PAID` (`orders.paid_at`).
 * This is the only number the decision supplies — see the class comment for
 * what it deliberately does not.
 */
export const MERCHANT_ACCEPTANCE_DEADLINE_SECONDS = 5 * 60;

/**
 * Phase J — stage 3, production implementation. **This resolves, because the
 * deadline is now approved (DEC-068 C1).** Until then it resolved `MISSING`
 * and failed closed, which was the correct behaviour while BQ-013 supplied no
 * number.
 *
 * What the decision does and does not say matters for how far this goes:
 *
 * - It supplies a deadline and says what happens at it: an operator is alerted
 *   and decides. **No automatic cancellation**, and any cancellation or refund
 *   follows DEC-058.
 * - It does **not** supply merchant auto-pause thresholds, counts, windows,
 *   durations or a cooldown — BQ-013 stays `OPEN` for those, and DEC-040 §5
 *   still forbids inventing them. Nothing here pauses a restaurant.
 * - It does **not** supply a reminder lead time, so none is set
 *   (`reminderLeadSeconds` stays absent) and no reminder is scheduled.
 *
 * Note what is still refused: borrowing `ACCEPT_WINDOW_SECONDS` from
 * `rider/dispatch-policy.ts`. That is the **rider** offer window (DEC-037), a
 * different actor and decision; the merchant deadline is its own cited
 * constant above.
 */
@Injectable()
export class Dec068C1MerchantAcceptancePolicySource extends MerchantAcceptancePolicySource {
  resolve(): PolicyResolution<MerchantAcceptanceTimeoutPolicy> {
    return {
      status: 'RESOLVED',
      value: { acceptanceDeadlineSeconds: MERCHANT_ACCEPTANCE_DEADLINE_SECONDS },
      policyVersion: 'DEC-068-C1',
    };
  }
}
