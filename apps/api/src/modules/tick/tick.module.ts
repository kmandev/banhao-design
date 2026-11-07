import { Module } from '@nestjs/common';
import { TickController } from './tick.controller';
import { TickHmacGuard } from '../../common/guards/tick-hmac.guard';
import { PaymentsModule } from '../payments/payments.module';
import { RiderModule } from '../rider/rider.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AiOpsModule } from '../ai-ops/ai-ops.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [PaymentsModule, RiderModule, NotificationsModule, AiOpsModule, OrdersModule],
  controllers: [TickController],
  providers: [TickHmacGuard],
})
export class TickModule {}
