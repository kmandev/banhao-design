import { Injectable } from '@nestjs/common';
import type { PolicyResolution } from './ai-ops.types';

/** The policy inputs the Merchant Acceptance Timeout playbook needs before it may act. */
export interface MerchantAcceptanceTimeoutPolicy {
  /** How long a merchant has to accept a `PAID` order before the timeout fires. */
  readonly acceptanceDeadlineSeconds: number;
  /** How long before the deadline a reminder is sent. */
  readonly reminderLeadSeconds: number;
}

/**
 * The port. Injected, so a test can supply a resolved policy and exercise the
 * downstream command path without a value ever existing in production code.
 */
export abstract class MerchantAcceptancePolicySource {
  abstract resolve(): PolicyResolution<MerchantAcceptanceTimeoutPolicy>;
}

/**
 * Phase J — stage 3, production implementation: **there is no approved
 * merchant-acceptance deadline, so this resolves to `MISSING` and the
 * pipeline fails closed.**
 *
 * This is the correct behaviour, not a stub awaiting completion. BQ-013
 * ("merchant accept timeout behaviour") is `OPEN` in
 * `docs/OPEN_BUSINESS_QUESTIONS.md`: it establishes that a deadline should be
 * server-side and configurable, and supplies **no number**. The AI Operations
 * design package says the same thing in its own words about this exact
 * playbook — "Auto-pause has no threshold (BQ-013 open) and no consequence
 * policy… Three minutes appears nowhere."
 *
 * DEC-040 §5 is therefore what this class implements: a missing decision is
 * never a licence to choose a default. Note what is deliberately absent —
 * there is no `?? 180`, no environment-variable fallback, and no "sensible"
 * constant. `DISPATCH_ACCEPT_WINDOW`/`ACCEPT_WINDOW_SECONDS` in
 * `rider/dispatch-policy.ts` is the **rider** offer window fixed by DEC-037
 * and must not be borrowed for the merchant side: they are different actors,
 * different decisions, and reusing one number for the other would be
 * inventing the merchant policy by aliasing.
 *
 * When BQ-013 is decided, the shape of the fix is the DEC-037/DEC-039
 * precedent: approved numbers become cited constants in a policy module that
 * names the decision, and this class returns `RESOLVED` with a
 * `policyVersion`. That is a documentation-and-constant change here — no
 * pipeline stage below this one has to move.
 */
@Injectable()
export class Bq013MerchantAcceptancePolicySource extends MerchantAcceptancePolicySource {
  resolve(): PolicyResolution<MerchantAcceptanceTimeoutPolicy> {
    return {
      status: 'MISSING',
      dependency: 'BQ-013',
      detail:
        'No approved merchant acceptance deadline exists. BQ-013 is OPEN: it requires a server-side configurable deadline and supplies no value, and the AI Operations design package records the same gap for this playbook. DEC-040 §5 forbids inventing one.',
    };
  }
}
