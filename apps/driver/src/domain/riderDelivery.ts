/**
 * Driver App delivery domain — the rider's own view of the delivery they are
 * currently working (Phase G-7.2).
 *
 * ## Why this reads `deliveries` and not a view
 *
 * `rider_order_view` (`20260811000012_rider_order_views.sql`) projects the
 * *order* — it carries no `delivery_id` and no delivery state at all, so it
 * cannot answer "which step am I on" after an app restart. The delivery row
 * itself can: `deliveries_select_rider`
 * (`20260811000011_rls_policies.sql:566`) grants `select` on `deliveries`
 * scoped by `is_assigned_rider(rider_id)`, which is exactly "the deliveries
 * that are mine". No migration and no new view is needed for this read; see
 * `docs/BANHAO_POD_DRIVER_IMPLEMENTATION_PLAN.md` §4.1.
 *
 * ## Deliberately money-free, and deliberately narrow
 *
 * The RLS grant is a **full-row** one, so `rider_earning_satang` and
 * `proof_photo_path` are readable here in a way they are not through the
 * order views. This domain type projects neither, and
 * `riderDeliveryQueries.ts` does not select them:
 *
 * - **`rider_earning_satang`** — BQ-029 is `OPEN` and the column is NULL by
 *   instruction. Same rule the whole driver app already follows
 *   (`domain/riderAvailability.ts`, `domain/riderOrder.ts`): a rider money
 *   field that cannot be computed is not rendered as a zero, a dash, or a
 *   placeholder.
 * - **`proof_photo_path`** — POD is the next phase. Nothing in this slice
 *   captures, uploads, or displays a proof photo, so nothing here reads its
 *   path.
 * - **`pickup_lat/lng`, `dropoff_lat/lng`, `distance_m`** — no map exists in
 *   this app. `rider_order_view` already carries the delivery address and
 *   landmark the rider actually navigates by.
 */

/**
 * The delivery states in which a rider is holding an active delivery.
 *
 * Mirrors `ACTIVE_DELIVERY_STATES` in
 * `apps/api/src/modules/rider/dispatch-policy.ts`, which took them from the
 * deployed `deliveries.state` CHECK. Kept as a client-side constant rather
 * than imported because `@banhao/validation` does not export it and adding it
 * there for one screen would widen a shared package for no other caller.
 *
 * `DELIVERED`, `FAILED` and `ABANDONED` are terminal and deliberately absent:
 * a delivery in any of them is finished, and the rider's active-delivery
 * screen must show "no active delivery", not a completed one it can no longer
 * act on.
 *
 * **`ARRIVED` (DEC-054) must stay in this list.** `riderDeliveryQueries.ts`
 * filters the rider's own `deliveries` read by exactly these values, so a
 * server that can produce `ARRIVED` while this array cannot name it would tell
 * a rider standing at the customer's door that they have no active delivery.
 * That is why the client half of DEC-054 shipped in the same slice as the
 * server half.
 */
export const ACTIVE_DELIVERY_STATES = [
  'RIDER_ASSIGNED',
  'AT_MERCHANT',
  'PICKED_UP',
  'EN_ROUTE',
  'ARRIVED',
  'RIDER_REASSIGNING',
] as const;

export type ActiveDeliveryState = (typeof ACTIVE_DELIVERY_STATES)[number];

/**
 * The delivery the caller is currently assigned to.
 *
 * `state` is left as `string` for the same reason `RiderOrderDetail.state` is:
 * it is the database's own CHECK-constrained vocabulary, and narrowing it in
 * two places by hand would have to be kept in lockstep for a distinction no
 * screen makes. {@link isActiveDeliveryState} is the one place that decides.
 */
export interface RiderActiveDelivery {
  deliveryId: string;
  orderId: string;
  state: string;
  assignedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
}

export function isActiveDeliveryState(state: string): state is ActiveDeliveryState {
  return (ACTIVE_DELIVERY_STATES as readonly string[]).includes(state);
}

/**
 * The rider-facing steps of a delivery, in order — the progression the
 * approved Driver App redesign draws as R-06+ (`ไปที่ร้าน · รับอาหารแล้ว ·
 * ออกไปส่ง · ส่งสำเร็จ`), with the customer-arrival step DEC-054 added between
 * the last two.
 *
 * Each step names the **command** that leaves the state before it, so the
 * screen never has to map states to buttons inline. Every one of the five
 * endpoints exists (`RiderController`).
 *
 * ## Step 4's copy is transcribed, not authored
 *
 * `ถึงจุดส่งแล้ว` (button) and `ถึงจุดส่ง` (step title) are the POD UX
 * design's own words for exactly this action — `docs/design/BANHAO POD UX
 * Design.dc.html` renders `ถึงจุดส่งแล้ว` as the primary button of the arrival
 * frame, and `docs/RIDER_LIFECYCLE.md` §4 records the same four-word rider
 * flow (`ถึงร้านแล้ว → รับอาหารแล้ว → ถึงจุดส่ง → ส่งสำเร็จ`). Nothing here is
 * invented, and in particular **no DEC-053 failure copy is invented**: there
 * is no "customer unreachable", no "cannot deliver", no contact control and no
 * failure button on this screen. The rider records arrival; the *operator*
 * declares a failure (DEC-053 § 2), and that surface is a later slice.
 *
 * The POD design also states, at PD-04, that arrival is "a screen state, not a
 * server state" — true when it was written, and superseded on that one point
 * by DEC-054, which makes `ARRIVED` a real delivery state. A `DEC-` outranks a
 * design artifact (`CLAUDE.md` § 10). Every other POD rule is unchanged.
 *
 * ## Step 5 is still reachable without step 4
 *
 * The server accepts a completion from `EN_ROUTE` as well as `ARRIVED`, so a
 * rider on an older build — or one who simply never taps arrival — is not
 * blocked. This list is the *recommended* path, never a precondition; neither
 * DEC-053 nor DEC-054 makes arrival mandatory before delivering.
 */
export type DeliveryAction = 'arrived' | 'pickedUp' | 'enRoute' | 'arrivedAtCustomer' | 'delivered';

export interface DeliveryStep {
  /** 1-based, as shown to the rider (`ขั้นที่ N จาก DELIVERY_STEPS.length`). */
  readonly index: number;
  /** The delivery state a rider must be in for this step's action to be available. */
  readonly from: ActiveDeliveryState;
  readonly action: DeliveryAction;
  /** The button label — the redesign's own Thai copy. */
  readonly label: string;
  /** What the rider is doing during this step, shown as the step's own title. */
  readonly title: string;
}

export const DELIVERY_STEPS: readonly DeliveryStep[] = [
  { index: 1, from: 'RIDER_ASSIGNED', action: 'arrived', label: 'ถึงร้านแล้ว', title: 'ไปที่ร้าน' },
  { index: 2, from: 'AT_MERCHANT', action: 'pickedUp', label: 'รับอาหารแล้ว', title: 'รับอาหารที่ร้าน' },
  { index: 3, from: 'PICKED_UP', action: 'enRoute', label: 'ออกไปส่ง', title: 'ออกเดินทางไปส่ง' },
  {
    index: 4,
    from: 'EN_ROUTE',
    action: 'arrivedAtCustomer',
    label: 'ถึงจุดส่งแล้ว',
    title: 'ถึงจุดส่ง',
  },
  { index: 5, from: 'ARRIVED', action: 'delivered', label: 'ส่งสำเร็จ', title: 'ส่งถึงลูกค้า' },
] as const;

/**
 * The step a delivery in `state` is currently on, or `null` when no rider
 * action is available from it.
 *
 * `RIDER_REASSIGNING` deliberately returns `null`: the delivery is counted as
 * active (so the rider still sees it rather than an empty screen) but
 * `release_rider_assignment()` may be mid-flight on it, and offering a
 * transition button from a state no endpoint accepts would produce a
 * guaranteed 409.
 */
export function currentStep(state: string): DeliveryStep | null {
  return DELIVERY_STEPS.find((step) => step.from === state) ?? null;
}
