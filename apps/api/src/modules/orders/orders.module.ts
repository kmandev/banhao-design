import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderPricingService } from './order-pricing.service';

/**
 * `CartModule` is imported explicitly for `CartService` — it is not
 * `@Global()`, unlike `SupabaseModule` and `UsersModule` (both already
 * global, so `SupabaseService` and `AddressesService` are available here
 * without an import).
 */
@Module({
  imports: [CartModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderPricingService],
})
export class OrdersModule {}
