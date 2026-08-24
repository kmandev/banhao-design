import { Controller, HttpCode, Param, Post, UnauthorizedException } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { PaymentInitiationResponse } from '@banhao/validation';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/types';
import { PaymentsService } from './payments.service';

/**
 * `POST /api/v1/orders/:id/payment` (Phase F-1). No request body — every
 * value the payment needs is server-derived (see `PaymentsService`'s own doc
 * comment). 200, not 201: this mutates an existing order into
 * `PENDING_PAYMENT` and may return an already-existing payment on retry
 * (DEC-028) — it does not unconditionally create a new resource.
 */
@ApiTags('payments')
@ApiBearerAuth()
@Controller('api/v1/orders')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(':id/payment')
  @HttpCode(200)
  @Roles('CUSTOMER')
  @ApiOkResponse({ description: 'The payment — id, reference, state, amount, and a simulated QR' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiNotFoundResponse({ description: 'Order not found, or not owned by this customer' })
  @ApiConflictResponse({ description: 'ORDER_NOT_PAYABLE — the order is not in a state that can start a payment' })
  async createPayment(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
  ): Promise<PaymentInitiationResponse> {
    return this.payments.createPayment(requireUser(user), id);
  }
}

function requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) {
    throw new UnauthorizedException();
  }
  return user;
}
