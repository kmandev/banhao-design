import { Body, Controller, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { cartValidateRequestSchema } from '@banhao/validation';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { parseOrThrow } from '../../common/validation/parse';
import type { AuthenticatedUser } from '../../common/types';
import { CartService, type CartValidationResult } from './cart.service';

/**
 * `POST /api/v1/cart/validate` (Phase D / D-6). V1.1 §6: "Re-price against
 * live catalog, no writes."
 *
 * Mounted under `cart/`, matching the V1.1 catalogue route exactly. Auth is
 * global-guard default (no `@Public()`), so an unauthenticated request never
 * reaches the handler at all.
 */
@ApiTags('cart')
@ApiBearerAuth()
@Controller('api/v1/cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Post('validate')
  // V1.1 §6: "no writes" — nothing is created, so 200 rather than the default
  // 201, matching the other non-creating POSTs (`tick`, `webhooks`).
  @HttpCode(200)
  @ApiOkResponse({ description: "The caller's cart, re-priced from the live catalog" })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiConflictResponse({ description: 'ITEM_UNAVAILABLE, PRICE_CHANGED, or MIXED_RESTAURANT' })
  async validate(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() body: unknown,
  ): Promise<CartValidationResult> {
    const input = parseOrThrow(cartValidateRequestSchema, body ?? {});
    return this.cart.validate(requireUser(user).id, input);
  }
}

/**
 * The global auth guard already rejects anonymous requests; this exists so the
 * type is non-optional at the call site, matching `AddressesController`.
 */
function requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) {
    throw new UnauthorizedException();
  }
  return user;
}
