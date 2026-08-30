import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import {
  IN_APP_NOTIFICATION_CHANNEL,
  type NotificationChannel,
} from './notification-channel.interface';

/** How many unprocessed `outbox` rows one tick claims work from at most — matches `PaymentEventProcessingService`'s `BATCH_SIZE`. */
const BATCH_SIZE = 25;

type RecipientType = 'CUSTOMER' | 'MERCHANT' | 'RIDER' | 'OPERATOR';

interface OutboxRecipient {
  recipientId: string;
  recipientType: RecipientType;
}

/** `outbox`, the columns a claimed row needs for dispatch. */
interface ClaimedOutboxRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: unknown;
  attempts: number;
}

export interface OutboxDispatchResult {
  claimed: number;
  dispatched: number;
  skipped: number;
  failed: number;
}

/**
 * Phase H outbox dispatch core (H-2) — ADR-005, ADR-011, H-3's locked contract.
 *
 * ## Recipient resolution — Option A, locked by H-3
 *
 * Recipients are read verbatim from `outbox.payload.recipients[]`, already
 * resolved by the domain module that wrote the event. This service
 * deliberately performs **no join** into `orders`/`deliveries`/`restaurants`/
 * `riders` to derive a recipient — that would violate both H-3's locked
 * resolution model and `apps/api/src/modules/README.md`'s cross-module
 * boundary rule. `OPERATOR` recipients are skipped (no notification created)
 * per H-3 — OPERATOR is intentionally unsupported in Phase H, not an error.
 *
 * ## Claiming — same guarded-UPDATE discipline as `payment_events`
 *
 * `outbox` has no dedicated claim column, so — exactly like
 * `PaymentEventProcessingService.processOne`, whose `processed_at` doubles as
 * claim-and-complete marker — `dispatched_at` is set optimistically by the
 * claiming UPDATE (`WHERE dispatched_at IS NULL`) and released back to `null`
 * if processing then fails, with `last_error`/`attempts` recorded. This keeps
 * "only after successful processing, stamp `dispatched_at`" true in effect: a
 * row is left with a non-null `dispatched_at` if and only if this run's
 * processing actually succeeded. Exactly one concurrent caller can win a
 * given row's claim; the loser sees 0 rows and skips it — the same
 * concurrency authority every other guarded transition in this codebase uses
 * (ADR-003: the state check lives in the `WHERE` clause, never a prior
 * `SELECT`).
 *
 * ## Notification content — sourced only from columns that already exist
 *
 * `notifications.title` is `NOT NULL` and no doc or existing writer defines a
 * per-event title/body convention (H-2A/H-3 found none). Rather than invent a
 * new payload field, `title` is populated from the outbox row's own existing
 * `event_type` column; `body`/`deep_link` are left `null` (both nullable);
 * `order_id` is set only when `aggregate_type === 'order'` (using the
 * already-claimed `aggregate_id`, not a lookup into another module's table) —
 * for `aggregate_type === 'delivery'`, `order_id` stays `null` rather than
 * joining into `deliveries` to find it.
 *
 * ## Failure handling
 *
 * Any failure while fanning out to recipients (a malformed
 * `payload.recipients`, an insert error, a channel delivery failure) aborts
 * the whole event: the claim is released, `attempts`/`last_error` are
 * recorded, and `dispatched_at` is never left stamped. A partially-created
 * `notifications`/`notification_deliveries` row from an aborted attempt is
 * left in place (no compensating delete) — a retry only ever *adds* rows for
 * recipients not yet notified is out of scope for this slice; the schema has
 * no natural per-recipient idempotency key, and inventing one is exactly the
 * kind of schema change this slice must not make. This is flagged, not
 * hidden: see the H-2 final report.
 */
@Injectable()
export class OutboxDispatchService {
  private readonly logger = new Logger(OutboxDispatchService.name);

  constructor(
    private readonly supabase: SupabaseService,
    @Inject(IN_APP_NOTIFICATION_CHANNEL) private readonly inAppChannel: NotificationChannel,
  ) {}

  /** Claims and dispatches up to `BATCH_SIZE` undispatched outbox rows. Called once per tick. */
  async dispatchPending(): Promise<OutboxDispatchResult> {
    const { data: pending, error } = await this.supabase.admin
      .from('outbox')
      .select('id')
      .is('dispatched_at', null)
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE)
      .returns<{ id: string }[]>();

    if (error) {
      this.logger.error(`Failed to list pending outbox rows: ${error.message}`);
      return { claimed: 0, dispatched: 0, skipped: 0, failed: 0 };
    }

    let dispatched = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of pending ?? []) {
      const outcome = await this.processOne(row.id);
      if (outcome === 'dispatched') dispatched++;
      else if (outcome === 'skipped') skipped++;
      else failed++;
    }

    const claimed = pending?.length ?? 0;
    return { claimed, dispatched, skipped, failed };
  }

  /**
   * Claims one outbox row by id and dispatches it. Returns `'skipped'` for an
   * already-dispatched/nonexistent row (including one a concurrent worker won
   * first), `'failed'` when processing threw and the claim was released for
   * retry, `'dispatched'` on success — never throws itself, matching
   * `PaymentEventProcessingService.processOne`'s own contract so a batch loop
   * never aborts partway through on one bad event.
   */
  async processOne(outboxId: string): Promise<'dispatched' | 'skipped' | 'failed'> {
    const nowIso = new Date().toISOString();

    const { data: claimed, error: claimError } = await this.supabase.admin
      .from('outbox')
      .update({ dispatched_at: nowIso })
      .eq('id', outboxId)
      .is('dispatched_at', null)
      .select('id, aggregate_type, aggregate_id, event_type, payload, attempts')
      .maybeSingle<ClaimedOutboxRow>();

    if (claimError) {
      this.logger.error(`Failed to claim outbox row ${outboxId}: ${claimError.message}`);
      return 'skipped';
    }

    if (!claimed) {
      // Already dispatched, claimed by a concurrent tick, or the id does not
      // exist — every case is a legitimate skip, not an error.
      return 'skipped';
    }

    try {
      await this.dispatchClaimed(claimed);
      return 'dispatched';
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.logger.error(`outbox ${outboxId} dispatch failed, releasing claim for retry: ${message}`);

      const { error: releaseError } = await this.supabase.admin
        .from('outbox')
        .update({ dispatched_at: null, attempts: claimed.attempts + 1, last_error: message })
        .eq('id', outboxId);

      if (releaseError) {
        this.logger.error(`Failed to release claim on outbox ${outboxId}: ${releaseError.message}`);
      }

      return 'failed';
    }
  }

  private async dispatchClaimed(row: ClaimedOutboxRow): Promise<void> {
    const recipients = readRecipients(row.payload);
    const validRecipients = recipients.filter((r) => r.recipientType !== 'OPERATOR');

    if (recipients.length !== validRecipients.length) {
      this.logger.debug(
        `outbox ${row.id}: skipped ${recipients.length - validRecipients.length} OPERATOR recipient(s) — unsupported in Phase H`,
      );
    }

    const title = row.event_type;
    const orderId = row.aggregate_type === 'order' ? row.aggregate_id : null;

    for (const recipient of validRecipients) {
      await this.notifyOne(row, recipient, title, orderId);
    }
  }

  private async notifyOne(
    row: ClaimedOutboxRow,
    recipient: OutboxRecipient,
    title: string,
    orderId: string | null,
  ): Promise<void> {
    const { data: notification, error: notificationError } = await this.supabase.admin
      .from('notifications')
      .insert({
        recipient_id: recipient.recipientId,
        recipient_type: recipient.recipientType,
        event_type: row.event_type,
        title,
        body: null,
        deep_link: null,
        order_id: orderId,
      })
      .select('id')
      .maybeSingle<{ id: string }>();

    if (notificationError) {
      throw new Error(`notifications insert failed: ${notificationError.message}`);
    }
    if (!notification) {
      throw new Error('notifications insert returned no row');
    }

    const { data: delivery, error: deliveryError } = await this.supabase.admin
      .from('notification_deliveries')
      .insert({ notification_id: notification.id, channel: 'IN_APP', state: 'PENDING' })
      .select('id')
      .maybeSingle<{ id: string }>();

    if (deliveryError) {
      throw new Error(`notification_deliveries insert failed: ${deliveryError.message}`);
    }
    if (!delivery) {
      throw new Error('notification_deliveries insert returned no row');
    }

    const result = await this.inAppChannel.deliver({
      notificationId: notification.id,
      recipientId: recipient.recipientId,
      title,
      body: null,
      deepLink: null,
    });

    if (!result.delivered) {
      const { error: failError } = await this.supabase.admin
        .from('notification_deliveries')
        .update({ state: 'FAILED', last_error: result.reason, attempts: 1 })
        .eq('id', delivery.id);
      if (failError) {
        this.logger.error(`notification_deliveries FAILED update failed for ${delivery.id}: ${failError.message}`);
      }
      throw new Error(`IN_APP delivery failed for notification ${notification.id}: ${result.reason}`);
    }

    const { error: sentError } = await this.supabase.admin
      .from('notification_deliveries')
      .update({ state: 'SENT', sent_at: new Date().toISOString() })
      .eq('id', delivery.id);

    if (sentError) {
      throw new Error(`notification_deliveries SENT update failed: ${sentError.message}`);
    }
  }
}

function readRecipients(payload: unknown): OutboxRecipient[] {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('outbox.payload is not an object');
  }

  const recipients = (payload as Record<string, unknown>).recipients;
  if (!Array.isArray(recipients)) {
    throw new Error(
      'outbox.payload.recipients is missing or not an array — required by the H-3 locked recipient-resolution contract',
    );
  }

  return recipients.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`outbox.payload.recipients[${index}] is not an object`);
    }

    const { recipientId, recipientType } = entry as Record<string, unknown>;

    if (typeof recipientId !== 'string' || recipientId.length === 0) {
      throw new Error(`outbox.payload.recipients[${index}].recipientId is missing or not a string`);
    }

    if (
      recipientType !== 'CUSTOMER' &&
      recipientType !== 'MERCHANT' &&
      recipientType !== 'RIDER' &&
      recipientType !== 'OPERATOR'
    ) {
      throw new Error(`outbox.payload.recipients[${index}].recipientType "${String(recipientType)}" is not valid`);
    }

    return { recipientId, recipientType };
  });
}
