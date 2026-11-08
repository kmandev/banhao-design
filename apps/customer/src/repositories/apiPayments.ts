/**
 * `POST /api/v1/orders/:id/payment`, through the shared API client.
 *
 * Only translates. It sends the order id and nothing else: the amount is the
 * order's own `grand_total_satang`, resolved by the server (DEC-E-01), and the
 * QR is the provider's. The three refusals a customer can act on become a
 * `PaymentStartError`; anything else is rethrown for the screen's generic
 * error state, so an unreachable server is never mistaken for a refusal.
 */

import type { PaymentInitiationResponse } from '@banhao/validation';
import { ApiClientError, type ApiClient } from '@banhao/api-client';
import { apiClient as defaultClient } from '../lib/apiClient';
import { PaymentStartError, type PaymentRepository, type PaymentStart } from './types';

const REFUSALS: Record<string, PaymentStartError['refusal']> = {
  CUSTOMER_EMAIL_REQUIRED: 'EMAIL_REQUIRED',
  ORDER_NOT_PAYABLE: 'NOT_PAYABLE',
  PAYMENT_ALREADY_SUCCEEDED: 'ALREADY_PAID',
};

export function createApiPaymentRepository(client: ApiClient = defaultClient): PaymentRepository {
  return {
    async startPayment(orderId: string): Promise<PaymentStart> {
      try {
        const response = await client.request<PaymentInitiationResponse>(`/api/v1/orders/${orderId}/payment`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        return {
          paymentId: response.paymentId,
          amountSatang: response.amountSatang,
          qrImageUrl: response.qr?.imageUrl ?? null,
          expiresAt: response.qr?.expiresAt ?? null,
        };
      } catch (cause) {
        if (cause instanceof ApiClientError && REFUSALS[cause.code]) {
          throw new PaymentStartError(REFUSALS[cause.code] as PaymentStartError['refusal']);
        }
        throw cause;
      }
    },
  };
}

export const apiPaymentRepository = createApiPaymentRepository();
