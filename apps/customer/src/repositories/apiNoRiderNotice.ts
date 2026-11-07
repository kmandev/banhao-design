/**
 * Whether the server has told this customer it cannot find a rider yet.
 *
 * The app does not decide that. The server's no-rider check (DEC-022's decision
 * point) writes an `OrderNoRiderFound` notification for the customer, and the
 * app only asks whether one exists for this order **and** the delivery is
 * still searching. That keeps DEC-022's number on the server: a second copy in
 * the app is how one approved figure quietly becomes two.
 *
 * Both halves must hold. The notification alone is not enough, because a rider
 * may have accepted since; the delivery state is read directly under RLS
 * (`deliveries_select_customer`, DEC-APP-008), the notification through the
 * API like every other notification read.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApiClient } from '@banhao/api-client';
import { apiClient as defaultApi } from '../lib/apiClient';
import { supabase as defaultSupabase } from '../lib/supabase';
import type { NoRiderNoticeRepository } from './types';

const NO_RIDER_EVENT_TYPE = 'OrderNoRiderFound';
const STILL_SEARCHING = ['RIDER_SEARCHING', 'RIDER_REASSIGNING'];

interface NotificationRow {
  eventType: string;
  orderId: string | null;
}

export function createApiNoRiderNoticeRepository(
  api: ApiClient = defaultApi,
  client: SupabaseClient = defaultSupabase,
): NoRiderNoticeRepository {
  return {
    async hasNoRiderNotice(orderId: string): Promise<boolean> {
      const { data: delivery, error } = await client
        .from('deliveries')
        .select('state')
        .eq('order_id', orderId)
        .maybeSingle<{ state: string }>();

      if (error) throw new Error(error.message);
      if (!delivery || !STILL_SEARCHING.includes(delivery.state)) return false;

      const notifications = await api.request<NotificationRow[]>('/api/v1/me/notifications');
      return notifications.some((n) => n.eventType === NO_RIDER_EVENT_TYPE && n.orderId === orderId);
    },
  };
}

export const apiNoRiderNoticeRepository = createApiNoRiderNoticeRepository();
