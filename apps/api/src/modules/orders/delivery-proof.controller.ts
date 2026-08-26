import { Controller, Get, Param, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { DeliveryProofResponse } from '@banhao/validation';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/types';
import { DeliveryProofService } from './delivery-proof.service';

/**
 * `GET /api/v1/orders/:id/delivery-proof` — POD, Plan §8.3 / DEC-039's
 * explicitly-deferred customer read path.
 */
@ApiTags('orders')
@ApiBearerAuth()
@Controller('api/v1/orders')
export class DeliveryProofController {
  constructor(private readonly deliveryProof: DeliveryProofService) {}

  @Get(':id/delivery-proof')
  @Roles('CUSTOMER')
  @ApiOkResponse({ description: 'The proof photo (signed URL) if one exists and is within retention, or null' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiNotFoundResponse({ description: 'Order not found, or not owned by this customer' })
  async getDeliveryProof(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
  ): Promise<DeliveryProofResponse | null> {
    return this.deliveryProof.getProof(requireUser(user), id);
  }
}

/** Matches `OrdersController`'s own guard against an unset `@CurrentUser()`. */
function requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) {
    throw new UnauthorizedException();
  }
  return user;
}
