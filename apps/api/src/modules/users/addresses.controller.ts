import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { createAddressSchema, updateAddressSchema, uuidSchema } from '@banhao/validation';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { parseOrThrow } from '../../common/validation/parse';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';
import { AddressesService, type Address } from './addresses.service';

/**
 * The caller's saved delivery addresses.
 *
 * Mounted under `me/` rather than `addresses/:id` because the resource is
 * defined by who is asking: there is no route here that can name another user's
 * address, so ownership is expressed in the URL shape and not only in code.
 */
@ApiTags('addresses')
@ApiBearerAuth()
@Controller('api/v1/me/addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  @ApiOkResponse({ description: "The caller's active addresses" })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async list(@CurrentUser() user: AuthenticatedUser | undefined): Promise<Address[]> {
    return this.addresses.list(requireUser(user).id);
  }

  @Post()
  @ApiOkResponse({ description: 'The created address' })
  @ApiBadRequestResponse({ description: 'Invalid request body' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async create(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() body: unknown,
  ): Promise<Address> {
    const input = parseOrThrow(createAddressSchema, body);
    return this.addresses.create(requireUser(user).id, input);
  }

  @Patch(':id')
  @ApiOkResponse({ description: 'The updated address' })
  @ApiBadRequestResponse({ description: 'Invalid request body or id' })
  @ApiNotFoundResponse({ description: 'No such address for this user' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async update(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Address> {
    const input = parseOrThrow(updateAddressSchema, body);
    return this.addresses.update(requireUser(user).id, requireUuid(id), input);
  }

  /**
   * Archives the address. Returns 204 whether or not anything is left to show —
   * but only after confirming a row the caller owns was actually archived; a
   * missing or foreign id is a 404, not a silent success.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Address archived' })
  @ApiNotFoundResponse({ description: 'No such address for this user' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async remove(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
  ): Promise<void> {
    await this.addresses.archive(requireUser(user).id, requireUuid(id));
  }
}

/**
 * The global auth guard already rejects anonymous requests; this exists so the
 * type is non-optional at the call site and a future @Public() on one of these
 * routes cannot quietly produce an `undefined.id`.
 */
function requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) {
    throw new UnauthorizedException();
  }
  return user;
}

/** A malformed id is a bad request, not a database round trip. */
function requireUuid(id: string): string {
  const result = uuidSchema.safeParse(id);

  if (!result.success) {
    throw new DomainError('VALIDATION_FAILED', {
      message: 'Address id must be a UUID',
      details: { id: ['Must be a UUID'] },
    });
  }

  return result.data;
}
