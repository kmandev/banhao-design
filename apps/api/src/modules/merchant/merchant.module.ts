import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { RestaurantCoverController } from './restaurant-cover.controller';
import { RestaurantCoverService } from './restaurant-cover.service';
import { MenuItemImageController } from './menu-item-image.controller';
import { MenuItemImageService } from './menu-item-image.service';

/**
 * The merchant-facing API surface. M-11 (restaurant cover upload) was its
 * first slice; M-12 (menu item image upload) is the second — the natural home
 * for the rest of the merchant domain as it's built. Imports `StorageModule`
 * rather than constructing `StorageService` itself: this is the "future
 * MerchantModule" that module's own doc comment named as the reason it wasn't
 * registered in `AppModule` earlier.
 */
@Module({
  imports: [StorageModule],
  controllers: [RestaurantCoverController, MenuItemImageController],
  providers: [RestaurantCoverService, MenuItemImageService],
})
export class MerchantModule {}
