import type { ApiClient } from '@banhao/api-client';
import { ApiClientError } from '@banhao/api-client';
import { createApiDeliveryProofRepository } from './apiDeliveryProof';

/**
 * Phase G7.4 / T3.4 — `apiDeliveryProof.ts`'s mapping from the
 * `GET /api/v1/orders/:id/delivery-proof` wire response to the local
 * `DeliveryProof` shape. Mirrors `apiAddresses.test.ts`'s own structure: one
 * describe block per repository concern, asserting the request that was
 * built and the value that came back — not merely that a mock was called.
 */

function stubClient(response: unknown): { client: ApiClient; request: jest.Mock } {
  const request = jest.fn().mockResolvedValue(response);
  return { client: { request } as unknown as ApiClient, request };
}

const ROW = {
  photoUrl: 'https://r2.example.com/signed/deliveries/order-1/proof/abc.jpg?sig=xyz',
  capturedAt: '2026-08-26T11:00:00.000Z',
  deliveredAt: '2026-08-26T11:00:00.000Z',
};

describe('apiDeliveryProof — request', () => {
  it('GETs /api/v1/orders/:id/delivery-proof for the given order id', async () => {
    const { client, request } = stubClient(ROW);
    await createApiDeliveryProofRepository(client).getDeliveryProof('order-1');

    expect(request).toHaveBeenCalledWith('/api/v1/orders/order-1/delivery-proof');
  });

  it('sends only the order id — no body, no extra headers, no customer/rider identifiers', async () => {
    const { client, request } = stubClient(ROW);
    await createApiDeliveryProofRepository(client).getDeliveryProof('order-1');

    // A single positional argument: the path. No second `init` argument
    // carrying a body or extra fields — ownership and identity are resolved
    // entirely server-side from the caller's own session.
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]).toEqual(['/api/v1/orders/order-1/delivery-proof']);
  });
});

describe('apiDeliveryProof — mapping a present proof', () => {
  it('maps a valid API response into the DeliveryProof shape', async () => {
    const { client } = stubClient(ROW);
    const proof = await createApiDeliveryProofRepository(client).getDeliveryProof('order-1');

    expect(proof).toEqual({
      photoUrl: ROW.photoUrl,
      capturedAt: ROW.capturedAt,
      deliveredAt: ROW.deliveredAt,
    });
  });

  it('passes photoUrl through as an opaque string, without asserting its exact value', async () => {
    const { client } = stubClient(ROW);
    const proof = await createApiDeliveryProofRepository(client).getDeliveryProof('order-1');

    expect(typeof proof?.photoUrl).toBe('string');
    expect(proof?.photoUrl.length).toBeGreaterThan(0);
  });

  it('does not transform, drop, or expose any field beyond the three the API contract defines', async () => {
    const { client } = stubClient(ROW);
    const proof = await createApiDeliveryProofRepository(client).getDeliveryProof('order-1');

    expect(Object.keys(proof ?? {}).sort()).toEqual(['capturedAt', 'deliveredAt', 'photoUrl']);
  });
});

describe('apiDeliveryProof — mapping a null proof', () => {
  it('maps a null API response to null', async () => {
    const { client } = stubClient(null);
    const proof = await createApiDeliveryProofRepository(client).getDeliveryProof('order-1');

    expect(proof).toBeNull();
  });
});

describe('apiDeliveryProof — error handling', () => {
  it('maps NOT_FOUND to null — the API folds "no such order" and "not yours" into it deliberately', async () => {
    const request = jest.fn().mockRejectedValue(
      new ApiClientError(404, { code: 'NOT_FOUND', message: 'Order not found' }),
    );
    const client = { request } as unknown as ApiClient;

    const proof = await createApiDeliveryProofRepository(client).getDeliveryProof('order-1');
    expect(proof).toBeNull();
  });

  it('propagates any other ApiClientError unchanged, using existing repository conventions', async () => {
    const request = jest.fn().mockRejectedValue(
      new ApiClientError(500, { code: 'INTERNAL_ERROR', message: 'boom' }),
    );
    const client = { request } as unknown as ApiClient;

    await expect(
      createApiDeliveryProofRepository(client).getDeliveryProof('order-1'),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('propagates a network failure unchanged', async () => {
    const request = jest.fn().mockRejectedValue(new Error('Network request failed'));
    const client = { request } as unknown as ApiClient;

    await expect(
      createApiDeliveryProofRepository(client).getDeliveryProof('order-1'),
    ).rejects.toThrow('Network request failed');
  });
});
