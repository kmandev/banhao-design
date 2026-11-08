import { Injectable } from '@nestjs/common';
import { computeDeliveryFeeSatang } from '@banhao/validation';
import { calculateFoodSubtotalCommissionSatang } from '../payments/commission-pricing';
import { calculateServiceFeeSatang } from './service-fee-pricing';
import { DeliveryFeeSettingsService } from './delivery-fee-settings.service';

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
 * - **Delivery (DEC-070 §2 / DEC-071):** the back-office setting in force when
 *   the order is created — FIXED, or a PERCENT of the food subtotal — always
 *   held to ฿15–35, via `computeDeliveryFeeSatang`. The distance-based fee of
 *   DEC-061 D-08 is still unbuilt and blocked on D-16/D-17.
 * - **Service (DEC-061 D-03/D-04):** the food subtotal only — 5%, floor ฿5,
 *   cap ฿15 — via `calculateServiceFeeSatang`. Never the restaurant.
 *
 * `restaurantId` stays in the signature, unused, because neither fee may vary
 * by restaurant.
 *
 * ## What this deliberately does not do
 *
 * No distance, coordinates, routing, geocoding, zones or restaurant location
 * (D-08 is unbuilt — and customer addresses carry null lat/lng anyway, per
 * DQ-04-07). No environment variable and no request field: the delivery fee
 * comes from the server's own `delivery_fee_settings` (DEC-071), changed only
 * by ADMIN staff through an audited route, and the order stores amounts,
 * never rates.
 *
 * @see docs/DECISIONS.md — DEC-061 (D-03/D-04, D-05/D-06, D-09/D-10), DEC-070, DEC-071, DEC-E-01
 */
@Injectable()
export class OrderPricingService {
  constructor(private readonly deliveryFees: DeliveryFeeSettingsService) {}

  /**
   * @throws if `subtotalSatang` is not a non-negative integer (the service fee
   *   depends on it). The caller has not yet called `create_order()`, so this
   *   fails closed and no order is created.
   */
  async resolveOrderFees(_restaurantId: string, subtotalSatang: number): Promise<OrderFees> {
    // Validate the subtotal before any read, so a bad input never costs a query.
    const serviceFeeSatang = calculateServiceFeeSatang(subtotalSatang);
    const setting = await this.deliveryFees.current();
    // A fresh object per call: the caller receives a value it cannot use to
    // mutate this service's answer for the next order.
    return {
      deliveryFeeSatang: computeDeliveryFeeSatang(setting, subtotalSatang),
      serviceFeeSatang,
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
