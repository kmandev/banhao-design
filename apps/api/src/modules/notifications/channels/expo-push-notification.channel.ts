import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../supabase/supabase.service';
import type { DeliverInput, DeliverResult, NotificationChannel } from '../notification-channel.interface';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const TIMEOUT_MS = 8000;

interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * LAUNCH_PLAN 1.1 / DEC-070 Q2 — PUSH through Expo's push service (FCM and
 * APNs behind one endpoint), ADR-011's channel shape.
 *
 * Sends the already-chosen title/body to every active token of the recipient.
 * A recipient with no token (every merchant — the web has no push, DEC-APP-003
 * — and any app user who has not allowed notifications) is `delivered: false`
 * with reason `NO_TOKEN`, which the dispatcher treats as "nothing to send", not
 * as a failure. A token Expo reports as `DeviceNotRegistered` is revoked so it
 * is not tried again.
 */
@Injectable()
export class ExpoPushNotificationChannel implements NotificationChannel {
  readonly channel = 'PUSH' as const;
  private readonly logger = new Logger(ExpoPushNotificationChannel.name);

  constructor(private readonly supabase: SupabaseService) {}

  async deliver(input: DeliverInput): Promise<DeliverResult> {
    const { data: tokens, error } = await this.supabase.admin
      .from('push_tokens')
      .select('token')
      .eq('user_id', input.recipientId)
      .is('revoked_at', null)
      .returns<{ token: string }[]>();
    if (error) return { delivered: false, reason: `push_tokens read failed: ${error.message}` };
    if (!tokens || tokens.length === 0) return { delivered: false, reason: 'NO_TOKEN' };

    const messages = tokens.map((row) => ({
      to: row.token,
      title: input.title,
      body: input.body ?? undefined,
      sound: 'default',
      data: { notificationId: input.notificationId },
    }));

    let tickets: ExpoTicket[];
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(messages),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const json = (await response.json()) as { data?: ExpoTicket[]; errors?: unknown };
      if (!response.ok || !Array.isArray(json.data)) {
        return { delivered: false, reason: `expo push HTTP ${response.status}` };
      }
      tickets = json.data;
    } catch (cause) {
      return { delivered: false, reason: `expo push request failed: ${cause instanceof Error ? cause.message : String(cause)}` };
    }

    const dead = tickets
      .map((ticket, i) => (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered' ? tokens[i]?.token : null))
      .filter((token): token is string => typeof token === 'string');
    if (dead.length > 0) {
      const { error: revokeError } = await this.supabase.admin
        .from('push_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .in('token', dead);
      if (revokeError) this.logger.error(`revoking unregistered push tokens failed: ${revokeError.message}`);
    }

    const okCount = tickets.filter((ticket) => ticket.status === 'ok').length;
    if (okCount === 0) {
      return { delivered: false, reason: tickets.map((t) => t.details?.error ?? t.message ?? 'error').join(', ').slice(0, 300) };
    }
    return { delivered: true };
  }
}
