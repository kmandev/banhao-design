import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { StorageModule } from '../storage/storage.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderPricingService } from './order-pricing.service';
import { DeliveryProofController } from './delivery-proof.controller';
import { DeliveryProofService } from './delivery-proof.service';

/**
 * `CartModule` is imported explicitly for `CartService` — it is not
 * `@Global()`, unlike `SupabaseModule` and `UsersModule` (both already
 * global, so `SupabaseService` and `AddressesService` are available here
 * without an import).
 *
 * `OrdersService` is exported for `RiderModule` (Phase G-5): the delivery ↔
 * order join point calls `OrdersService.pickupOrder` directly rather than
 * reimplementing the `READY_FOR_PICKUP -> PICKED_UP` guarded UPDATE it
 * already contains — the same "the tick is a caller of this module" shape
 * `DispatchService`'s own export already uses.
 */
@Module({
  imports: [CartModule, StorageModule],
  controllers: [OrdersController, DeliveryProofController],
  providers: [OrdersService, OrderPricingService, DeliveryProofService],
  exports: [OrdersService],
})
export class OrdersModule {}
