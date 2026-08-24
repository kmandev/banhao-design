import { Module } from '@nestjs/common';
import { TickController } from './tick.controller';
import { TickHmacGuard } from '../../common/guards/tick-hmac.guard';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PaymentsModule],
  controllers: [TickController],
  providers: [TickHmacGuard],
})
export class TickModule {}
