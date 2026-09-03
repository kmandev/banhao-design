import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { StorageModule } from '../storage/storage.module';
import { RiderController } from './rider.controller';
import { RiderLocationService } from './rider-location.service';
import { OfferAcceptanceService } from './offer-acceptance.service';
import { DeliveryReleaseService } from './delivery-release.service';
import { DeliveryArrivalService } from './delivery-arrival.service';
import { DeliveryEnRouteService } from './delivery-en-route.service';
import { DeliveryCompletionService } from './delivery-completion.service';
import { DeliveryProofService } from './delivery-proof.service';
import { DeliveryPickupService } from './delivery-pickup.service';
import { DispatchService } from './dispatch.service';
import { NoRiderEscalationService } from './no-rider-escalation.service';
import { ProofPhotoRetentionService } from './proof-photo-retention.service';
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
 * `DispatchService`, `NoRiderEscalationService` (DEC-022) and
 * `ProofPhotoRetentionService` (DEC-039) are exported for `TickModule`,
 * exactly as `PaymentEventProcessingService` and `PaymentAttemptExpiryService`
 * are — the scheduled tick is a caller of this module, never the other way
 * round.
 *
 * `OrdersModule` is imported for `OrdersService` — Phase G-5's join point
 * (`DeliveryPickupService`) calls the existing, unmodified
 * `OrdersService.pickupOrder` for the order-side half of the
 * `AT_MERCHANT`/`READY_FOR_PICKUP -> PICKED_UP` transition rather than
 * reimplementing it, and Phase G-6 (`DeliveryEnRouteService`) does the same
 * with `OrdersService.startDelivery` for `PICKED_UP -> EN_ROUTE`/`DELIVERING`.
 * This is the one deliberate exception to "dispatch replaceable without
 * touching either domain": V1.1 §7 defines both transitions as touching both
 * domains, so this module imports the order module (never the payment module,
 * which stays untouched). No second `OrdersService` provider is declared here —
 * the one `OrdersModule` exports is the only instance.
 */
@Module({
  imports: [OrdersModule, StorageModule],
  controllers: [RiderController],
  providers: [
    { provide: DISPATCH_STRATEGY, useClass: BroadcastDispatchStrategy },
    RiderLocationService,
    OfferAcceptanceService,
    DeliveryReleaseService,
    DeliveryArrivalService,
    DeliveryPickupService,
    DeliveryEnRouteService,
    DeliveryCompletionService,
    DeliveryProofService,
    DispatchService,
    NoRiderEscalationService,
    ProofPhotoRetentionService,
  ],
  exports: [
    DispatchService,
    NoRiderEscalationService,
    ProofPhotoRetentionService,
    // Exported for Phase J's no-rider triage projection, which needs the size
    // of the pool dispatch would broadcast to right now. Exporting the seam
    // rather than the concrete class keeps DEC-020's swap point intact: a
    // Stage 2 strategy is still bound on one line above, and AI Operations
    // learns nothing about which class it is.
    DISPATCH_STRATEGY,
  ],
})
export class RiderModule {}
