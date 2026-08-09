import { Module } from '@nestjs/common';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { NullPaymentProvider } from './providers/null-payment.provider';

/**
 * Wires the active PaymentProvider.
 *
 * When Q-001 is resolved, add the real provider here and swap the binding —
 * no business logic outside this module should need to change. That is the
 * entire point of the abstraction.
 */
@Module({
  providers: [{ provide: PAYMENT_PROVIDER, useClass: NullPaymentProvider }],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentsModule {}
