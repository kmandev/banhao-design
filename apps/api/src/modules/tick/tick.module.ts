import { Module } from '@nestjs/common';
import { TickController } from './tick.controller';
import { TickHmacGuard } from '../../common/guards/tick-hmac.guard';

@Module({
  controllers: [TickController],
  providers: [TickHmacGuard],
})
export class TickModule {}
