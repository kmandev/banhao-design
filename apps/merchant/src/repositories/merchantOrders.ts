/**
 * The Order Board repository — the board's reads (M-2.3) and, since M-2.7,
 * the merchant's three order-transition commands.
 *
 * ## The read/write split is deliberate and is not symmetry for its own sake
 *
 * Reads go client → Supabase directly under RLS (DEC-APP-008), mirroring
 * `merchantRestaurant.ts`. There is no NestJS endpoint for the read and none
 * should be added: `orders_select_merchant` already scopes the rows to
 * restaurants this caller is an active member of.
 *
 * Writes go through the NestJS API, because DEC-APP-008 puts every write
 * there and because `authenticated` holds no `update` grant on `orders` at
 * all — a client-side write is not merely discouraged here, it is impossible.
 * The state check lives in the server's guarded conditional `UPDATE`'s
 * `WHERE` clause (ADR-003), never in a client-side check-then-act.
 *
 * The same split `apps/driver/src/repositories/` already draws twice
 * (`riderOfferInbox.ts`/`riderOfferActions.ts`, `riderDelivery.ts`/
 * `riderDeliveryActions.ts`). The driver app puts each half in its own file;
 * the board's write half is three body-less commands, so it stays in this
 * file rather than earning a second module for ~20 lines — M-2.7's brief
 * asks for the smallest appropriate public API and no new repository.
 *
 * ## No client-side state machine
 *
 * Nothing here checks which transition is legal from which state.
 * `orderBoardDisplay.presentOrderCard` decides which *button* to render;
 * whether the call is allowed is the server's answer, and a merchant who
 * presses a stale button gets `INVALID_TRANSITION`, which is the correct
 * outcome rather than a bug to prevent client-side.
 *
 * ## What this repository must never do
 *
 * It must never fabricate an order, and it must never treat a fetch failure
 * as an empty board — an empty array means the restaurant genuinely has no
 * matching orders yet, and a thrown error means the read itself failed; the
 * caller must be able to tell those two apart and must not retry-forever on
 * the first or silently show "no orders" on the second.
 *
 * Errors from the commands are deliberately **not** collapsed into an opaque
 * message, matching `riderDeliveryActions.ts`: callers branch on
 * `ApiClientError.code` (`INVALID_TRANSITION`, `NOT_RESTAURANT_MEMBER`,
 * `NOT_FOUND`), so the original failure is left intact for them to inspect.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApiClient } from '@banhao/api-client';
import type { OrderTransitionResponse } from '@banhao/validation';
import type { MerchantOrderSummary } from '../domain/order';
import type { OrderActionCommand } from '../lib/orderBoardDisplay';
import { fetchRestaurantOrders, toMerchantOrderSummary } from '../data/orderQueries';
import { apiClient as defaultApiClient } from '../lib/apiClient';

export interface MerchantOrdersRepository {
  /**
   * The given restaurant's current order-board projection, newest first.
   * May be empty. `restaurantId` must already be a verified membership (see
   * `fetchRestaurantOrders`'s own doc comment) — this call does not check
   * that itself.
   */
  listRestaurantOrders(restaurantId: string): Promise<MerchantOrderSummary[]>;

  /**
   * Issues one merchant transition command against
   * `POST /api/v1/orders/:orderId/:command`.
   *
   * One method rather than three, because all three endpoints are the same
   * call with a different final path segment: same verb, same 200, no request
   * body on any of them, and the identical `OrderTransitionResponse` back.
   * `OrderActionCommand`'s three values *are* the URL segments, so the caller
   * cannot name a command this API does not have.
   *
   *   `accept`          `PAID → MERCHANT_ACCEPTED`
   *   `start-preparing` `MERCHANT_ACCEPTED → PREPARING`
   *   `mark-ready`      `PREPARING → READY_FOR_PICKUP`
   *
   * The resolved value reports what the *server* did. It is intentionally not
   * the board's source of truth: the visible transition arrives over Realtime
   * (see `useOrderActions`), so nothing here is written into board state.
   */
  transitionOrder(orderId: string, command: OrderActionCommand): Promise<OrderTransitionResponse>;
}

export function createMerchantOrdersRepository(
  client: SupabaseClient,
  apiClient: ApiClient = defaultApiClient,
): MerchantOrdersRepository {
  return {
    listRestaurantOrders: async (restaurantId: string) => {
      const rows = await fetchRestaurantOrders(client, restaurantId);
      return rows.map(toMerchantOrderSummary);
    },

    transitionOrder: (orderId: string, command: OrderActionCommand) =>
      // No body: all three endpoints take none. Sending `{}` would be inventing
      // a request shape the controller does not declare — `accept` in
      // particular has no DTO at all, unlike `POST /orders/:id/cancel`.
      apiClient.request<OrderTransitionResponse>(`/api/v1/orders/${orderId}/${command}`, {
        method: 'POST',
      }),
  };
}
