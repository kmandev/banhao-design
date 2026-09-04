/**
 * `POST /api/v1/cart/validate`, consumed through the shared API client
 * (Phase D · checkout revalidation).
 *
 * A separate seam from `supabaseCart.ts` on purpose: DEC-APP-008 puts cart CRUD
 * on Supabase (the documented client-write exception) and everything requiring
 * the trusted writer on the NestJS API. Two transports is what the architecture
 * actually says, so two repositories make that visible rather than hiding an
 * HTTP call inside a module named for Supabase.
 *
 * This repository **only translates**. It maps the wire shape to the domain and
 * turns the two named server conflicts into `CartConflictError`. It does not
 * decide whether a cart is valid, and it re-implements none of the server's
 * rules — `CartService` is the authority (V1.1 §6, "re-price against live
 * catalog").
 */

import type { ApiClient } from '@banhao/api-client';
import { ApiClientError } from '@banhao/api-client';
import { apiClient as defaultClient } from '../lib/apiClient';
import {
  CartConflictError,
  type CartValidation,
  type ExpectedLine,
  type PriceChange,
  type UnavailableItem,
} from '../domain/cartValidation';
import type { CartValidationRepository } from './types';

/** `PRICE_CHANGED` details, as `CartService.checkPriceChanges` builds them. */
interface PriceChangedDetails {
  lines?: { cartItemId: string; expectedSatang: number; currentSatang: number }[];
}

/** `ITEM_UNAVAILABLE` details, as `CartService.validate` builds them. */
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

export function createApiCartValidationRepository(
  client: ApiClient = defaultClient,
): CartValidationRepository {
  return {
    async validate(expectedLines: ExpectedLine[]): Promise<CartValidation> {
      try {
        return await client.request<CartValidation>('/api/v1/cart/validate', {
          method: 'POST',
          // Sent even when empty so the request body is always the same shape.
          // The server treats an absent/empty list as "skip the comparison" and
          // still returns a fully server-computed subtotal either way.
          body: JSON.stringify({ expectedLines }),
        });
      } catch (cause) {
        if (cause instanceof ApiClientError) {
          // These are the conflicts the customer can act on. Everything
          // else — 401, 500, INVALID_RESPONSE, a network throw — falls through
          // and stays a failure, so the caller fails closed rather than
          // treating an unreachable server as an accepted cart.
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

          // M-13: the restaurant is Paused. CartService raises this for the
          // identical condition `POST /orders` already reports, so both
          // revalidation calls agree.
          if (cause.code === 'RESTAURANT_CLOSED') {
            throw new CartConflictError({ kind: 'RESTAURANT_CLOSED' });
          }
        }

        throw cause;
      }
    },
  };
}

export const apiCartValidationRepository = createApiCartValidationRepository();
