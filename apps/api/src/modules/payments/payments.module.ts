import { Module } from '@nestjs/common';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { NullPaymentProvider } from './providers/null-payment.provider';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/**
 * Wires the active PaymentProvider and payment initiation (Phase F-1).
 *
 * When Q-001 is resolved, add the real provider here and swap the binding —
 * no business logic outside this module should need to change. That is the
 * entire point of the abstraction.
 */
@Module({
  controllers: [PaymentsController],
  providers: [{ provide: PAYMENT_PROVIDER, useClass: NullPaymentProvider }, PaymentsService],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentsModule {}
