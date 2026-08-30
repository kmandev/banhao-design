import { Controller, Get, Param, Patch, UnauthorizedException } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { uuidSchema } from '@banhao/validation';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';
import { NotificationsService, type Notification } from './notifications.service';

/**
 * H-5A — the caller's own in-app notifications (H-2/H-3's write side).
 *
 * Mounted under `me/`, same reasoning `AddressesController` gives for its own
 * routes: there is no route here that can name another user's notification,
 * so ownership is expressed in the URL shape and not only in code.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('api/v1/me/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOkResponse({ description: "The caller's own notifications, newest first" })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async list(@CurrentUser() user: AuthenticatedUser | undefined): Promise<Notification[]> {
    return this.notifications.list(requireUser(user).id);
  }

  @Patch(':id')
  @ApiOkResponse({ description: 'The notification, marked read' })
  @ApiNotFoundResponse({ description: 'No such notification for this user' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async markRead(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
  ): Promise<Notification> {
    return this.notifications.markRead(requireUser(user).id, requireUuid(id));
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
      message: 'Notification id must be a UUID',
      details: { id: ['Must be a UUID'] },
    });
  }

  return result.data;
}
