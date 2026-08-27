/**
 * `GET /api/v1/orders/:id/delivery-proof`, consumed through the shared API
 * client (Phase G7.4 / T3.4).
 *
 * Same shape as `apiAddresses.ts`/`apiOrderCreation.ts` on purpose: this
 * **only translates**. It sends nothing but the order id already resolved
 * from the route (no customer id, no rider id, no object key — the API is
 * the sole authority on ownership and on minting the signed R2 URL), and maps
 * the wire response into the local `DeliveryProof` shape, which already
 * matches it field-for-field.
 */

import type { ApiClient } from '@banhao/api-client';
import { ApiClientError } from '@banhao/api-client';
import { apiClient as defaultClient } from '../lib/apiClient';
import type { DeliveryProof, DeliveryProofRepository } from './types';

/** Wire shape of `GET /api/v1/orders/:id/delivery-proof` (`DeliveryProofResponse`, `@banhao/validation`). */
interface DeliveryProofApiResponse {
  photoUrl: string;
  capturedAt: string;
  deliveredAt: string;
}

function toDeliveryProof(row: DeliveryProofApiResponse): DeliveryProof {
  return {
    photoUrl: row.photoUrl,
    capturedAt: row.capturedAt,
    deliveredAt: row.deliveredAt,
  };
}

export function createApiDeliveryProofRepository(
  client: ApiClient = defaultClient,
): DeliveryProofRepository {
  return {
    async getDeliveryProof(orderId: string): Promise<DeliveryProof | null> {
      try {
        const row = await client.request<DeliveryProofApiResponse | null>(
          `/api/v1/orders/${orderId}/delivery-proof`,
        );
        return row ? toDeliveryProof(row) : null;
      } catch (cause) {
        // `DeliveryProofService` folds "no such order" and "not this
        // customer's order" into the same NOT_FOUND, by design, for privacy
        // (its own doc comment). `OrderDetailScreen` only ever calls this
        // repository for an order its own Supabase/RLS read already proved is
        // real and the caller's own, so a NOT_FOUND here carries no
        // authorization information worth surfacing — it means only "nothing
        // to show", exactly like a genuine `null` body. Same pattern
        // `apiOrderCreation.ts` uses for its own two named conflict codes:
        // translate the specific code with a defined meaning here, and
        // rethrow everything else unchanged.
        if (cause instanceof ApiClientError && cause.code === 'NOT_FOUND') {
          return null;
        }

        throw cause;
      }
    },
  };
}

export const apiDeliveryProofRepository = createApiDeliveryProofRepository();
