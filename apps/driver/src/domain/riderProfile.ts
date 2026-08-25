/**
 * Driver App rider-identity domain — the rider's own record (Phase G, V1.1 §15).
 *
 * Read from `public.riders` through `riders_select_own`
 * (`supabase/migrations/20260811000011_rls_policies.sql`), which scopes every
 * row to `user_id = auth.uid()`. A rider's status is a server fact; nothing in
 * this app may compute, cache past a read, or default it.
 *
 * **Deliberately money-free**, same rule the two G6.3/G6.4 domains hold:
 * `riders` carries no money column and none is added here. `rating_avg`,
 * `rating_count`, `service_area_id` and `zone_id` are also absent — the geo
 * domain is deferred (no FK exists yet) and ratings drive no Phase G screen.
 */

/**
 * `riders.status` — the deployed CHECK vocabulary, verbatim
 * (`supabase/migrations/20260811000008_rider_domain.sql`).
 *
 * Typed as a union rather than `string` because the approval gate branches on
 * it: DEC-UX-006 gives `APPROVED` an online toggle and every other value none,
 * so a value this app cannot interpret must be a compile error, not a screen
 * that silently falls through to the permissive branch.
 */
export type RiderStatus =
  | 'REGISTERED'
  | 'DOCUMENTS_SUBMITTED'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'DOCUMENTS_REJECTED'
  | 'SUSPENDED'
  | 'DEACTIVATED';

/** Every value of the deployed CHECK, for exhaustive runtime narrowing. */
export const RIDER_STATUSES: readonly RiderStatus[] = [
  'REGISTERED',
  'DOCUMENTS_SUBMITTED',
  'PENDING_APPROVAL',
  'APPROVED',
  'DOCUMENTS_REJECTED',
  'SUSPENDED',
  'DEACTIVATED',
];

/**
 * The one status that authorises work.
 *
 * The same single constant `CapabilitiesService` and `BroadcastDispatchStrategy`
 * each use server-side (`ACTIVE_RIDER_STATUS`). Kept as one exported value so
 * the gate cannot drift into a list of "approved-ish" states.
 */
export const APPROVED_RIDER_STATUS: RiderStatus = 'APPROVED';

/**
 * The signed-in user's rider record, or the absence of one.
 *
 * `null` from the repository means this user has no `riders` row at all — they
 * are signed in but have never been registered as a rider. That is a real,
 * expected state (rider onboarding is BQ-022, `OPEN` and
 * `LEGAL_REVIEW_REQUIRED`, and this app deliberately cannot create one), not
 * an error and not a reason to invent an identity.
 */
export interface RiderProfile {
  riderId: string;
  fullName: string;
  status: RiderStatus;
  vehicleType: string | null;
  plate: string | null;
}

/** Whether this rider may be offered work at all — DEC-UX-006's gate. */
export function isApproved(profile: RiderProfile | null): boolean {
  return profile?.status === APPROVED_RIDER_STATUS;
}
