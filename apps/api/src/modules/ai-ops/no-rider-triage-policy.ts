import { Injectable } from '@nestjs/common';
import { NO_RIDER_DECISION_SECONDS } from '../rider/no-rider-escalation.service';
import type { PolicyResolution } from './ai-ops.types';

/** The policy inputs the No Rider Triage playbook needs before it may act. */
export interface NoRiderTriagePolicy {
  /**
   * How long a delivery may keep searching before DEC-022 says a person, not
   * the system, owns it.
   */
  readonly decisionPointSeconds: number;
}

/**
 * The port, for the same reason the merchant-side one exists: the policy
 * source is injected, so a test can vary the value without any production
 * code learning a second number.
 */
export abstract class NoRiderTriagePolicySource {
  abstract resolve(): PolicyResolution<NoRiderTriagePolicy>;
}

/**
 * Phase J — stage 3 for the No Rider Triage playbook. Unlike the merchant
 * side, this one **resolves**, because the value it needs is already approved.
 *
 * DEC-022 locks the no-rider ladder: a 5-minute notice window, then an
 * 8-minute decision point after which "an operator handles it manually", and
 * never an automatic cancellation ("cancellation is a decision, never a
 * timeout" — `docs/RIDER_LIFECYCLE.md` § 7). Both numbers are already cited
 * constants in `NoRiderEscalationService`, and this class imports the decision
 * point from there rather than restating it: two copies of one approved
 * number is how a decision quietly becomes two decisions.
 *
 * Note precisely what is and is not being reused. The *same actor* (the
 * operator), the *same decision* (DEC-022), the *same clock*
 * (`deliveries.created_at`). That is reuse. Borrowing, say, the rider offer
 * window from `dispatch-policy.ts` to stand in for a merchant deadline would
 * be aliasing one decision onto another, which
 * `Bq013MerchantAcceptancePolicySource` refuses for exactly that reason.
 *
 * What stays MISSING here is everything DEC-022 does *not* say: there is no
 * approved terminal outcome for "nobody ever accepts" (UX-Q-006 is open), so
 * this playbook has no command at all and can only escalate. The policy
 * resolving is a licence to *notice*, never a licence to decide.
 */
@Injectable()
export class Dec022NoRiderTriagePolicySource extends NoRiderTriagePolicySource {
  resolve(): PolicyResolution<NoRiderTriagePolicy> {
    return {
      status: 'RESOLVED',
      value: { decisionPointSeconds: NO_RIDER_DECISION_SECONDS },
      policyVersion: 'DEC-022',
    };
  }
}
