/**
 * `GET /api/v1/me/notifications` + `PATCH /api/v1/me/notifications/:id`,
 * consumed through the shared API client (Phase H-5A).
 *
 * Unlike catalog/cart (DEC-APP-008's direct-from-Supabase read path), this
 * repository goes through the NestJS API — H-5A's own scope explicitly named
 * these two REST endpoints rather than a direct-from-client PostgREST read,
 * so `notifications`' RLS policies (`notifications_select_own` /
 * `notifications_update_own`) back the API's own service-role query instead
 * of being read against directly here.
 *
 * Maps the real API response into the exact `AppNotification` shape
 * `NotificationRepository` already promised (`mocks/types.ts`), so
 * `NotificationsScreen` keeps rendering unchanged while what it renders is
 * now the caller's genuine database rows rather than a fixture.
 */

import type { ApiClient } from '@banhao/api-client';
import { apiClient as defaultClient } from '../lib/apiClient';
import type { AppNotification } from '../mocks/types';
import type { NotificationRepository } from './types';

/** Wire shape of one row from `GET /api/v1/me/notifications` (`NotificationsService`'s own `Notification`). */
interface NotificationApiResponse {
  id: string;
  eventType: string;
  title: string;
  body: string | null;
  deepLink: string | null;
  orderId: string | null;
  read: boolean;
  createdAt: string;
}

/**
 * No per-event icon exists server-side — the design's icon-per-notification
 * concept was never persisted (`public.notifications` has no glyph column),
 * so every real notification renders with the same bell, matching
 * `apiAddresses.ts`'s own precedent for a field the mock era had but the
 * schema does not.
 */
const NOTIFICATION_GLYPH = '🔔';

/**
 * No relative-day formatting ("เมื่อวาน") exists server-side either — only
 * `created_at`. Every real notification renders its literal send time
 * (`HH:mm`, the device's local time zone), which is what the mock fixture's
 * same-day entries already showed.
 */
function toTimeLabel(createdAt: string): string {
  const date = new Date(createdAt);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function toAppNotification(row: NotificationApiResponse): AppNotification {
  return {
    id: row.id,
    glyph: NOTIFICATION_GLYPH,
    title: row.title,
    body: row.body ?? '',
    time: toTimeLabel(row.createdAt),
    read: row.read,
  };
}

export function createApiNotificationRepository(
  client: ApiClient = defaultClient,
): NotificationRepository {
  return {
    async listNotifications(): Promise<AppNotification[]> {
      const rows = await client.request<NotificationApiResponse[]>('/api/v1/me/notifications');
      return rows.map(toAppNotification);
    },

    async markNotificationRead(id: string): Promise<void> {
      await client.request<NotificationApiResponse>(`/api/v1/me/notifications/${id}`, {
        method: 'PATCH',
      });
    },
  };
}

export const apiNotificationRepository = createApiNotificationRepository();
