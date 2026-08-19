import type { ApiClient } from '@banhao/api-client';
import { createApiAddressRepository } from './apiAddresses';

/**
 * Phase E-3A — `apiAddresses.ts`'s mapping from the Phase B wire shape to
 * the `Address` shape `AddressRepository` already promised. The point of
 * this repository is that `CheckoutScreen`/`AddressScreen` keep rendering
 * unchanged while the underlying `id` becomes a real database row
 * (DEC-E-04) — these tests prove the mapping preserves that id exactly and
 * degrades sensibly when the real, richer shape lacks a mock-era field.
 */

function stubClient(rows: unknown[]): { client: ApiClient; request: jest.Mock } {
  const request = jest.fn().mockResolvedValue(rows);
  return { client: { request } as unknown as ApiClient, request };
}

const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  label: 'บ้าน',
  recipientName: 'ลูกค้า ทดสอบ',
  recipientPhone: '+66811111111',
  addressLine: 'ที่อยู่ทดสอบ',
  landmark: 'ใกล้ตลาด',
  instructions: null,
  lat: 14.3,
  lng: 105.2,
  isDefault: true,
  createdAt: '2026-08-19T00:00:00Z',
  updatedAt: '2026-08-19T00:00:00Z',
};

describe('apiAddresses — request', () => {
  it('GETs /api/v1/me/addresses', async () => {
    const { client, request } = stubClient([ROW]);
    await createApiAddressRepository(client).listAddresses();
    expect(request).toHaveBeenCalledWith('/api/v1/me/addresses');
  });
});

describe('apiAddresses — mapping', () => {
  it('preserves the real database id — the value an order is created against', async () => {
    const { client } = stubClient([ROW]);
    const [address] = await createApiAddressRepository(client).listAddresses();
    expect(address?.id).toBe(ROW.id);
  });

  it('uses the custom label when the customer set one', async () => {
    const { client } = stubClient([ROW]);
    const [address] = await createApiAddressRepository(client).listAddresses();
    expect(address?.label).toBe('บ้าน');
  });

  it('falls back to the recipient name when no custom label is set', async () => {
    const { client } = stubClient([{ ...ROW, label: null }]);
    const [address] = await createApiAddressRepository(client).listAddresses();
    expect(address?.label).toBe(ROW.recipientName);
  });

  it('includes the landmark in the line when present', async () => {
    const { client } = stubClient([ROW]);
    const [address] = await createApiAddressRepository(client).listAddresses();
    expect(address?.line).toBe(`${ROW.addressLine} · ${ROW.landmark}`);
  });

  it('uses the plain address line when there is no landmark', async () => {
    const { client } = stubClient([{ ...ROW, landmark: null }]);
    const [address] = await createApiAddressRepository(client).listAddresses();
    expect(address?.line).toBe(ROW.addressLine);
  });

  it('carries isDefault through unchanged', async () => {
    const { client } = stubClient([{ ...ROW, isDefault: false }]);
    const [address] = await createApiAddressRepository(client).listAddresses();
    expect(address?.isDefault).toBe(false);
  });

  it('maps an empty list to an empty list', async () => {
    const { client } = stubClient([]);
    const addresses = await createApiAddressRepository(client).listAddresses();
    expect(addresses).toEqual([]);
  });
});
