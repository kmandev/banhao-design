import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';

/**
 * `public.notifications`, as selected by this service — never
 * `notification_deliveries`, which has no client grant by design (migration
 * `20260811000011` §18: "no grant, no policy — no client access for any
 * actor").
 */
interface NotificationRow {
  id: string;
  event_type: string;
  title: string;
  body: string | null;
  deep_link: string | null;
  order_id: string | null;
  read_at: string | null;
  created_at: string;
}

/**
 * The client-facing shape. Deliberately omits `recipient_id`/`recipient_type`
 * — same as `Address` omitting `user_id` — it is always "you", and this
 * endpoint only ever returns the caller's own CUSTOMER-facing notifications.
 */
export interface Notification {
  id: string;
  eventType: string;
  title: string;
  body: string | null;
  deepLink: string | null;
  orderId: string | null;
  read: boolean;
  createdAt: string;
}

const NOTIFICATION_COLUMNS =
  'id, event_type, title, body, deep_link, order_id, read_at, created_at';

/**
 * H-5A — the customer-facing read path for notifications H-2/H-3 already
 * write. Read-only: no notification is ever created here (that stays H-3's
 * job).
 *
 * **Ownership is a query filter, not a check** — the same discipline
 * `AddressesService` documents on itself. Every statement carries
 * `recipient_id = <verified JWT subject>` in its `WHERE`, so another
 * recipient's row is never selected in the first place — plus
 * `recipient_type = 'CUSTOMER'`: DEC-033's multi-role identity means the same
 * profile id can also hold MERCHANT/RIDER notifications, and this endpoint is
 * the customer surface only (H-5A scope lock) — those stay invisible here
 * even though `recipient_id` would otherwise match.
 *
 * Runs on the service-role client (RLS bypassed), so this scoping *is* the
 * enforcement for API callers; the identical `notifications_select_own` /
 * `notifications_update_own` RLS policies remain in force, unchanged, as the
 * database-level backstop for the direct-from-client read path.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** The caller's own notifications, newest first. */
  async list(userId: string): Promise<Notification[]> {
    const { data, error } = await this.supabase.admin
      .from('notifications')
      .select(NOTIFICATION_COLUMNS)
      .eq('recipient_id', userId)
      .eq('recipient_type', 'CUSTOMER')
      .order('created_at', { ascending: false })
      .returns<NotificationRow[]>();

    if (error) {
      this.fail('list', userId, error.message);
    }

    return (data ?? []).map(toNotification);
  }

  /**
   * Marks one notification read. `NOT_FOUND` for both "does not exist" and
   * "belongs to someone else" alike — same indistinguishable-404 discipline
   * `AddressesService.update` uses, for the same reason: telling them apart
   * would confirm a foreign notification's existence to anyone who guessed
   * its id.
   *
   * Unconditional on `read_at`'s current value — re-marking an
   * already-read notification is a success, not a 404, so the `WHERE` never
   * guards on it being null.
   */
  async markRead(userId: string, notificationId: string): Promise<Notification> {
    const { data, error } = await this.supabase.admin
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notificationId)
      .eq('recipient_id', userId)
      .eq('recipient_type', 'CUSTOMER')
      .select(NOTIFICATION_COLUMNS)
      .maybeSingle<NotificationRow>();

    if (error) {
      this.fail('markRead', userId, error.message);
    }

    if (!data) {
      throw new DomainError('NOT_FOUND', { message: 'Notification not found' });
    }

    return toNotification(data);
  }

  private fail(operation: string, userId: string, message: string): never {
    this.logger.error(`Notification ${operation} failed for ${userId}: ${message}`);
    throw new DomainError('INTERNAL_ERROR', { message: `Notification ${operation} failed` });
  }
}

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    eventType: row.event_type,
    title: row.title,
    body: row.body,
    deepLink: row.deep_link,
    orderId: row.order_id,
    read: row.read_at !== null,
    createdAt: row.created_at,
  };
}
