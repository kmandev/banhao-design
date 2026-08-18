import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { RestaurantCoverController } from './restaurant-cover.controller';
import { RestaurantCoverService } from './restaurant-cover.service';

/**
 * The merchant-facing API surface. M-11 (restaurant cover upload) is its
 * first slice — the natural home for M-12 and the rest of the merchant
 * domain as they're built. Imports `StorageModule` rather than constructing
 * `StorageService` itself: this is the "future MerchantModule" that
 * module's own doc comment named as the reason it wasn't registered in
 * `AppModule` earlier.
 */
@Module({
  imports: [StorageModule],
  controllers: [RestaurantCoverController],
  providers: [RestaurantCoverService],
})
export class MerchantModule {}
