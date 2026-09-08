import { DELIVERY_FAILURE_WAIT_SECONDS } from '@banhao/validation';

/**
 * DEC-053 § 3's customer-arrival wait, expressed once for every reader.
 *
 * Same shape and the same reasoning as `dispatch-policy.ts`: an approved
 * decision belongs in one cited place, and every service that needs it imports
 * it rather than restating the number. Two readers exist —
 * `ArrivalTimeoutEscalationService` (the tick phase that raises the
 * escalation) and `DeliveryFailureService` (the operator command and its
 * awaiting-failure listing) — and a divergence between them would mean the
 * operator was shown cases the command would then refuse, or the reverse.
 *
 * The value itself lives in `@banhao/validation` beside DEC-053's other
 * constants, because the driver and admin apps may eventually need it too.
 * Nothing here re-derives or rounds it.
 */
export const ARRIVAL_TIMEOUT_SECONDS = DELIVERY_FAILURE_WAIT_SECONDS;

/**
 * The delivery state a customer-arrival timeout can apply to.
 *
 * Exactly one: `ARRIVED` (DEC-054). A delivery still `EN_ROUTE` has not
 * reached the customer, so no wait has begun; one that is `DELIVERED`,
 * `FAILED` or `ABANDONED` has ended and cannot be waiting for anything.
 */
export const ARRIVAL_TIMEOUT_DELIVERY_STATE = 'ARRIVED';

/**
 * The order state that must accompany it.
 *
 * `DELIVERING` is the order-domain name for the same step (DEC-018 — the two
 * domains genuinely disagree on the word). Requiring it is what stops an
 * escalation being raised for a delivery whose order has already ended some
 * other way, which would show an operator a case the failure command would
 * then refuse.
 */
export const ARRIVAL_TIMEOUT_ORDER_STATE = 'DELIVERING';

/**
 * The `arrived_at` cutoff at `now`: a delivery that arrived at or before this
 * instant has waited long enough.
 *
 * Inclusive by construction — a delivery whose wait is *exactly*
 * {@link ARRIVAL_TIMEOUT_SECONDS} old is eligible, matching
 * `DeliveryFailureService`'s own `elapsed < required` refusal so the listing
 * and the command agree at the boundary rather than differing by a second.
 */
export function arrivalTimeoutCutoff(now: Date): string {
  return new Date(now.getTime() - ARRIVAL_TIMEOUT_SECONDS * 1000).toISOString();
}
