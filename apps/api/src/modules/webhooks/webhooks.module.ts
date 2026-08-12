import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { WebhooksController } from './webhooks.controller';

/**
 * DEC-APP-005 transport. Imports `PaymentsModule` rather than duplicating its
 * binding, so the webhook path and the rest of the API always verify against
 * the same `PaymentProvider`.
 */
@Module({
  imports: [PaymentsModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
