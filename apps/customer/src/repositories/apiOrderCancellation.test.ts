import { createApiOrderCancellationRepository } from './apiOrderCancellation';
import type { ApiClient } from '@banhao/api-client';

function stubClient(impl: () => Promise<unknown>) {
  const request = jest.fn().mockImplementation(impl);
  return { client: { request } as unknown as ApiClient, request };
}

describe('apiOrderCancellation', () => {
  it('POSTs /api/v1/orders/:id/cancel with an empty body — the order id and nothing else', async () => {
    const { client, request } = stubClient(async () => ({ orderId: 'o1', state: 'CANCELLED' }));

    await createApiOrderCancellationRepository(client).cancelOrder('o1');

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('/api/v1/orders/o1/cancel', { method: 'POST', body: '{}' });
  });

  it('rethrows a refusal unchanged, for the screen to present', async () => {
    const refusal = new Error('NOT_FOUND');
    const { client } = stubClient(async () => {
      throw refusal;
    });

    await expect(createApiOrderCancellationRepository(client).cancelOrder('o1')).rejects.toBe(refusal);
  });
});
