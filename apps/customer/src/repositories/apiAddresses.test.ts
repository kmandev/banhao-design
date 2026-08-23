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

  it('carries the raw fields through for edit-mode prefill (Phase DQ-04)', async () => {
    const { client } = stubClient([ROW]);
    const [address] = await createApiAddressRepository(client).listAddresses();
    expect(address).toMatchObject({
      rawLabel: ROW.label,
      recipientName: ROW.recipientName,
      recipientPhone: ROW.recipientPhone,
      addressLine: ROW.addressLine,
      landmark: ROW.landmark,
      instructions: ROW.instructions,
      lat: ROW.lat,
      lng: ROW.lng,
    });
  });

  it('carries a null rawLabel through unchanged, distinct from the recipientName fallback used for display', async () => {
    const { client } = stubClient([{ ...ROW, label: null }]);
    const [address] = await createApiAddressRepository(client).listAddresses();
    expect(address?.rawLabel).toBeNull();
    expect(address?.label).toBe(ROW.recipientName);
  });
});

describe('apiAddresses — createAddress', () => {
  function stubMutation(row: unknown): { client: ApiClient; request: jest.Mock } {
    const request = jest.fn().mockResolvedValue(row);
    return { client: { request } as unknown as ApiClient, request };
  }

  it('POSTs to /api/v1/me/addresses with the given input', async () => {
    const { client, request } = stubMutation(ROW);
    await createApiAddressRepository(client).createAddress({
      recipientName: ROW.recipientName,
      recipientPhone: ROW.recipientPhone,
      addressLine: ROW.addressLine,
      isDefault: true,
    });

    expect(request).toHaveBeenCalledWith(
      '/api/v1/me/addresses',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse((request.mock.calls[0][1] as { body: string }).body);
    expect(body).toEqual({
      recipientName: ROW.recipientName,
      recipientPhone: ROW.recipientPhone,
      addressLine: ROW.addressLine,
      isDefault: true,
    });
  });

  it('maps the created row back into an Address', async () => {
    const { client } = stubMutation(ROW);
    const address = await createApiAddressRepository(client).createAddress({
      recipientName: ROW.recipientName,
      recipientPhone: ROW.recipientPhone,
      addressLine: ROW.addressLine,
    });
    expect(address.id).toBe(ROW.id);
  });

  it('surfaces an API failure to the caller', async () => {
    const request = jest.fn().mockRejectedValue(new Error('VALIDATION_FAILED'));
    const client = { request } as unknown as ApiClient;
    await expect(
      createApiAddressRepository(client).createAddress({
        recipientName: '',
        recipientPhone: '',
        addressLine: '',
      }),
    ).rejects.toThrow('VALIDATION_FAILED');
  });
});

describe('apiAddresses — updateAddress', () => {
  it('PATCHes /api/v1/me/addresses/:id with only the given patch fields', async () => {
    const request = jest.fn().mockResolvedValue(ROW);
    const client = { request } as unknown as ApiClient;
    await createApiAddressRepository(client).updateAddress(ROW.id, { recipientName: 'ใหม่' });

    expect(request).toHaveBeenCalledWith(
      `/api/v1/me/addresses/${ROW.id}`,
      expect.objectContaining({ method: 'PATCH' }),
    );
    const body = JSON.parse((request.mock.calls[0][1] as { body: string }).body);
    expect(body).toEqual({ recipientName: 'ใหม่' });
  });

  it('maps the updated row back into an Address', async () => {
    const request = jest.fn().mockResolvedValue({ ...ROW, recipientName: 'ใหม่' });
    const client = { request } as unknown as ApiClient;
    const address = await createApiAddressRepository(client).updateAddress(ROW.id, {
      recipientName: 'ใหม่',
    });
    expect(address.recipientName).toBe('ใหม่');
  });
});

describe('apiAddresses — archiveAddress', () => {
  it('DELETEs /api/v1/me/addresses/:id', async () => {
    const request = jest.fn().mockResolvedValue(undefined);
    const client = { request } as unknown as ApiClient;
    await createApiAddressRepository(client).archiveAddress(ROW.id);

    expect(request).toHaveBeenCalledWith(
      `/api/v1/me/addresses/${ROW.id}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('surfaces an archive failure to the caller', async () => {
    const request = jest.fn().mockRejectedValue(new Error('NOT_FOUND'));
    const client = { request } as unknown as ApiClient;
    await expect(createApiAddressRepository(client).archiveAddress(ROW.id)).rejects.toThrow(
      'NOT_FOUND',
    );
  });
});
