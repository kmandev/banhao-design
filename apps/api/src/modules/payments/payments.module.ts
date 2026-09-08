import { Module } from '@nestjs/common';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { NullPaymentProvider } from './providers/null-payment.provider';
import { CUSTOMER_EMAIL_SOURCE, NoPersistedCustomerEmailSource } from './customer-email-source';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentEventProcessingService } from './payment-event-processing.service';
import { PaymentAttemptExpiryService } from './payment-attempt-expiry.service';
import { PaymentReconciliationService } from './payment-reconciliation.service';

/**
 * Wires the active PaymentProvider, the customer-email source (DEC-056),
 * payment initiation (Phase F-1), payment-event processing (Phase F-2b —
 * `PaymentEventProcessingService`), and payment-attempt expiry
 * (`PaymentAttemptExpiryService`) — the latter two both consumed by
 * `TickModule`.
 *
 * When Q-001 is resolved, add the real provider here and swap the binding —
 * no business logic outside this module should need to change. That is the
 * entire point of the abstraction.
 *
 * `CUSTOMER_EMAIL_SOURCE` is the same shape of swap point: the DEC-056
 * collection slice replaces `NoPersistedCustomerEmailSource` with a real
 * `profiles.email` read here, and nowhere else needs to change.
 */
@Module({
  controllers: [PaymentsController],
  providers: [
    { provide: PAYMENT_PROVIDER, useClass: NullPaymentProvider },
    { provide: CUSTOMER_EMAIL_SOURCE, useClass: NoPersistedCustomerEmailSource },
    PaymentsService,
    PaymentEventProcessingService,
    PaymentAttemptExpiryService,
    PaymentReconciliationService,
  ],
  exports: [PAYMENT_PROVIDER, PaymentEventProcessingService, PaymentAttemptExpiryService, PaymentReconciliationService],
})
export class PaymentsModule {}
