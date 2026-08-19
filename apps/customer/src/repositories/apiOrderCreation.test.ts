import { ApiClientError } from '@banhao/api-client';
import type { ApiClient } from '@banhao/api-client';
import type { ErrorCode } from '@banhao/types';
import { createApiOrderCreationRepository } from './apiOrderCreation';
import { CartConflictError } from '../domain/cartValidation';

/**
 * Phase E-3A — `apiOrderCreation.ts`'s translation from the wire to the domain.
 *
 * Same approach as `orders.service.spec.ts` on the API side: a stub client
 * records exactly what was sent, so these assert the actual request body —
 * not just that the repository resolves with plausible-looking data.
 */

function stubClient(response: { data?: unknown; error?: Error }): { client: ApiClient; request: jest.Mock } {
  const request = jest.fn().mockImplementation(() => {
    if (response.error) return Promise.reject(response.error);
    return Promise.resolve(response.data);
  });
  return { client: { request } as unknown as ApiClient, request };
}

const INPUT = {
  addressId: '11111111-1111-4111-8111-111111111111',
  expectedLines: [{ cartItemId: 'ci-1', expectedUnitPriceSatang: 6000 }],
};

describe('apiOrderCreation — request construction', () => {
  it('POSTs to /api/v1/orders', async () => {
    const { client, request } = stubClient({
      data: { orderId: 'order-1', orderNumber: 'BH-20260819-0001', state: 'CREATED' },
    });
    await createApiOrderCreationRepository(client).create(INPUT);

    expect(request).toHaveBeenCalledWith('/api/v1/orders', expect.objectContaining({ method: 'POST' }));
  });

  it('sends exactly addressId, paymentMethod, and expectedLines — nothing else', async () => {
    const { client, request } = stubClient({
      data: { orderId: 'order-1', orderNumber: 'BH-20260819-0001', state: 'CREATED' },
    });
    await createApiOrderCreationRepository(client).create(INPUT);

    const [, init] = request.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(['addressId', 'expectedLines', 'paymentMethod']);
  });

  it('paymentMethod is always exactly ONLINE — not a parameter the caller can vary', async () => {
    const { client, request } = stubClient({
      data: { orderId: 'order-1', orderNumber: 'BH-20260819-0001', state: 'CREATED' },
    });
    // CreateOrderInput has no paymentMethod field at all (see repositories/types.ts) —
    // this proves the repository itself sends 'ONLINE', not merely that
    // nothing else was passed in.
    await createApiOrderCreationRepository(client).create(INPUT);

    const [, init] = request.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as { paymentMethod: string };
    expect(body.paymentMethod).toBe('ONLINE');
  });

  it('there is no way to construct a request carrying customerId, restaurantId, orderNumber, or a money field', async () => {
    const { client, request } = stubClient({
      data: { orderId: 'order-1', orderNumber: 'BH-20260819-0001', state: 'CREATED' },
    });
    // Simulates a caller attempting to smuggle extra fields in — TypeScript
    // would already refuse this at compile time (CreateOrderInput is a
    // closed interface); this proves the repository ALSO ignores them at
    // runtime, i.e. safety does not depend solely on the type checker.
    await createApiOrderCreationRepository(client).create({
      ...INPUT,
      ...({
        customerId: 'someone-else',
        restaurantId: 'a-different-restaurant',
        orderNumber: 'BH-20200101-9999',
        deliveryFeeSatang: 1,
        serviceFeeSatang: 1,
        discountSatang: 1,
        grandTotalSatang: 1,
      } as Record<string, unknown>),
    });

    const [, init] = request.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['addressId', 'expectedLines', 'paymentMethod']);
  });

  it('passes expectedLines through unchanged — the same values the customer was shown', async () => {
    const { client, request } = stubClient({
      data: { orderId: 'order-1', orderNumber: 'BH-20260819-0001', state: 'CREATED' },
    });
    await createApiOrderCreationRepository(client).create(INPUT);

    const [, init] = request.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as { expectedLines: unknown };
    expect(body.expectedLines).toEqual(INPUT.expectedLines);
  });

  it('resolves with the server-returned orderId/orderNumber/state', async () => {
    const { client } = stubClient({
      data: { orderId: 'order-99', orderNumber: 'BH-20260819-0099', state: 'CREATED' },
    });
    const result = await createApiOrderCreationRepository(client).create(INPUT);

    expect(result).toEqual({ orderId: 'order-99', orderNumber: 'BH-20260819-0099', state: 'CREATED' });
  });
});

describe('apiOrderCreation — conflict mapping', () => {
  it('maps PRICE_CHANGED to CartConflictError, reusing the Phase D conflict type', async () => {
    const { client } = stubClient({
      error: new ApiClientError(409, {
        code: 'PRICE_CHANGED',
        details: { lines: [{ cartItemId: 'ci-1', expectedSatang: 6000, currentSatang: 6500 }] },
      }),
    });

    const promise = createApiOrderCreationRepository(client).create(INPUT);
    await expect(promise).rejects.toBeInstanceOf(CartConflictError);
    await expect(promise).rejects.toMatchObject({
      conflict: { kind: 'PRICE_CHANGED', changes: [{ cartItemId: 'ci-1', wasSatang: 6000, nowSatang: 6500 }] },
    });
  });

  it('maps ITEM_UNAVAILABLE to CartConflictError', async () => {
    const { client } = stubClient({
      error: new ApiClientError(409, {
        code: 'ITEM_UNAVAILABLE',
        details: { items: [{ cartItemId: 'ci-1', menuItemId: 'mi-1' }] },
      }),
    });

    const promise = createApiOrderCreationRepository(client).create(INPUT);
    await expect(promise).rejects.toBeInstanceOf(CartConflictError);
    await expect(promise).rejects.toMatchObject({
      conflict: { kind: 'ITEM_UNAVAILABLE', items: [{ cartItemId: 'ci-1', menuItemId: 'mi-1' }] },
    });
  });

  it.each<ErrorCode>([
    'CART_EMPTY',
    'MIXED_RESTAURANT',
    'RESTAURANT_CLOSED',
    'NOT_FOUND',
    'NOT_IMPLEMENTED',
    'VALIDATION_FAILED',
    'INTERNAL_ERROR',
  ])(
    '%s is NOT turned into a CartConflictError — it stays a plain failure (fails closed)',
    async (code) => {
      const { client } = stubClient({ error: new ApiClientError(409, { code }) });

      const promise = createApiOrderCreationRepository(client).create(INPUT);
      await expect(promise).rejects.not.toBeInstanceOf(CartConflictError);
      await expect(promise).rejects.toMatchObject({ code });
    },
  );

  it('a network failure (not an ApiClientError) propagates unchanged', async () => {
    const { client } = stubClient({ error: new Error('Network request failed') });

    await expect(createApiOrderCreationRepository(client).create(INPUT)).rejects.toThrow(
      'Network request failed',
    );
  });
});
