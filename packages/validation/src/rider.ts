import { z } from 'zod';

/**
 * Rider-facing schemas — Phase G-2 (broadcast dispatch, DEC-020 + DEC-037).
 *
 * Deliberately tiny. The only thing a rider client sends in this slice is a
 * coordinate pair; everything else about a rider — who they are, whether they
 * are approved — is resolved server-side from domain membership on every
 * request (DEC-033 / DEC-APP-004) and is never accepted from the wire.
 */

/**
 * The rider's current position.
 *
 * Both coordinates are **required**, unlike `createAddressSchema`'s optional
 * pair: `rider_availability.location` is a generated column that is null
 * unless both are present, and DEC-037 makes "a valid recorded location" part
 * of dispatch eligibility. A half-pair would therefore be a write that
 * silently leaves the rider undispatchable — better rejected at the boundary.
 *
 * `.strict()` matters here beyond tidiness: it is what stops a client from
 * smuggling a `riderId` (or an `is_online`) into a body whose identity is
 * supposed to come from the verified JWT alone.
 */
export const riderLocationRequestSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .strict();

export type RiderLocationRequest = z.infer<typeof riderLocationRequestSchema>;

/** `POST /api/v1/rider/location` — what the rider's own availability row now holds. */
export interface RiderLocationResponse {
  riderId: string;
  /** ISO-8601. `rider_availability.location_updated_at` as just written. */
  locationUpdatedAt: string;
}

/**
 * `POST /api/v1/rider/offers/:id/accept` — the delivery this rider just won.
 *
 * Carries no money field of any kind: `deliveries.rider_earning_satang` stays
 * `NULL` while BQ-029 is `OPEN`, and an endpoint that returned an earning
 * would be inventing one.
 */
export interface RiderOfferAcceptResponse {
  deliveryId: string;
  /** `RIDER_ASSIGNED` on success — the delivery domain's own state (DEC-018). */
  state: string;
  riderId: string;
}

/**
 * `POST /api/v1/rider/deliveries/:id/cancel` — DEC-021's rider-cancel/release
 * slice (Phase G-3). Same shape as `cancelOrderRequestSchema`: a short,
 * optional free-text reason, `.strict()` so no other field — in particular no
 * rider id — can be smuggled into a body whose identity is otherwise always
 * resolved server-side from the verified JWT and database membership.
 */
export const riderCancelDeliveryRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export type RiderCancelDeliveryRequest = z.infer<typeof riderCancelDeliveryRequestSchema>;

/**
 * `POST /api/v1/rider/deliveries/:id/cancel` — the delivery, released back to
 * search. Carries no money field, same reasoning as `RiderOfferAcceptResponse`.
 */
export interface RiderCancelDeliveryResponse {
  deliveryId: string;
  /** Always `RIDER_SEARCHING` on success — `release_rider_assignment`'s only outcome (DEC-021). */
  state: string;
  riderId: string;
}

/**
 * `POST /api/v1/rider/deliveries/:id/arrived` — Phase G-4. No request body:
 * the delivery id comes from the route and the rider's identity from the
 * verified JWT capability (`user.capabilities.rider.riderId`), same as
 * `POST /rider/offers/:id/accept`. Carries no money field, same reasoning as
 * `RiderOfferAcceptResponse`.
 */
export interface RiderArrivedResponse {
  deliveryId: string;
  /** Always `AT_MERCHANT` on success — the only outcome this transition produces. */
  state: string;
  riderId: string;
}

/**
 * `POST /api/v1/rider/deliveries/:id/picked-up` — Phase G-5, the order ↔
 * delivery join point (V1.1 §7). No request body, same reasoning as
 * `RiderArrivedResponse`. Carries no money field, same reasoning as
 * `RiderOfferAcceptResponse`.
 */
export interface RiderPickedUpResponse {
  deliveryId: string;
  orderId: string;
  /** Always `PICKED_UP` on success — both the delivery's and the order's new state. */
  state: string;
  riderId: string;
}
