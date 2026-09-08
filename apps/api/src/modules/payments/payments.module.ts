import { Module } from '@nestjs/common';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { NullPaymentProvider } from './providers/null-payment.provider';
import { CUSTOMER_EMAIL_SOURCE, ProfileCustomerEmailSource } from './customer-email-source';
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
 * `CUSTOMER_EMAIL_SOURCE` is the same shape of swap point: `ProfileCustomerEmailSource`
 * (the DEC-056 collection slice) reads `profiles.email` server-side —
 * replacing the earlier placeholder binding, `NoPersistedCustomerEmailSource`,
 * which always returned `null` because no persisted column existed yet.
 * `PaymentsService` itself did not change to make this swap.
 */
@Module({
  controllers: [PaymentsController],
  providers: [
    { provide: PAYMENT_PROVIDER, useClass: NullPaymentProvider },
    { provide: CUSTOMER_EMAIL_SOURCE, useClass: ProfileCustomerEmailSource },
    PaymentsService,
    PaymentEventProcessingService,
    PaymentAttemptExpiryService,
    PaymentReconciliationService,
  ],
  exports: [PAYMENT_PROVIDER, PaymentEventProcessingService, PaymentAttemptExpiryService, PaymentReconciliationService],
})
export class PaymentsModule {}
