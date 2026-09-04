import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { RestaurantCoverController } from './restaurant-cover.controller';
import { RestaurantCoverService } from './restaurant-cover.service';
import { MenuItemImageController } from './menu-item-image.controller';
import { MenuItemImageService } from './menu-item-image.service';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';
import { RestaurantHoursController } from './restaurant-hours.controller';
import { RestaurantHoursService } from './restaurant-hours.service';
import { RestaurantProfileController } from './restaurant-profile.controller';
import { RestaurantProfileService } from './restaurant-profile.service';
import { RestaurantAvailabilityController } from './restaurant-availability.controller';
import { RestaurantAvailabilityService } from './restaurant-availability.service';

/**
 * The merchant-facing API surface. M-11 (restaurant cover upload) was its
 * first slice; M-12 (menu item image upload) is the second — the natural home
 * for the rest of the merchant domain as it's built. Imports `StorageModule`
 * rather than constructing `StorageService` itself: this is the "future
 * MerchantModule" that module's own doc comment named as the reason it wasn't
 * registered in `AppModule` earlier.
 *
 * The UX specification's M-11 (menu management) and M-12 (operating hours) are
 * `MenuController` and `RestaurantHoursController`. **Note the numbering
 * collision the M-11 artifact records rather than resolves:** the two image
 * controllers above were labelled M-11 and M-12 in their own commits, for
 * restaurant cover and menu-item image respectively. Those labels are a
 * repository convention that predates the UX inventory; the screen names here
 * follow the UX specification, which is the meaning the design artifacts use.
 */
@Module({
  imports: [StorageModule],
  controllers: [
    RestaurantCoverController,
    MenuItemImageController,
    MenuController,
    RestaurantHoursController,
    RestaurantProfileController,
    RestaurantAvailabilityController,
  ],
  providers: [
    RestaurantCoverService,
    MenuItemImageService,
    MenuService,
    RestaurantHoursService,
    RestaurantProfileService,
    RestaurantAvailabilityService,
  ],
})
export class MerchantModule {}
