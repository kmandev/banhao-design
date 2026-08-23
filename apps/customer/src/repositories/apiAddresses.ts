/**
 * `GET /api/v1/me/addresses`, consumed through the shared API client
 * (Phase E-3A).
 *
 * DEC-E-04: an order's address snapshot must come from the customer's
 * server-validated address, never a mock. This repository is the minimal
 * seam that makes that true — it maps the real Phase B API response into
 * the exact `Address` shape `AddressRepository` already promised
 * (`mocks/types.ts`), so `CheckoutScreen` and `AddressScreen` keep
 * rendering unchanged while what they render, and the `id` an order is
 * created against, is now genuinely the caller's own database row rather
 * than a fixture.
 *
 * `createAddress`/`updateAddress`/`archiveAddress` (Phase DQ-04) call the
 * same three endpoints `AddressesController` already exposed — no backend,
 * validation, or RLS change accompanies this file.
 */

import type { ApiClient } from '@banhao/api-client';
import { apiClient as defaultClient } from '../lib/apiClient';
import type { Address } from '../mocks/types';
import type { AddressPatchInput, AddressRepository, AddressWriteInput } from './types';

/** Wire shape of one row from `GET /api/v1/me/addresses` (`AddressesService`'s own `Address`). */
interface AddressApiResponse {
  id: string;
  label: string | null;
  recipientName: string;
  recipientPhone: string;
  addressLine: string;
  landmark: string | null;
  instructions: string | null;
  lat: number | null;
  lng: number | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * No `glyph` exists server-side — the design's icon-per-address concept was
 * never persisted (it is not in `public.addresses`), so every real address
 * renders with the same pin, matching the fallback `CheckoutScreen` already
 * uses for "no address selected" (`defaultAddress?.glyph ?? '📍'`).
 */
const ADDRESS_GLYPH = '📍';

function toAddress(row: AddressApiResponse): Address {
  return {
    id: row.id,
    // A custom label ("บ้าน", "ที่ทำงาน") when the customer set one;
    // otherwise the recipient name is more useful than a blank row.
    label: row.label ?? row.recipientName,
    glyph: ADDRESS_GLYPH,
    line: row.landmark ? `${row.addressLine} · ${row.landmark}` : row.addressLine,
    isDefault: row.isDefault,
    // Raw fields (DQ-04) — needed to prefill AddressFormScreen's edit mode.
    // `label` here is the unfallen-back value, so the form can tell "no
    // custom label" apart from "customer typed their own name as one".
    rawLabel: row.label,
    recipientName: row.recipientName,
    recipientPhone: row.recipientPhone,
    addressLine: row.addressLine,
    landmark: row.landmark,
    instructions: row.instructions,
    lat: row.lat,
    lng: row.lng,
  };
}

/** camelCase `AddressWriteInput`/`AddressPatchInput` already match the API's own body shape 1:1. */
function toRequestBody(input: AddressWriteInput | AddressPatchInput): Record<string, unknown> {
  return { ...input };
}

export function createApiAddressRepository(client: ApiClient = defaultClient): AddressRepository {
  return {
    async listAddresses(): Promise<Address[]> {
      const rows = await client.request<AddressApiResponse[]>('/api/v1/me/addresses');
      return rows.map(toAddress);
    },

    async createAddress(input: AddressWriteInput): Promise<Address> {
      const row = await client.request<AddressApiResponse>('/api/v1/me/addresses', {
        method: 'POST',
        body: JSON.stringify(toRequestBody(input)),
      });
      return toAddress(row);
    },

    async updateAddress(addressId: string, input: AddressPatchInput): Promise<Address> {
      const row = await client.request<AddressApiResponse>(
        `/api/v1/me/addresses/${addressId}`,
        { method: 'PATCH', body: JSON.stringify(toRequestBody(input)) },
      );
      return toAddress(row);
    },

    async archiveAddress(addressId: string): Promise<void> {
      await client.request<void>(`/api/v1/me/addresses/${addressId}`, { method: 'DELETE' });
    },
  };
}

export const apiAddressRepository = createApiAddressRepository();
