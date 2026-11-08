import { Module } from '@nestjs/common';
import { EarningsService } from './earnings.service';
import { MerchantEarningsController, RiderEarningsController } from './earnings.controller';

/** DEC-073 / DEC-070 Q5 — read-only earnings for restaurants and riders. */
@Module({
  controllers: [MerchantEarningsController, RiderEarningsController],
  providers: [EarningsService],
})
export class EarningsModule {}
