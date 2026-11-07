import { Injectable } from '@nestjs/common';
import { calculateFoodSubtotalCommissionSatang } from '../payments/commission-pricing';
import { calculateServiceFeeSatang } from './service-fee-pricing';

/** The two fee amounts `create_order()` requires, in integer satang (CON-003). */
export interface OrderFees {
  deliveryFeeSatang: number;
  serviceFeeSatang: number;
}

/**
 * D-01: the order-time commission snapshot inputs `create_order()` requires.
 * `commissionSatang` is the resolved amount, never a rate (D-01-S1).
 * `foodSubtotalSatang` is the exact base it was resolved against.
 * `create_order()` refuses the call unless that base equals the food subtotal
 * it stores on the order.
 */
export interface OrderCommission {
  commissionSatang: number;
  foodSubtotalSatang: number;
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
 * ## What each fee depends on
 *
 * - **Delivery (DEC-035):** nothing. Flat ฿10 for every order, restaurant and
 *   basket. The dynamic, distance-based delivery fee of DEC-061 D-05…D-10 is
 *   locked but not built, and stays blocked on D-16/D-17.
 * - **Service (DEC-061 D-03/D-04):** the food subtotal only — 5%, floor ฿5,
 *   cap ฿15 — via `calculateServiceFeeSatang`. Never the restaurant.
 *
 * `restaurantId` stays in the signature, unused, because neither fee may vary
 * by restaurant.
 *
 * ## What this deliberately does not do
 *
 * No distance, coordinates, routing, geocoding, zones or restaurant location
 * (DEC-035 rules all of them out for Phase 1 — and customer addresses carry
 * null lat/lng anyway, per DQ-04-07). No environment variable, no
 * configuration table, no request field: neither DEC-035 nor D-03/D-04 needs
 * a schema change (the order stores amounts, never rates), and reading a fee from
 * anywhere a deployment or a caller could influence would move the pricing
 * authority off the server. Distance-banded delivery pricing is **not**
 * approved and must not be added here without a new Product Owner decision.
 *
 * @see docs/DECISIONS.md — DEC-035, DEC-061 (D-03/D-04, superseding DEC-036), DEC-E-01
 */
@Injectable()
export class OrderPricingService {
  /**
   * @throws if `subtotalSatang` is not a non-negative integer (the service fee
   *   depends on it). The caller has not yet called `create_order()`, so this
   *   fails closed and no order is created.
   */
  resolveOrderFees(_restaurantId: string, subtotalSatang: number): OrderFees {
    // A fresh object per call: the caller receives a value it cannot use to
    // mutate this service's answer for the next order.
    return {
      deliveryFeeSatang: DELIVERY_FEE_SATANG,
      serviceFeeSatang: calculateServiceFeeSatang(subtotalSatang),
    };
  }

  /**
   * D-01: resolves the merchant commission for a new order, once, from its
   * food subtotal, using the canonical `calculateFoodSubtotalCommissionSatang`
   * (10%, D-02 whole-baht round-half-up). No second implementation exists
   * anywhere, and nothing re-derives it later: `create_order()` freezes the
   * result into `order_commission_snapshots`, and payment confirmation reads
   * the stored amount.
   *
   * An invalid subtotal throws. The caller has not yet called
   * `create_order()`, so a resolution failure fails closed and no order is
   * created.
   */
  resolveOrderCommission(foodSubtotalSatang: number): OrderCommission {
    return {
      commissionSatang: calculateFoodSubtotalCommissionSatang(foodSubtotalSatang),
      foodSubtotalSatang,
    };
  }
}
