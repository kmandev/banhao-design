/**
 * API-backed delivery transition repository — Phase G-7.2, giving the rider
 * delivery commands their client.
 *
 *   `POST /api/v1/rider/deliveries/:id/arrived`              (G-4, merchant arrival)
 *   `POST /api/v1/rider/deliveries/:id/picked-up`            (G-5)
 *   `POST /api/v1/rider/deliveries/:id/en-route`             (G-6)
 *   `POST /api/v1/rider/deliveries/:id/arrived-at-customer`  (BQ-017 Slice #1, DEC-054)
 *   `POST /api/v1/rider/deliveries/:id/delivered`            (G-7.2)
 *
 * The first and fourth are **different journeys' arrivals** and are never
 * interchangeable — see `markArrivedAtCustomer` below.
 *
 * Distinct from `riderDelivery.ts` on purpose: that repository is a direct
 * Supabase **read** under RLS (DEC-APP-008); these are **writes**, and
 * DEC-APP-008 puts every write through the API. Same read/write split
 * `riderOfferInbox.ts` (read) and `riderOfferActions.ts` (write) already draw
 * for the offer surface — this file is the delivery surface's
 * `riderOfferActions.ts`.
 *
 * **No client-side state machine.** Nothing here checks which transition is
 * legal from which state; that is the server's guarded conditional UPDATE
 * (ADR-003), and duplicating it on the client would put the client in front of
 * the authority. `domain/riderDelivery.ts`'s `currentStep` decides which
 * *button* to render, never whether a call is allowed — a rider who taps a
 * stale button gets the server's `INVALID_TRANSITION`, which is the correct
 * outcome.
 *
 * Every endpoint above already exists and is unmodified by this file. This
 * module only translates: it re-implements none of the server's ownership,
 * state, or idempotency rules, and it never writes `deliveries`,
 * `rider_assignments` or `rider_availability` directly — it could not, since
 * `authenticated` holds no `update` grant on any of the three.
 *
 * Errors are deliberately **not** wrapped into an opaque message, matching
 * `riderOfferActions.ts`: callers branch on `ApiClientError.code`
 * (`INVALID_TRANSITION`, `NOT_ASSIGNED_RIDER`, `NOT_FOUND`, `FORBIDDEN`), so
 * the error is left for the caller to inspect rather than collapsed into one
 * string.
 */

import type { ApiClient } from '@banhao/api-client';
import type {
  RiderArrivedAtCustomerResponse,
  RiderArrivedResponse,
  RiderDeliveredResponse,
  RiderEnRouteResponse,
  RiderPickedUpResponse,
} from '@banhao/validation';
import { apiClient as defaultClient, getAccessToken as defaultGetAccessToken } from '../lib/apiClient';
// Reused rather than redeclared — see `riderOfferActions.ts` for why.
import { NotAuthenticatedError } from './apiRiderLocation';

export interface RiderDeliveryActionsRepository {
  /** `RIDER_ASSIGNED -> AT_MERCHANT`. Delivery domain only (DEC-018). */
  markArrived(deliveryId: string): Promise<RiderArrivedResponse>;
  /** `AT_MERCHANT -> PICKED_UP`, and the order `READY_FOR_PICKUP -> PICKED_UP`. */
  markPickedUp(deliveryId: string): Promise<RiderPickedUpResponse>;
  /** `PICKED_UP -> EN_ROUTE`, and the order `PICKED_UP -> DELIVERING`. */
  markEnRoute(deliveryId: string): Promise<RiderEnRouteResponse>;
  /**
   * `EN_ROUTE -> ARRIVED` — the rider reached the **customer's** delivery
   * location (DEC-054). Delivery domain only: the order stays `DELIVERING`.
   *
   * **Not `markArrived`.** That one is merchant arrival
   * (`RIDER_ASSIGNED -> AT_MERCHANT`, `…/arrived`), at the shop, before
   * pickup. DEC-054 keeps the two permanently distinct — different endpoint,
   * different state, different meaning — so neither may be wired to the
   * other's path.
   *
   * Stamps `deliveries.arrived_at`, the anchor DEC-053's five-minute wait will
   * be measured from. That timer does not exist yet, and calling this starts
   * nothing: it records an operational fact.
   *
   * Optional, not a precondition — `markDelivered` still accepts a delivery
   * that is `EN_ROUTE`.
   */
  markArrivedAtCustomer(deliveryId: string): Promise<RiderArrivedAtCustomerResponse>;
  /**
   * `EN_ROUTE -> DELIVERED`, and the order `DELIVERING -> DELIVERED`.
   *
   * Also what releases the rider's assignment and availability slot, so a
   * successful call is what makes the rider dispatchable again — see
   * `DeliveryCompletionService`.
   *
   * `objectKey` is the **required** proof photo key (DEC-038, resolving
   * BQ-018 as mandatory), echoed back exactly as `…/proof/upload-url` returned
   * it. The server re-parses it against this delivery and requires the object
   * to genuinely exist before any state moves — this client neither builds nor
   * validates it.
   */
  markDelivered(deliveryId: string, objectKey: string): Promise<RiderDeliveredResponse>;
}

export function createRiderDeliveryActionsRepository(
  client: ApiClient = defaultClient,
  getAccessToken: () => Promise<string | null> = defaultGetAccessToken,
): RiderDeliveryActionsRepository {
  /**
   * One shape for all of them: refuse to transmit without a session, then POST
   * to the command path. A signed-out app must not issue a delivery transition at
   * all rather than send one and collect a 401 — the same precondition
   * `riderOfferActions.ts` applies.
   */
  async function command<T>(deliveryId: string, path: string, body?: unknown): Promise<T> {
    const token = await getAccessToken();
    if (!token) throw new NotAuthenticatedError();

    return client.request<T>(`/api/v1/rider/deliveries/${deliveryId}/${path}`, {
      method: 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  return {
    markArrived: (deliveryId) => command<RiderArrivedResponse>(deliveryId, 'arrived'),
    markPickedUp: (deliveryId) => command<RiderPickedUpResponse>(deliveryId, 'picked-up'),
    markEnRoute: (deliveryId) => command<RiderEnRouteResponse>(deliveryId, 'en-route'),
    markArrivedAtCustomer: (deliveryId) =>
      command<RiderArrivedAtCustomerResponse>(deliveryId, 'arrived-at-customer'),
    markDelivered: (deliveryId, objectKey) =>
      command<RiderDeliveredResponse>(deliveryId, 'delivered', { objectKey }),
  };
}
