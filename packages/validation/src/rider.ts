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
 * `POST /api/v1/rider/offers/:id/decline` — Phase G-6.2 (V1.1 §7's
 * `accept|decline` pair). No request body, same reasoning as
 * `RiderOfferAcceptResponse`. Carries no `deliveryId`: unlike accept, decline
 * never touches the delivery domain (DEC-018) — it is a single-row transition
 * on `rider_assignment_attempts` alone — so there is no delivery state to
 * report. Carries no money field, same reasoning as `RiderOfferAcceptResponse`.
 */
export interface RiderOfferDeclineResponse {
  offerId: string;
  riderId: string;
  /** Always `DECLINED` on success — `rider_assignment_attempts.outcome`'s own value. */
  outcome: string;
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

/**
 * `POST /api/v1/rider/deliveries/:id/en-route` — Phase G-6. No request body,
 * same reasoning as `RiderArrivedResponse`. Carries no money field, same
 * reasoning as `RiderOfferAcceptResponse`.
 *
 * **Two fields, because the two domains genuinely disagree on the name here.**
 * `RiderPickedUpResponse` could collapse both into one `state` only because
 * DEC-019 and the delivery state machine happen to use the same word
 * (`PICKED_UP`) for that step. This transition is the one place they diverge:
 * V1.1 §7 records it as order `PICKED_UP -> DELIVERING` whose delivery-side
 * effect is `-> EN_ROUTE`. Reporting a single `state` would force a client to
 * guess which machine it names, so both are stated — which is DEC-018's
 * separation made visible rather than papered over.
 */
export interface RiderEnRouteResponse {
  deliveryId: string;
  orderId: string;
  /** Always `EN_ROUTE` on success — the **delivery** domain's own state (DEC-018). */
  state: string;
  /** Always `DELIVERING` on success — the **order** domain's state for the same step. */
  orderState: string;
  riderId: string;
}

/**
 * `POST /api/v1/rider/deliveries/:id/proof/upload-url` — POD, Phase G-7.2
 * Phase 2. Presigns a `PUT` for exactly one proof photo.
 *
 * Only `contentType` — the object **key is never supplied by the client**. The
 * server templates it from the delivery id it has already authorized the
 * caller for (`deliveryProofObjectKey`), which is what makes "a rider cannot
 * upload to another rider's delivery" true by construction rather than by a
 * check that could be forgotten.
 *
 * `.strict()` for the same reason `riderLocationRequestSchema` is: a body that
 * tries to name a key, a bucket, or a delivery must be rejected outright
 * rather than silently ignored.
 */
export const riderProofUploadUrlRequestSchema = z
  .object({
    /** Validated again server-side against the storage module's own allow-list. */
    contentType: z.string().min(1),
  })
  .strict();

export type RiderProofUploadUrlRequest = z.infer<typeof riderProofUploadUrlRequestSchema>;

export interface RiderProofUploadUrlResponse {
  /** A presigned PUT, scoped to one object, one operation, one content type, 5 minutes. */
  uploadUrl: string;
  /** The server-templated key the client must echo back to the delivered command. */
  objectKey: string;
}

/**
 * `POST /api/v1/rider/deliveries/:id/delivered` — Phase G-7.2, the terminal
 * rider transition.
 *
 * **The proof photo is REQUIRED** (DEC-038, resolving BQ-018 as mandatory). With COD disabled (DEC-016) the photo is the only evidence a
 * handover happened, which `docs/RIDER_LIFECYCLE.md` §10 says raises its
 * importance rather than lowering it. `objectKey` is therefore not optional
 * here, and the API — not the client — is where that rule is enforced.
 *
 * A rider who genuinely cannot photograph has **no app path** to completion by
 * the same decision (DEC-038): the blocked screen directs them to an
 * operator, and the delivery stays open. Nothing in this contract admits a
 * no-photo completion.
 */
export const riderDeliveredRequestSchema = z
  .object({
    /**
     * The key returned by `…/proof/upload-url`, echoed back verbatim. The
     * server re-parses it against the delivery it authorized rather than
     * trusting it, and requires the object to actually exist before any state
     * moves — see `parseDeliveryProofObjectKey`.
     */
    objectKey: z.string().min(1),
  })
  .strict();

export type RiderDeliveredRequest = z.infer<typeof riderDeliveredRequestSchema>;

/**
 * Carries no money field, same reasoning as `RiderOfferAcceptResponse`.
 *
 * **One `state`, not two.** This response takes `RiderPickedUpResponse`'s
 * shape rather than `RiderEnRouteResponse`'s, for the same reason: both
 * domains genuinely use the same word here. `deliveries.state` becomes
 * `DELIVERED` and `orders.state` becomes `DELIVERED` (DEC-019's terminal
 * success), so a second field would restate the first rather than resolve an
 * ambiguity. `EN_ROUTE`/`DELIVERING` is the one step where they diverge.
 *
 * **No `proofPhotoPath` in the response.** The stored path is an internal
 * object key, meaningless without a signature and useless to the driver app,
 * which already holds the local file it just uploaded.
 */
export interface RiderDeliveredResponse {
  deliveryId: string;
  orderId: string;
  /** Always `DELIVERED` on success — both the delivery's and the order's new state. */
  state: string;
  /** `deliveries.delivered_at`, the moment the delivery was confirmed complete. */
  deliveredAt: string | null;
  riderId: string;
}
