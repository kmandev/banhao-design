import { Injectable, Logger } from '@nestjs/common';
import type { DeliverInput, DeliverResult, NotificationChannel } from '../notification-channel.interface';

/**
 * IN_APP channel — ADR-011.
 *
 * Unlike PUSH/SMS/EMAIL, "in-app delivery" has no external transport: the
 * `notifications` row itself (created by `OutboxDispatchService` before this
 * adapter is called) IS the delivery — a client reads it via the existing
 * `notifications` read path under RLS. There is nothing further to send, so
 * this adapter performs no I/O and always reports success. It exists as a
 * real `NotificationChannel` implementation — not a bypass — so the
 * dispatcher never special-cases IN_APP and a future PUSH/SMS/EMAIL adapter
 * slots in behind the same interface without changing the dispatcher.
 */
@Injectable()
export class InAppNotificationChannel implements NotificationChannel {
  readonly channel = 'IN_APP' as const;

  private readonly logger = new Logger(InAppNotificationChannel.name);

  async deliver(input: DeliverInput): Promise<DeliverResult> {
    this.logger.debug(`IN_APP notification ${input.notificationId} delivered to ${input.recipientId}`);
    return { delivered: true };
  }
}
