import { Injectable } from '@nestjs/common';

/** The two fee amounts `create_order()` requires, in integer satang (CON-003). */
export interface OrderFees {
  deliveryFeeSatang: number;
  serviceFeeSatang: number;
}

/**
 * DEC-035 — the Phase 1 delivery fee. A flat ฿10 per order, charged
 * identically for every order regardless of distance, address, restaurant or
 * basket size. Deliberately not exported: nothing outside this file may reuse
 * it, because the server is the only pricing authority (DEC-E-01) and a
 * constant that can be imported is a constant that can end up in a client
 * bundle or a second, divergent calculation.
 */
const DELIVERY_FEE_SATANG = 1000;

/**
 * DEC-036 — the Phase 1 service fee. A fixed ฿5 per order: not a percentage,
 * not a percentage with a cap or a minimum, not tiered, not restaurant-
 * specific. Private for the same reason as `DELIVERY_FEE_SATANG`.
 */
const SERVICE_FEE_SATANG = 500;

/**
 * Order pricing — the single server-side authority for what an order costs
 * beyond its subtotal.
 *
 * This class exists so the two fee amounts have exactly one home. It resolves
 * them; it does not accept, merge or reconcile any amount supplied by a
 * client. `OrdersService` calls it after the cart and address are settled and
 * passes the result straight to `create_order()`, which stores the amounts —
 * never rates — on the order row. `orders_enforce_immutable_columns()` then
 * makes those columns unchangeable for every role, so a fee resolved here is
 * final for the life of the order.
 *
 * ## Why the arguments are unused
 *
 * `restaurantId` and `subtotalSatang` stay in the signature because both
 * decisions are explicit that the *model*, not just the number, is flat and
 * fixed: the answer must not vary with the restaurant or the basket. Keeping
 * the inputs and ignoring them states that deliberately, and keeps the
 * call site stable for whatever a future, separately approved pricing model
 * needs.
 *
 * ## What this deliberately does not do
 *
 * No distance, coordinates, routing, geocoding, zones or restaurant location
 * (DEC-035 rules all of them out for Phase 1 — and customer addresses carry
 * null lat/lng anyway, per DQ-04-07). No percentage of the subtotal
 * (DEC-036). No environment variable, no configuration table, no request
 * field: DEC-035 and DEC-036 require no schema change, and reading a fee from
 * anywhere a deployment or a caller could influence would move the pricing
 * authority off the server. Distance-banded delivery pricing is **not**
 * approved and must not be added here without a new Product Owner decision.
 *
 * @see docs/DECISIONS.md — DEC-035, DEC-036, DEC-E-01
 */
@Injectable()
export class OrderPricingService {
  resolveOrderFees(_restaurantId: string, _subtotalSatang: number): OrderFees {
    // A fresh object per call: the caller receives a value it cannot use to
    // mutate this service's answer for the next order.
    return {
      deliveryFeeSatang: DELIVERY_FEE_SATANG,
      serviceFeeSatang: SERVICE_FEE_SATANG,
    };
  }
}
