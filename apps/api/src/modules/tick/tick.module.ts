import { Module } from '@nestjs/common';
import { TickController } from './tick.controller';
import { TickHmacGuard } from '../../common/guards/tick-hmac.guard';
import { PaymentsModule } from '../payments/payments.module';
import { RiderModule } from '../rider/rider.module';

@Module({
  imports: [PaymentsModule, RiderModule],
  controllers: [TickController],
  providers: [TickHmacGuard],
})
export class TickModule {}
