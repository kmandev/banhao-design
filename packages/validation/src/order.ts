import { z } from 'zod';
import { uuidSchema } from './common';
import { expectedLineSchema } from './cart';

/**
 * `POST /api/v1/orders` request body (Phase E-2).
 *
 * What the client may legitimately choose, and nothing else. In particular,
 * absent by design: `customerId` (the verified JWT subject, never the body —
 * `CartService.validate` already sets this precedent), `restaurantId` (derived
 * server-side from the caller's own cart), `orderNumber` (DEC-E-03, database-
 * owned), and every money field (`subtotalSatang`, `deliveryFeeSatang`,
 * `serviceFeeSatang`, `discountSatang`, `grandTotalSatang` — DEC-E-01: the
 * server prices from the live catalog and an as-yet-unbuilt fee source, never
 * from anything a client asserts).
 */
export const createOrderRequestSchema = z
  .object({
    /** Must belong to the caller and not be archived — checked server-side (DEC-E-04). */
    addressId: uuidSchema,
    /**
     * DEC-016: Cash on Delivery is disabled in Phase 1. `orders.payment_method`
     * stays a two-value CHECK (`ONLINE`, `CASH`) for when COD returns, but this
     * is the service boundary DEC-016 says must reject it until then — so only
     * `ONLINE` is accepted here, not the column's full range.
     */
    paymentMethod: z.literal('ONLINE'),
    /**
     * Same shape and same purpose as `POST /cart/validate`'s field of the same
     * name: what the client last displayed for each line, so the server can
     * name a `PRICE_CHANGED` line rather than silently re-pricing. Optional —
     * omitting it skips that comparison (V1.1 §6 lists `PRICE_CHANGED` as a
     * `POST /orders` failure case precisely because a customer may reach
     * checkout without a fresh `/cart/validate` call in between).
     */
    expectedLines: z.array(expectedLineSchema).optional(),
  })
  .strict();

export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;

/** The response `POST /api/v1/orders` returns on success. */
export interface CreateOrderResponse {
  orderId: string;
  orderNumber: string;
  state: string;
}

/**
 * `POST /api/v1/orders/:id/cancel` request body (Phase E-4.1).
 *
 * `reason` is free text, not a cause-code enum — the cause-code vocabulary
 * (`docs/ORDER_LIFECYCLE.md` § 6) is `PROPOSED`, not `ACCEPTED`, so nothing may
 * validate against it yet. The field is optional: an operator cancellation
 * should always carry one (DEC-032), but that is a service-level expectation,
 * not something this shared schema can distinguish from a customer's.
 */
export const cancelOrderRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export type CancelOrderRequest = z.infer<typeof cancelOrderRequestSchema>;

/** The response every `POST /api/v1/orders/:id/...` transition returns on success. */
export interface OrderTransitionResponse {
  orderId: string;
  state: string;
}

/**
 * `GET /api/v1/orders/:id/delivery-proof` (Phase G-7.4, Plan §8.3).
 *
 * `null` is a valid, successful response — no delivery yet, no photo on
 * record, the object no longer exists, or the referenced-photo retention
 * window (DEC-039, 90 days from `deliveredAt`) has elapsed. `photoUrl` is a
 * short-lived signed GET (`StorageService.getSignedDownloadUrl`), never a raw
 * object key or a public URL.
 *
 * `capturedAt` and `deliveredAt` are the same instant and the same column
 * (`deliveries.delivered_at`): the proof photo is written in the same guarded
 * `UPDATE` that moves the delivery to `DELIVERED` (`DeliveryCompletionService`),
 * so no separate capture timestamp exists.
 */
export interface DeliveryProofResponse {
  photoUrl: string;
  capturedAt: string;
  deliveredAt: string;
}
