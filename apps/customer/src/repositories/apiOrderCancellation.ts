/**
 * `POST /api/v1/orders/:id/cancel`, through the shared API client (DEC-050).
 *
 * Same shape as `apiOrderCreation.ts`: this **only translates**. It sends the
 * order id from the route and nothing else — no customer id, no state, no
 * reason the customer did not type. The API is the authority on whether this
 * order is inside the free-cancellation window and whether it is theirs; a
 * refusal arrives as an error and is rethrown unchanged for the screen to
 * present.
 */

import type { ApiClient } from '@banhao/api-client';
import { apiClient as defaultClient } from '../lib/apiClient';
import type { OrderCancellationRepository } from './types';

export function createApiOrderCancellationRepository(
  client: ApiClient = defaultClient,
): OrderCancellationRepository {
  return {
    async cancelOrder(orderId: string): Promise<void> {
      await client.request<{ orderId: string; state: string }>(`/api/v1/orders/${orderId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
    },
  };
}

export const apiOrderCancellationRepository = createApiOrderCancellationRepository();
