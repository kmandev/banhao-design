import { Module } from '@nestjs/common';
import { OutboxDispatchService } from './outbox-dispatch.service';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { InAppNotificationChannel } from './channels/in-app-notification.channel';
import { IN_APP_NOTIFICATION_CHANNEL } from './notification-channel.interface';

/**
 * Phase H notification core: dispatch (H-2) and the customer read path (H-5A).
 *
 * `IN_APP_NOTIFICATION_CHANNEL` is bound here and nowhere else, the same
 * shape `RiderModule` uses for `DISPATCH_STRATEGY` and `PaymentsModule` uses
 * for `PAYMENT_PROVIDER`: a future PUSH/SMS/EMAIL adapter is added by
 * providing a second token, not by changing this binding.
 *
 * `OutboxDispatchService` is exported for `TickModule`, exactly as
 * `PaymentEventProcessingService`/`ProofPhotoRetentionService` are — the
 * scheduled tick is a caller of this module, never the other way round. No
 * outbox writer is registered here — writing outbox rows is each causing
 * domain module's own responsibility (H-3+), out of scope for this slice.
 *
 * `NotificationsController`/`NotificationsService` (H-5A) are this module's
 * client-facing side: read-only, customer-scoped, and never touch
 * `notification_deliveries` — see `NotificationsService`'s own header.
 */
@Module({
  controllers: [NotificationsController],
  providers: [
    OutboxDispatchService,
    NotificationsService,
    { provide: IN_APP_NOTIFICATION_CHANNEL, useClass: InAppNotificationChannel },
  ],
  exports: [OutboxDispatchService],
})
export class NotificationsModule {}
