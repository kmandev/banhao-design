import { Module } from '@nestjs/common';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { NullPaymentProvider } from './providers/null-payment.provider';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentEventProcessingService } from './payment-event-processing.service';
import { PaymentAttemptExpiryService } from './payment-attempt-expiry.service';

/**
 * Wires the active PaymentProvider, payment initiation (Phase F-1),
 * payment-event processing (Phase F-2b — `PaymentEventProcessingService`),
 * and payment-attempt expiry (`PaymentAttemptExpiryService`) — the latter
 * two both consumed by `TickModule`.
 *
 * When Q-001 is resolved, add the real provider here and swap the binding —
 * no business logic outside this module should need to change. That is the
 * entire point of the abstraction.
 */
@Module({
  controllers: [PaymentsController],
  providers: [
    { provide: PAYMENT_PROVIDER, useClass: NullPaymentProvider },
    PaymentsService,
    PaymentEventProcessingService,
    PaymentAttemptExpiryService,
  ],
  exports: [PAYMENT_PROVIDER, PaymentEventProcessingService, PaymentAttemptExpiryService],
})
export class PaymentsModule {}
