import type { DeliveryFeeSettingRequest, DeliveryFeeSettingsResponse } from '@banhao/validation';
import { apiClient } from '../lib/apiClient';

/** DEC-071 — the delivery-fee setting. Read by any staff; changed by ADMIN only (the API enforces it). */
export interface PricingRepository {
  deliveryFee(): Promise<DeliveryFeeSettingsResponse>;
  setDeliveryFee(request: DeliveryFeeSettingRequest): Promise<DeliveryFeeSettingsResponse>;
}

const PATH = '/api/v1/admin/supervisor/pricing/delivery-fee';

export const pricingRepository: PricingRepository = {
  deliveryFee() {
    return apiClient.request<DeliveryFeeSettingsResponse>(PATH);
  },
  setDeliveryFee(request) {
    return apiClient.request<DeliveryFeeSettingsResponse>(PATH, { method: 'PUT', body: JSON.stringify(request) });
  },
};
