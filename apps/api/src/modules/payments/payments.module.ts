import { Module } from '@nestjs/common';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { StripePaymentProvider } from './providers/stripe-payment.provider';
import { CUSTOMER_EMAIL_SOURCE, ProfileCustomerEmailSource } from './customer-email-source';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentEventProcessingService } from './payment-event-processing.service';
import { RefundEventProcessingService } from './refund-event-processing.service';
import { PaymentAttemptExpiryService } from './payment-attempt-expiry.service';
import { PaymentReconciliationService } from './payment-reconciliation.service';

/**
 * Wires the active PaymentProvider, the customer-email source (DEC-056),
 * payment initiation (Phase F-1), payment-event processing (Phase F-2b —
 * `PaymentEventProcessingService`), and payment-attempt expiry
 * (`PaymentAttemptExpiryService`) — the latter two both consumed by
 * `TickModule`.
 *
 * `PAYMENT_PROVIDER` → `StripePaymentProvider` (Q-001 resolved, DEC-055) — the
 * single clear swap point this abstraction existed to make sufficient.
 * `NullPaymentProvider` is retained (DEC-APP-007) as the dev/test provider,
 * used directly by unit tests that construct `PaymentsService` themselves —
 * none of them go through this module's DI wiring, so this swap changes no
 * existing test's behaviour. Any environment without `STRIPE_SECRET_KEY`
 * configured (a fresh checkout, CI, OpenAPI generation) supplies a
 * placeholder value at the one or two call sites that build the full DI
 * graph — see `openapi.generate.ts`'s `GENERATION_ENV` and
 * `test/tick.e2e-spec.ts`'s own env block, both already doing the same for
 * R2/`StorageService`.
 *
 * `CUSTOMER_EMAIL_SOURCE` is the same shape of swap point: `ProfileCustomerEmailSource`
 * (the DEC-056 collection slice) reads `profiles.email` server-side —
 * replacing the earlier placeholder binding, `NoPersistedCustomerEmailSource`,
 * which always returned `null` because no persisted column existed yet.
 * `PaymentsService` itself did not change to make either swap.
 *
 * `RefundEventProcessingService` (Q-020 Slice 2, DEC-057 §5) is its own tick
 * phase, consumed by `TickModule` exactly like `PaymentEventProcessingService`
 * — see that class's own doc comment for why it is a second, independent
 * claim loop over `payment_events` rather than a change to
 * `PaymentEventProcessingService` itself.
 */
@Module({
  controllers: [PaymentsController],
  providers: [
    { provide: PAYMENT_PROVIDER, useClass: StripePaymentProvider },
    { provide: CUSTOMER_EMAIL_SOURCE, useClass: ProfileCustomerEmailSource },
    PaymentsService,
    PaymentEventProcessingService,
    RefundEventProcessingService,
    PaymentAttemptExpiryService,
    PaymentReconciliationService,
  ],
  exports: [
    PAYMENT_PROVIDER,
    PaymentEventProcessingService,
    RefundEventProcessingService,
    PaymentAttemptExpiryService,
    PaymentReconciliationService,
  ],
})
export class PaymentsModule {}
