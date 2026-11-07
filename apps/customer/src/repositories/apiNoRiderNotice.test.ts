import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApiClient } from '@banhao/api-client';
import { createApiNoRiderNoticeRepository } from './apiNoRiderNotice';

function build(deliveryRow: unknown, notifications: unknown[], deliveryError?: string) {
  const eq = jest.fn();
  const query = {
    select: jest.fn().mockReturnThis(),
    eq: eq.mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(
      deliveryError ? { data: null, error: { message: deliveryError } } : { data: deliveryRow, error: null },
    ),
  };
  const client = { from: jest.fn().mockReturnValue(query) } as unknown as SupabaseClient;
  const request = jest.fn().mockResolvedValue(notifications);
  return { client, api: { request } as unknown as ApiClient, request, eq };
}

const NOTICE = { eventType: 'OrderNoRiderFound', orderId: 'o1' };

describe('apiNoRiderNotice.hasNoRiderNotice', () => {
  it('is true only when the delivery is still searching AND the server sent the no-rider notice for this order', async () => {
    const { client, api } = build({ state: 'RIDER_SEARCHING' }, [NOTICE]);

    await expect(createApiNoRiderNoticeRepository(api, client).hasNoRiderNotice('o1')).resolves.toBe(true);
  });

  it('is also true while the delivery is being reassigned', async () => {
    const { client, api } = build({ state: 'RIDER_REASSIGNING' }, [NOTICE]);

    await expect(createApiNoRiderNoticeRepository(api, client).hasNoRiderNotice('o1')).resolves.toBe(true);
  });

  it('is false once a rider holds it, even though the notice exists — and never reads notifications', async () => {
    const { client, api, request } = build({ state: 'RIDER_ASSIGNED' }, [NOTICE]);

    await expect(createApiNoRiderNoticeRepository(api, client).hasNoRiderNotice('o1')).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it('is false when the order has no delivery yet', async () => {
    const { client, api } = build(null, [NOTICE]);

    await expect(createApiNoRiderNoticeRepository(api, client).hasNoRiderNotice('o1')).resolves.toBe(false);
  });

  it('is false when the notice is for a different order, or is a different event', async () => {
    const { client, api } = build({ state: 'RIDER_SEARCHING' }, [
      { eventType: 'OrderNoRiderFound', orderId: 'other' },
      { eventType: 'RiderSearchStarted', orderId: 'o1' },
    ]);

    await expect(createApiNoRiderNoticeRepository(api, client).hasNoRiderNotice('o1')).resolves.toBe(false);
  });

  it('reads the delivery by the order id alone — ownership is RLS\'s job', async () => {
    const { client, api, eq } = build({ state: 'RIDER_SEARCHING' }, [NOTICE]);

    await createApiNoRiderNoticeRepository(api, client).hasNoRiderNotice('o1');

    expect(eq).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith('order_id', 'o1');
  });

  it('throws when the delivery read fails, so the screen can decide what that means', async () => {
    const { client, api } = build(null, [], 'connection reset');

    await expect(createApiNoRiderNoticeRepository(api, client).hasNoRiderNotice('o1')).rejects.toThrow('connection reset');
  });
});
