import { Body, Controller, Post, UnauthorizedException } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { createOrderRequestSchema, type CreateOrderResponse } from '@banhao/validation';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
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
