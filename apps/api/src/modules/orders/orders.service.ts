import { Injectable, Logger } from '@nestjs/common';
import type { CreateOrderRequest, CreateOrderResponse } from '@banhao/validation';
import { uuidSchema } from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';
import { getCorrelationId } from '../../common/correlation/correlation';
import { CartService } from '../cart/cart.service';
import { AddressesService } from '../users/addresses.service';
import { OrderPricingService } from './order-pricing.service';

/** What `select * from public.create_order(...)` returns, one row. */
interface CreateOrderRow {
  order_id: string;
  order_number: string;
  state: string;
}

/**
 * `POST /api/v1/orders` (Phase E-2).
 *
 * This service does not write an order itself. It resolves and validates
 * everything `public.create_order()` (DEC-E-02) needs, then makes exactly one
 * call to that function — the sole atomic write boundary (`orders` +
 * `order_items` + `order_item_options` + `order_status_history`, one
 * transaction, `SECURITY INVOKER`, `service_role`-only). Nothing here opens a
 * second transaction, writes a domain table directly, or duplicates what the
 * function already enforces — every check below exists to fail with a clean,
 * specific `DomainError` *before* the atomic call, not to protect it.
 *
 * ## Reused, not reimplemented
 *
 * Cart resolution and pricing reuse `CartService.validate` verbatim — the
 * same re-pricing, the same `ITEM_UNAVAILABLE` / `MIXED_RESTAURANT` /
 * `PRICE_CHANGED` semantics `POST /cart/validate` already has, because a
 * stale or invalid cart must be refused identically whether the caller is
 * about to look at a diff screen or about to place an order. Address
 * ownership reuses `AddressesService.getOwned`, the same "ownership is a
 * query filter" discipline every other address operation already follows.
 *
 * ## What is deliberately NOT here yet — DEC-E-01
 *
 * `OrderPricingService.resolveOrderFees` always throws today (BQ-026/BQ-027
 * are OPEN). This service calls it anyway, in its normal position in the
 * flow, so the day those numbers are approved only `OrderPricingService`
 * changes — nothing here does.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly cart: CartService,
    private readonly addresses: AddressesService,
    private readonly pricing: OrderPricingService,
  ) {}

  async create(customerId: string, request: CreateOrderRequest): Promise<CreateOrderResponse> {
    // ---------------------------------------------------------------------
    // Cart — the same re-pricing CartService.validate already does for
    // `POST /cart/validate`. Raises ITEM_UNAVAILABLE / MIXED_RESTAURANT
    // itself; PRICE_CHANGED too, when the caller supplied expectedLines.
    // An empty/absent cart is that method's own valid, zero result — CART_EMPTY
    // belongs to this endpoint, per that service's own doc comment, so it is
    // this service's job to raise it.
    // ---------------------------------------------------------------------

    const validation = await this.cart.validate(customerId, {
      expectedLines: request.expectedLines,
    });

    // Narrowed into a local so TypeScript (and every line below) can treat it
    // as the non-null string it is once the empty-cart cases are ruled out —
    // CartService.validate only omits restaurantId when cartId is also null.
    const restaurantId = validation.restaurantId;

    if (!validation.cartId || !restaurantId || validation.lines.length === 0) {
      throw new DomainError('CART_EMPTY');
    }

    // ---------------------------------------------------------------------
    // Address — must belong to this customer and be unarchived. Indistinguishable
    // NOT_FOUND for "does not exist" vs. "belongs to someone else", matching
    // AddressesService.update/archive's own precedent.
    // ---------------------------------------------------------------------

    const address = await this.addresses.getOwned(customerId, request.addressId);
    if (!address) {
      throw new DomainError('NOT_FOUND', { message: 'Address not found' });
    }

    // ---------------------------------------------------------------------
    // Fees — DEC-E-01's gate. Throws today; see OrderPricingService.
    // ---------------------------------------------------------------------

    const fees = this.pricing.resolveOrderFees(restaurantId, validation.subtotalSatang);

    // ---------------------------------------------------------------------
    // The one write. Everything above resolved trusted, server-side values;
    // nothing from `request` reaches this call except `addressId` (already
    // ownership-checked) and `paymentMethod` (already schema-restricted to
    // 'ONLINE' — DEC-016).
    // ---------------------------------------------------------------------

    const correlationId = getCorrelationId();
    const parsedCorrelationId = uuidSchema.safeParse(correlationId);

    const { data, error } = await this.supabase.admin.rpc('create_order', {
      p_customer_id: customerId,
      p_address_id: request.addressId,
      p_payment_method: request.paymentMethod,
      p_delivery_fee_satang: fees.deliveryFeeSatang,
      p_service_fee_satang: fees.serviceFeeSatang,
      // create_order's p_correlation_id column is uuid — a correlation id is
      // only ever a random UUID (see correlation.ts's own generator) unless a
      // client supplied a non-UUID trace id under the module's own looser
      // [A-Za-z0-9_-]{1,128} rule; passing a non-UUID string here would fail
      // the RPC's type cast, so only a genuinely UUID-shaped id is forwarded.
      p_correlation_id: parsedCorrelationId.success ? parsedCorrelationId.data : null,
    });

    if (error) {
      this.raiseFromCreateOrderError(customerId, error.message);
    }

    const row = (data as CreateOrderRow[] | null)?.[0];
    if (!row) {
      this.logger.error(`create_order returned no row for customer ${customerId}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Order creation returned no result' });
    }

    return { orderId: row.order_id, orderNumber: row.order_number, state: row.state };
  }

  /**
   * Translates a `create_order()` failure into the catalogue.
   *
   * Every case named here is a defence-in-depth catch — this service already
   * checked cart, address and payment method before calling the function —
   * reachable only through a genuine race (the cart emptied, the restaurant
   * closed, or the address was archived in the moments between this
   * service's own checks and the atomic call). The raw Postgres message is
   * logged in full server-side and never returned to the client (§11):
   * `DomainError`'s message is the catalogue code's own generic default.
   */
  private raiseFromCreateOrderError(customerId: string, message: string): never {
    this.logger.error(`create_order failed for customer ${customerId}: ${message}`);

    if (message.includes('is empty') || message.includes('has no open cart')) {
      throw new DomainError('CART_EMPTY');
    }
    if (message.includes('unavailable items')) {
      throw new DomainError('ITEM_UNAVAILABLE');
    }
    if (message.includes('is not ACTIVE')) {
      throw new DomainError('RESTAURANT_CLOSED');
    }
    if (message.includes('not a usable address')) {
      throw new DomainError('NOT_FOUND', { message: 'Address not found' });
    }

    throw new DomainError('INTERNAL_ERROR', { message: 'Order creation failed' });
  }
}
