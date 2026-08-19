import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain-error';

/** The two fee amounts `create_order()` requires and this codebase does not yet have. */
export interface OrderFees {
  deliveryFeeSatang: number;
  serviceFeeSatang: number;
}

/**
 * The single, explicit gate DEC-E-01 requires (Phase E-2).
 *
 * `POST /api/v1/orders` cannot create a real order without a delivery fee and
 * a service fee — `orders.delivery_fee_satang` and `orders.service_fee_satang`
 * are `not null`, and `public.create_order()` (DEC-E-02) has no default for
 * either, on purpose. BQ-026 (delivery fee) and BQ-027 (service fee) are
 * still `OPEN` — DEC-023/DEC-024 accept the *model* only, not a number — so
 * there is no authoritative amount anywhere in this repository to read.
 *
 * This class exists so that fact has exactly one place to live. It does not
 * compute a fee, approximate one, or fall back to zero — DEC-E-01 forbids
 * all three. `resolveOrderFees` always throws today. When the Product Owner
 * approves BQ-026/BQ-027, this method's body is the only thing that changes;
 * `OrdersService` and everything it calls stay exactly as they are.
 *
 * `OrdersService` depends on this through the constructor rather than calling
 * a bare function, so a test can substitute a synthetic fixture value to
 * exercise the rest of the order-creation flow — see
 * `orders.service.spec.ts`. A test double is not a production default: it
 * never runs outside a test process, and this class's real implementation
 * still refuses every real request.
 */
@Injectable()
export class OrderPricingService {
  // Unused today — every real implementation of this method will need both,
  // and the `^_` prefix is this repo's convention for "unused for now, not
  // unused by mistake" (see .eslintrc.json's argsIgnorePattern).
  resolveOrderFees(_restaurantId: string, _subtotalSatang: number): OrderFees {
    throw new DomainError('NOT_IMPLEMENTED', {
      message:
        'Delivery and service fee pricing is not yet approved (BQ-026, BQ-027 are OPEN; ' +
        'DEC-023/DEC-024 accept the model only). DEC-E-01 blocks order creation until the ' +
        'Product Owner approves both amounts — see docs/OPEN_BUSINESS_QUESTIONS.md.',
    });
  }
}
