import type { ApiClient } from '@banhao/api-client';
import { createApiNotificationRepository } from './apiNotifications';

/**
 * Phase H-5A — `apiNotifications.ts`'s mapping from the real API's wire shape
 * to the `AppNotification` shape `NotificationRepository` already promised
 * (`mocks/types.ts`), same reasoning `apiAddresses.test.ts` gives for its own
 * suite: `NotificationsScreen` keeps rendering unchanged while the id/read
 * state it renders is now the caller's genuine database row.
 */

function stubClient(response: unknown): { client: ApiClient; request: jest.Mock } {
  const request = jest.fn().mockResolvedValue(response);
  return { client: { request } as unknown as ApiClient, request };
}

const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  eventType: 'OrderPickedUp',
  title: 'OrderPickedUp',
  body: 'ไรเดอร์กำลังไปส่ง',
  deepLink: null,
  orderId: 'order-1',
  read: false,
  createdAt: '2026-08-30T18:52:00.000Z',
};

describe('apiNotifications — request', () => {
  it('GETs /api/v1/me/notifications', async () => {
    const { client, request } = stubClient([ROW]);
    await createApiNotificationRepository(client).listNotifications();
    expect(request).toHaveBeenCalledWith('/api/v1/me/notifications');
  });

  it('PATCHes /api/v1/me/notifications/:id with no body', async () => {
    const { client, request } = stubClient(ROW);
    await createApiNotificationRepository(client).markNotificationRead(ROW.id);
    expect(request).toHaveBeenCalledWith(
      `/api/v1/me/notifications/${ROW.id}`,
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});

describe('apiNotifications — mapping', () => {
  it('preserves the real database id', async () => {
    const { client } = stubClient([ROW]);
    const [notification] = await createApiNotificationRepository(client).listNotifications();
    expect(notification?.id).toBe(ROW.id);
  });

  it('maps title and body straight through', async () => {
    const { client } = stubClient([ROW]);
    const [notification] = await createApiNotificationRepository(client).listNotifications();
    expect(notification?.title).toBe('OrderPickedUp');
    expect(notification?.body).toBe('ไรเดอร์กำลังไปส่ง');
  });

  it('falls back to an empty body when the API sends null', async () => {
    const { client } = stubClient([{ ...ROW, body: null }]);
    const [notification] = await createApiNotificationRepository(client).listNotifications();
    expect(notification?.body).toBe('');
  });

  it('maps read through unchanged', async () => {
    const { client } = stubClient([{ ...ROW, read: true }]);
    const [notification] = await createApiNotificationRepository(client).listNotifications();
    expect(notification?.read).toBe(true);
  });

  it('formats createdAt as an HH:mm time label', async () => {
    const { client } = stubClient([ROW]);
    const [notification] = await createApiNotificationRepository(client).listNotifications();
    expect(notification?.time).toMatch(/^\d{2}:\d{2}$/);
  });

  it('uses the same glyph for every notification — no per-event icon exists server-side', async () => {
    const { client } = stubClient([ROW, { ...ROW, id: 'n2', eventType: 'OrderDelivered' }]);
    const [first, second] = await createApiNotificationRepository(client).listNotifications();
    expect(first?.glyph).toBe(second?.glyph);
  });
});
