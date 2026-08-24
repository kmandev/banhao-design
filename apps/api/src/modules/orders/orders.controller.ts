import { Body, Controller, HttpCode, Param, Post, UnauthorizedException } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  cancelOrderRequestSchema,
  createOrderRequestSchema,
  type CreateOrderResponse,
  type OrderTransitionResponse,
} from '@banhao/validation';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { parseOrThrow } from '../../common/validation/parse';
import type { AuthenticatedUser } from '../../common/types';
import { OrdersService } from './orders.service';

/**
 * `POST /api/v1/orders` (Phase E-2). V1.1 §6/§19: full snapshotting from the
 * caller's own cart, one atomic write via `public.create_order()` (DEC-E-02).
 *
 * Default 201 (Nest's own default for `@Post`) — unlike `POST /cart/validate`
 * this genuinely creates a resource, so it keeps the framework default rather
 * than overriding to 200 the way that read-only endpoint does.
 */
@ApiTags('orders')
@ApiBearerAuth()
@Controller('api/v1/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @ApiCreatedResponse({ description: 'The created order — id, order_number, and initial state' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiNotFoundResponse({ description: 'addressId does not belong to the caller' })
  @ApiConflictResponse({
    description: 'CART_EMPTY, ITEM_UNAVAILABLE, PRICE_CHANGED, MIXED_RESTAURANT, or RESTAURANT_CLOSED',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() body: unknown,
  ): Promise<CreateOrderResponse> {
    const input = parseOrThrow(createOrderRequestSchema, body);
    return this.orders.create(requireUser(user).id, input);
  }

  // ---------------------------------------------------------------------
  // State transitions — Phase E-4.1. Every route is a command, never
  // `PATCH { state }` (ADR-009) — the actor is always the server-verified
  // caller (`@CurrentUser()`), never a body field. `@Roles(...)` here is a
  // coarse "is this actor this kind of thing at all" filter, exactly like
  // every other capability-gated route in this API; resource-level
  // authorization (does this merchant own *this* order's restaurant, does
  // this customer own *this* order) happens inside `OrdersService`, where
  // the order itself is resolved — the route only carries an order id, not
  // a restaurant id, so `@RestaurantScope()` does not apply here the way it
  // does on `/merchant/restaurants/:restaurantId/...` routes.
  // ---------------------------------------------------------------------

  @Post(':id/accept')
  @HttpCode(200)
  @Roles('MERCHANT')
  @ApiOkResponse({ description: 'The order, now MERCHANT_ACCEPTED' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not a merchant' })
  @ApiConflictResponse({ description: 'INVALID_TRANSITION or NOT_RESTAURANT_MEMBER' })
  async accept(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
  ): Promise<OrderTransitionResponse> {
    return this.orders.acceptOrder(requireUser(user), id);
  }

  @Post(':id/start-preparing')
  @HttpCode(200)
  @Roles('MERCHANT')
  @ApiOkResponse({ description: 'The order, now PREPARING' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not a merchant' })
  @ApiConflictResponse({ description: 'INVALID_TRANSITION or NOT_RESTAURANT_MEMBER' })
  async startPreparing(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
  ): Promise<OrderTransitionResponse> {
    return this.orders.startPreparing(requireUser(user), id);
  }

  @Post(':id/mark-ready')
  @HttpCode(200)
  @Roles('MERCHANT')
  @ApiOkResponse({ description: 'The order, now READY_FOR_PICKUP' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not a merchant' })
  @ApiConflictResponse({ description: 'INVALID_TRANSITION or NOT_RESTAURANT_MEMBER' })
  async markReady(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
  ): Promise<OrderTransitionResponse> {
    return this.orders.markReady(requireUser(user), id);
  }

  @Post(':id/pickup')
  @HttpCode(200)
  @Roles('RIDER')
  @ApiOkResponse({ description: 'The order, now PICKED_UP' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not a rider' })
  @ApiConflictResponse({ description: 'INVALID_TRANSITION' })
  async pickup(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
  ): Promise<OrderTransitionResponse> {
    return this.orders.pickupOrder(requireUser(user), id);
  }

  @Post(':id/start-delivery')
  @HttpCode(200)
  @Roles('RIDER')
  @ApiOkResponse({ description: 'The order, now DELIVERING' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not a rider' })
  @ApiConflictResponse({ description: 'INVALID_TRANSITION' })
  async startDelivery(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
  ): Promise<OrderTransitionResponse> {
    return this.orders.startDelivery(requireUser(user), id);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @Roles('RIDER')
  @ApiOkResponse({ description: 'The order, now DELIVERED' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not a rider' })
  @ApiConflictResponse({ description: 'INVALID_TRANSITION' })
  async complete(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
  ): Promise<OrderTransitionResponse> {
    return this.orders.completeDelivery(requireUser(user), id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles('CUSTOMER', 'OPERATOR')
  @ApiOkResponse({ description: 'The order, now CANCELLED' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not the order owner and not an operator' })
  @ApiNotFoundResponse({ description: 'Order not found, or not owned by this customer' })
  @ApiConflictResponse({ description: 'INVALID_TRANSITION — past the cancellable window' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<OrderTransitionResponse> {
    const input = parseOrThrow(cancelOrderRequestSchema, body ?? {});
    return this.orders.cancelOrder(requireUser(user), id, input.reason);
  }
}

/**
 * The global auth guard already rejects anonymous requests; this exists so the
 * type is non-optional at the call site, matching every other controller in
 * this module set (AddressesController, CartController).
 */
function requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) {
    throw new UnauthorizedException();
  }
  return user;
}
