import { Module } from '@nestjs/common';
import { RiderController } from './rider.controller';
import { RiderLocationService } from './rider-location.service';
import { OfferAcceptanceService } from './offer-acceptance.service';
import { DeliveryReleaseService } from './delivery-release.service';
import { DeliveryArrivalService } from './delivery-arrival.service';
import { DispatchService } from './dispatch.service';
import { DISPATCH_STRATEGY } from './dispatch-strategy.interface';
import { BroadcastDispatchStrategy } from './broadcast-dispatch.strategy';

/**
 * Rider and dispatch — Phase G-2.
 *
 * `DISPATCH_STRATEGY` is bound here and nowhere else, the same shape
 * `PaymentsModule` uses for `PAYMENT_PROVIDER`: when DEC-020's broadcast model
 * is revisited at Stage 2, a different strategy class is bound on this one line
 * and nothing else in the system changes. That is the entire point of the
 * abstraction, and it is why `DispatchService` owns the round while the
 * strategy owns only candidate selection.
 *
 * `DispatchService` is exported for `TickModule`, exactly as
 * `PaymentEventProcessingService` and `PaymentAttemptExpiryService` are — the
 * scheduled tick is a caller of this module, never the other way round. This
 * module imports neither the order nor the payment module, which is what keeps
 * dispatch replaceable without touching either domain.
 */
@Module({
  controllers: [RiderController],
  providers: [
    { provide: DISPATCH_STRATEGY, useClass: BroadcastDispatchStrategy },
    RiderLocationService,
    OfferAcceptanceService,
    DeliveryReleaseService,
    DeliveryArrivalService,
    DispatchService,
  ],
  exports: [DispatchService],
})
export class RiderModule {}
