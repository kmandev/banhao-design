import { Injectable, Logger } from '@nestjs/common';
import type {
  CreateOrderRequest,
  CreateOrderResponse,
  OrderTransitionResponse,
} from '@banhao/validation';
import { uuidSchema } from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';
import { getCorrelationId } from '../../common/correlation/correlation';
import { hasCapability } from '../../common/types';
import type { AuthenticatedUser } from '../../common/types';
import { CartService } from '../cart/cart.service';
import { AddressesService } from '../users/addresses.service';
import { OrderPricingService } from './order-pricing.service';

/** What `select * from public.create_order(...)` returns, one row. */
interface CreateOrderRow {
  order_id: string;
  order_number: string;
  state: string;
}

/** The columns a transition's diagnostic read needs after a guarded UPDATE finds 0 rows. */
interface OrderDiagnosisRow {
  id: string;
  restaurant_id: string;
  state: string;
}

type ActorType = 'CUSTOMER' | 'MERCHANT' | 'RIDER' | 'OPERATOR';

/**
 * `docs/ORDER_LIFECYCLE.md` § 5 — a customer may cancel free only before the
 * restaurant has accepted. `MERCHANT_ACCEPTED` itself is deliberately absent:
 * customer cancellation past that point is "⚠️ merchant confirms", not free,
 * and merchant-confirmed cancellation is BQ-013, still `OPEN`.
 */
const CUSTOMER_CANCELLABLE_STATES = ['CREATED', 'PENDING_PAYMENT', 'PAID'] as const;

/**
 * DEC-022 — an operator may cancel any non-terminal order before `DELIVERED`.
 * The five exception states are excluded because they are not implemented
 * (DEC-APP-006) and therefore never reachable in practice, but listing only
 * the nine core states keeps this array an honest description of what the
 * running system can actually be in.
 */
const OPERATOR_CANCELLABLE_STATES = [
  'CREATED',
  'PENDING_PAYMENT',
  'PAID',
  'MERCHANT_ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'DELIVERING',
] as const;

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
 * ## Pricing — DEC-E-01
 *
 * `OrderPricingService.resolveOrderFees` is the sole authority for the
 * delivery and service fee amounts (DEC-035, DEC-036) and is called here in
 * its normal position in the flow. DEC-E-01 still governs: no fee value ever
 * comes from `request`, and a future change to either amount is a change to
 * `OrderPricingService` alone — nothing here does.
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
    // Fees — server-derived, per DEC-E-01. See OrderPricingService.
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

  // ---------------------------------------------------------------------
  // State transitions — Phase E-4.1 (DEC-019, DEC-APP-006).
  //
  // Every method below is a single guarded conditional UPDATE whose WHERE
  // clause repeats the expected current state (and, for merchant/customer
  // actors, ownership) — never a prior SELECT to decide whether to write
  // (ADR-003, V1.1 §7 "Transition mechanics"). `rowCount === 1` is success;
  // 0 rows means someone else already moved it, the order does not exist, or
  // (merchant only) it is not this actor's restaurant — `buildFailedTransitionError`
  // runs a second, diagnostic-only SELECT purely to pick the right catalogue
  // code for the response; it never influences whether the transition itself
  // happened, which is already decided by the UPDATE's rowcount.
  //
  // Only the nine ACCEPTED transitions plus customer/operator CANCELLED are
  // implemented (DEC-APP-006). PAYMENT_FAILED, PAYMENT_EXPIRED,
  // MERCHANT_REJECTED, DELIVERY_FAILED and merchant-initiated cancellation
  // during PREPARING (BQ-013, still OPEN) are deliberately absent.
  //
  // Known gap, not an oversight: V1.1 §6/§7 describes `MERCHANT_ACCEPTED`
  // also creating a `deliveries` row and starting rider search (DEC-020).
  // That is delivery-domain work — Phase G, explicitly out of scope here —
  // so this method moves only `orders.state`. An order reaching
  // `MERCHANT_ACCEPTED` today does not yet trigger rider search; Phase G
  // must close that gap before dispatch is real.
  // ---------------------------------------------------------------------

  /** `PAID → MERCHANT_ACCEPTED`. Merchant, scoped to their own restaurant. */
  async acceptOrder(user: AuthenticatedUser, orderId: string): Promise<OrderTransitionResponse> {
    return this.merchantTransition(user, orderId, 'PAID', 'MERCHANT_ACCEPTED', 'accepted_at');
  }

  /** `MERCHANT_ACCEPTED → PREPARING`. No timestamp column exists for this one. */
  async startPreparing(user: AuthenticatedUser, orderId: string): Promise<OrderTransitionResponse> {
    return this.merchantTransition(user, orderId, 'MERCHANT_ACCEPTED', 'PREPARING', null);
  }

  /** `PREPARING → READY_FOR_PICKUP`. */
  async markReady(user: AuthenticatedUser, orderId: string): Promise<OrderTransitionResponse> {
    return this.merchantTransition(user, orderId, 'PREPARING', 'READY_FOR_PICKUP', 'ready_at');
  }

  /**
   * `READY_FOR_PICKUP → PICKED_UP`. Rider, authenticated only.
   *
   * V1.1 §7 lists this transition's guard as "`READY_FOR_PICKUP` **and**
   * delivery has assigned rider — the join point". The assigned-rider half is
   * delivery-domain state (`deliveries.rider_id`) that Phase G owns and this
   * task explicitly excludes, so only the order-domain half of the guard is
   * enforced here. Restricting *which* rider may call this is therefore a
   * known gap closed by Phase G, not by this method.
   */
  async pickupOrder(user: AuthenticatedUser, orderId: string): Promise<OrderTransitionResponse> {
    return this.riderTransition(user, orderId, 'READY_FOR_PICKUP', 'PICKED_UP', 'picked_up_at');
  }

  /** `PICKED_UP → DELIVERING`. No timestamp column exists for this one. */
  async startDelivery(user: AuthenticatedUser, orderId: string): Promise<OrderTransitionResponse> {
    return this.riderTransition(user, orderId, 'PICKED_UP', 'DELIVERING', null);
  }

  /** `DELIVERING → DELIVERED`. Terminal success. */
  async completeDelivery(user: AuthenticatedUser, orderId: string): Promise<OrderTransitionResponse> {
    return this.riderTransition(user, orderId, 'DELIVERING', 'DELIVERED', 'delivered_at');
  }

  /**
   * `→ CANCELLED`, from a customer or an operator (DEC-APP-006).
   *
   * Two disjoint actors, two disjoint rulesets — kept as one method because
   * they share one target state and one history write, not because the
   * rules are actually the same:
   *
   * - **Customer**: only their own order (ownership is a query filter, same
   *   discipline as `AddressesService`), and only before `MERCHANT_ACCEPTED`
   *   (`docs/ORDER_LIFECYCLE.md` § 5 — free cancellation window).
   * - **Operator**: any order, any non-terminal state before `DELIVERED`
   *   (DEC-022's platform-fallback authority).
   *
   * Merchant-initiated cancellation during `PREPARING` is BQ-013, still
   * `OPEN`, and is not implemented by either branch.
   */
  async cancelOrder(
    user: AuthenticatedUser,
    orderId: string,
    reason: string | undefined,
  ): Promise<OrderTransitionResponse> {
    if (hasCapability(user.capabilities, 'OPERATOR')) {
      return this.operatorCancel(user, orderId, reason);
    }
    return this.customerCancel(user, orderId, reason);
  }

  private async merchantTransition(
    user: AuthenticatedUser,
    orderId: string,
    fromState: string,
    toState: string,
    timestampColumn: string | null,
  ): Promise<OrderTransitionResponse> {
    const restaurantIds = user.capabilities.merchant.map((m) => m.restaurantId);
    if (restaurantIds.length === 0) {
      throw new DomainError('NOT_RESTAURANT_MEMBER');
    }

    const patch: Record<string, unknown> = { state: toState };
    if (timestampColumn) {
      patch[timestampColumn] = new Date().toISOString();
    }

    const { data, error } = await this.supabase.admin
      .from('orders')
      .update(patch)
      .eq('id', orderId)
      .eq('state', fromState)
      .in('restaurant_id', restaurantIds)
      .select('id, restaurant_id, state')
      .maybeSingle<OrderDiagnosisRow>();

    if (error) {
      this.failTransition(orderId, fromState, toState, error.message);
    }

    if (!data) {
      throw await this.buildFailedTransitionError(orderId, restaurantIds);
    }

    await this.writeHistory(orderId, fromState, toState, 'MERCHANT', user.id);

    return { orderId: data.id, state: data.state };
  }

  private async riderTransition(
    user: AuthenticatedUser,
    orderId: string,
    fromState: string,
    toState: string,
    timestampColumn: string | null,
  ): Promise<OrderTransitionResponse> {
    const patch: Record<string, unknown> = { state: toState };
    if (timestampColumn) {
      patch[timestampColumn] = new Date().toISOString();
    }

    const { data, error } = await this.supabase.admin
      .from('orders')
      .update(patch)
      .eq('id', orderId)
      .eq('state', fromState)
      .select('id, restaurant_id, state')
      .maybeSingle<OrderDiagnosisRow>();

    if (error) {
      this.failTransition(orderId, fromState, toState, error.message);
    }

    if (!data) {
      throw await this.buildFailedTransitionError(orderId);
    }

    await this.writeHistory(orderId, fromState, toState, 'RIDER', user.id);

    return { orderId: data.id, state: data.state };
  }

  /**
   * Ownership is a query filter, matching `AddressesService`'s precedent: a
   * 0-row result always reads back as `NOT_FOUND`, whether the order does not
   * exist, belongs to another customer, or is past the cancellable window.
   * Telling those apart would confirm the existence and state of an order
   * that is not this caller's — the same reasoning `AddressesService.update`
   * already applies to a foreign address id.
   */
  private async customerCancel(
    user: AuthenticatedUser,
    orderId: string,
    reason: string | undefined,
  ): Promise<OrderTransitionResponse> {
    const { data, error } = await this.supabase.admin
      .from('orders')
      .update({ state: 'CANCELLED', cancelled_at: new Date().toISOString() })
      .eq('id', orderId)
      .eq('customer_id', user.id)
      .in('state', CUSTOMER_CANCELLABLE_STATES)
      .select('id, restaurant_id, state')
      .maybeSingle<OrderDiagnosisRow>();

    if (error) {
      this.failTransition(orderId, 'CANCELLABLE', 'CANCELLED', error.message);
    }

    if (!data) {
      throw new DomainError('NOT_FOUND', { message: 'Order not found' });
    }

    await this.writeHistory(orderId, null, 'CANCELLED', 'CUSTOMER', user.id, reason);

    return { orderId: data.id, state: data.state };
  }

  /** Operator cancellation carries no ownership scope — DEC-022's platform-fallback authority. */
  private async operatorCancel(
    user: AuthenticatedUser,
    orderId: string,
    reason: string | undefined,
  ): Promise<OrderTransitionResponse> {
    const { data, error } = await this.supabase.admin
      .from('orders')
      .update({ state: 'CANCELLED', cancelled_at: new Date().toISOString() })
      .eq('id', orderId)
      .in('state', OPERATOR_CANCELLABLE_STATES)
      .select('id, restaurant_id, state')
      .maybeSingle<OrderDiagnosisRow>();

    if (error) {
      this.failTransition(orderId, 'CANCELLABLE', 'CANCELLED', error.message);
    }

    if (!data) {
      throw await this.buildFailedTransitionError(orderId);
    }

    await this.writeHistory(orderId, null, 'CANCELLED', 'OPERATOR', user.id, reason);

    return { orderId: data.id, state: data.state };
  }

  /**
   * The diagnostic-only read a failed guarded UPDATE falls back to, purely to
   * pick the right catalogue code — built and returned, not thrown directly,
   * so every call site reads `throw await this.buildFailedTransitionError(...)`
   * and TypeScript (and a reader) can see the throw at the point it happens.
   * Never consulted beforehand and never what decides whether a transition
   * happens — that is the UPDATE's rowcount alone (ADR-003).
   * `allowedRestaurantIds`, when given, distinguishes a genuinely missing
   * order from one that exists but belongs to a restaurant this merchant is
   * not a member of.
   */
  private async buildFailedTransitionError(
    orderId: string,
    allowedRestaurantIds?: string[],
  ): Promise<DomainError> {
    const { data } = await this.supabase.admin
      .from('orders')
      .select('id, restaurant_id, state')
      .eq('id', orderId)
      .maybeSingle<OrderDiagnosisRow>();

    if (!data) {
      return new DomainError('NOT_FOUND', { message: 'Order not found' });
    }

    if (allowedRestaurantIds && !allowedRestaurantIds.includes(data.restaurant_id)) {
      return new DomainError('NOT_RESTAURANT_MEMBER');
    }

    return new DomainError('INVALID_TRANSITION', { details: { currentState: data.state } });
  }

  /**
   * Appends exactly one `order_status_history` row for a transition that has
   * already succeeded. Only ever called after the guarded UPDATE's rowcount
   * confirms the move happened — never for a failed attempt.
   *
   * `from_state` is `null` for cancellation: the customer/operator branches
   * accept several possible starting states in one guarded UPDATE (see
   * `CUSTOMER_CANCELLABLE_STATES` / `OPERATOR_CANCELLABLE_STATES`), so no
   * single value would be accurate without a second read — and this table is
   * append-only history, not the transition's source of truth, so leaving it
   * `null` here costs nothing `orders.state` itself does not already answer.
   */
  private async writeHistory(
    orderId: string,
    fromState: string | null,
    toState: string,
    actorType: ActorType,
    actorId: string,
    reason?: string,
  ): Promise<void> {
    const correlationId = getCorrelationId();
    const parsedCorrelationId = uuidSchema.safeParse(correlationId);

    const { error } = await this.supabase.admin.from('order_status_history').insert({
      order_id: orderId,
      from_state: fromState,
      to_state: toState,
      actor_type: actorType,
      actor_id: actorId,
      reason: reason ?? null,
      correlation_id: parsedCorrelationId.success ? parsedCorrelationId.data : null,
    });

    if (error) {
      this.logger.error(
        `order_status_history insert failed for order ${orderId} (-> ${toState}): ${error.message}`,
      );
      throw new DomainError('INTERNAL_ERROR', { message: 'Order transition history failed' });
    }
  }

  private failTransition(orderId: string, fromState: string, toState: string, message: string): never {
    this.logger.error(`Order transition ${fromState} -> ${toState} failed for order ${orderId}: ${message}`);
    throw new DomainError('INTERNAL_ERROR', { message: 'Order transition failed' });
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
