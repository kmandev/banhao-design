import { Body, Controller, Delete, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { registerPushTokenSchema, revokePushTokenSchema } from '@banhao/validation';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { parseOrThrow } from '../../common/validation/parse';
import type { AuthenticatedUser } from '../../common/types';
import { PushTokensService } from './push-tokens.service';

/**
 * LAUNCH_PLAN 1.1 — a signed-in app registers its device for push, and
 * revokes it on sign-out. Any signed-in user (customer or rider app); the
 * token is always filed under the verified caller, never a client-supplied id.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('api/v1/me/push-tokens')
export class PushTokensController {
  constructor(private readonly tokens: PushTokensService) {}

  @Post()
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Registered (or moved to this user)' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async register(@CurrentUser() user: AuthenticatedUser | undefined, @Body() body: unknown): Promise<void> {
    await this.tokens.register(requireUser(user).id, parseOrThrow(registerPushTokenSchema, body));
  }

  @Delete()
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Revoked, if it was this user\'s' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async revoke(@CurrentUser() user: AuthenticatedUser | undefined, @Body() body: unknown): Promise<void> {
    await this.tokens.revoke(requireUser(user).id, parseOrThrow(revokePushTokenSchema, body).token);
  }
}

function requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) throw new UnauthorizedException();
  return user;
}
