import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * The R2 storage foundation (Phase D). No controller yet — nothing in the API
 * authorizes a caller before reaching `StorageService` (Step 12), so there is
 * no route to mount. Not imported into `AppModule` for the same reason: doing
 * so today would have zero effect other than constructing an unused
 * singleton. A future `MerchantModule` imports this module once a restaurant
 * upload endpoint exists to actually call it.
 */
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
