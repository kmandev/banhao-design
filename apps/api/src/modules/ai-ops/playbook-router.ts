import type { OperationalEvent, PlaybookId } from './ai-ops.types';

/**
 * Phase J — stage 2. The deterministic router.
 *
 * This is the first and, for a recognized event, usually the last decision
 * stage. It matches an event against a fixed table and returns a playbook, or
 * `null`. It contains no model call by construction: an event whose routing
 * is knowable from its own facts must never cost a model invocation, which is
 * the whole economic and safety argument of the design package's § 05.
 *
 * A `null` return is escalated as `ESC-UNKNOWN` by the caller. It is not
 * "ask the agent to guess" — the agent is reached only *after* a playbook is
 * chosen and its policy inputs resolve, never as a fallback for routing.
 */
export class PlaybookRouter {
  route(event: OperationalEvent): PlaybookId | null {
    if (event.aggregateType === 'order' && event.eventType === 'PaymentSucceeded') {
      // An order has just been paid, so it is now awaiting merchant
      // acceptance. Whether it has actually timed out is a *policy* question
      // (BQ-013), answered by the next stage — never here.
      return 'MERCHANT_ACCEPTANCE_TIMEOUT';
    }

    if (event.aggregateType === 'delivery' && event.eventType === 'OrderNoRiderFound') {
      // A delivery has crossed DEC-022's 5-minute notice window still
      // searching. Whether it has also crossed the 8-minute decision point —
      // the moment DEC-022 hands it to a person — is a *policy* comparison,
      // answered by the next stage against an approved constant.
      return 'NO_RIDER_TRIAGE';
    }

    return null;
  }
}
