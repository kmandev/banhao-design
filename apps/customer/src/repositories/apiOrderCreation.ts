/**
 * `POST /api/v1/orders`, consumed through the shared API client (Phase E-3A).
 *
 * Same shape as `apiCartValidation.ts` on purpose: this **only translates**.
 * It sends exactly what the caller supplies — an address id and the prices
 * the customer was shown — plus the one payment method the API's own
 * contract accepts today (`ONLINE`, DEC-016), and maps the two named
 * server conflicts to `CartConflictError`. It re-implements none of the
 * server's rules; `OrdersService` is the authority.
 *
 * `paymentMethod` is not a parameter here — see `CreateOrderInput`'s own
 * doc comment for why.
 */

import type { ApiClient } from '@banhao/api-client';
import { ApiClientError } from '@banhao/api-client';
import { apiClient as defaultClient } from '../lib/apiClient';
import { CartConflictError, type PriceChange, type UnavailableItem } from '../domain/cartValidation';
import type { CreateOrderInput, CreatedOrder, OrderCreationRepository } from './types';

/** `PRICE_CHANGED` details, as `CartService.checkPriceChanges` builds them. */
interface PriceChangedDetails {
  lines?: { cartItemId: string; expectedSatang: number; currentSatang: number }[];
}

/** `ITEM_UNAVAILABLE` details, as `CartService.validate` builds them (reused by `OrdersService`). */
interface ItemUnavailableDetails {
  items?: { cartItemId: string; menuItemId: string }[];
}

function toPriceChanges(details: unknown): PriceChange[] {
  const lines = (details as PriceChangedDetails | undefined)?.lines ?? [];
  return lines.map((line) => ({
    cartItemId: line.cartItemId,
    wasSatang: line.expectedSatang,
    nowSatang: line.currentSatang,
  }));
}

function toUnavailableItems(details: unknown): UnavailableItem[] {
  return (details as ItemUnavailableDetails | undefined)?.items ?? [];
}

/** Wire shape of a successful `POST /api/v1/orders` response. */
interface CreateOrderApiResponse {
  orderId: string;
  orderNumber: string;
  state: string;
}

export function createApiOrderCreationRepository(
  client: ApiClient = defaultClient,
): OrderCreationRepository {
  return {
    async create(input: CreateOrderInput): Promise<CreatedOrder> {
      try {
        return await client.request<CreateOrderApiResponse>('/api/v1/orders', {
          method: 'POST',
          body: JSON.stringify({
            addressId: input.addressId,
            paymentMethod: 'ONLINE',
            expectedLines: input.expectedLines,
          }),
        });
      } catch (cause) {
        if (cause instanceof ApiClientError) {
          // Reachable because OrdersService re-prices the cart the same way
          // CartService.validate does — a genuine race between the last
          // /cart/validate call and this one, not a bug. Same two conflicts,
          // same UI, on purpose (V1.1 §6, CheckoutScreen's own conflict cards).
          if (cause.code === 'PRICE_CHANGED') {
            throw new CartConflictError({
              kind: 'PRICE_CHANGED',
              changes: toPriceChanges(cause.details),
            });
          }

          if (cause.code === 'ITEM_UNAVAILABLE') {
            throw new CartConflictError({
              kind: 'ITEM_UNAVAILABLE',
              items: toUnavailableItems(cause.details),
            });
          }

          // M-13: reachable the same way PRICE_CHANGED/ITEM_UNAVAILABLE are
          // here — a genuine race between the last /cart/validate call and
          // this one (the restaurant paused in between), not a bug. Same
          // conflict, same UI, whichever of the two calls detects it.
          if (cause.code === 'RESTAURANT_CLOSED') {
            throw new CartConflictError({ kind: 'RESTAURANT_CLOSED' });
          }
        }

        // Everything else — CART_EMPTY, MIXED_RESTAURANT, NOT_FOUND
        // (address), NOT_IMPLEMENTED (DEC-E-01's fee gate), VALIDATION_FAILED,
        // INTERNAL_ERROR, a network throw — is not a conflict the customer
        // can act on. It stays a failure, so the caller fails closed rather
        // than treating it as a created order.
        throw cause;
      }
    },
  };
}

export const apiOrderCreationRepository = createApiOrderCreationRepository();
