import { Body, Controller, Get, Patch, UnauthorizedException } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { MeResponse } from '@banhao/types';
import { updateProfileSchema } from '@banhao/validation';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { parseOrThrow } from '../../common/validation/parse';
import type { AuthenticatedUser } from '../../common/types';
import { UsersService } from '../users/users.service';

@ApiTags('auth')
@ApiBearerAuth()
@Controller('api/v1')
export class AuthController {
  constructor(private readonly users: UsersService) {}

  /**
   * Returns the authenticated user. The role comes from the database profile,
   * so a client cannot influence what it is told it is.
   */
  @Get('me')
  @ApiOkResponse({ description: 'The authenticated user' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async me(@CurrentUser() user: AuthenticatedUser | undefined): Promise<MeResponse> {
    if (!user) {
      throw new UnauthorizedException();
    }

    const profile = await this.users.findById(user.id);
    if (!profile) {
      throw new UnauthorizedException('User profile not found');
    }

    return {
      id: profile.id,
      role: profile.role,
      phone: profile.phone,
      displayName: profile.displayName,
      email: profile.email,
    };
  }

  /**
   * Updates the caller's own profile.
   *
   * The schema accepts exactly two fields, `displayName` and `email`
   * (DEC-056), and nothing else is writable here — not role, not phone, not
   * capability, not membership. That is enforced three times over:
   * `updateProfileSchema` has no other field, `UsersService` writes only the
   * one column each method names, and the database grants `authenticated`
   * update on `display_name`/`email` alone. A caller who sends
   * `{ role: 'ADMIN' }` changes nothing and is told the request was invalid.
   *
   * The row is chosen by the verified JWT subject, never by a body field, so
   * there is no cross-user write to defend against.
   *
   * Each field is written independently when present — a request naming only
   * `email` never touches `display_name`, and vice versa. When both are
   * present this is two sequential guarded writes rather than one, which is
   * an accepted trade-off for a low-frequency profile edit (see DEC-056:
   * `PaymentsService` is the actual authoritative *read* path for payment
   * purposes, so nothing about payment correctness depends on this being a
   * single statement).
   */
  @Patch('me')
  @ApiOkResponse({ description: 'The updated profile' })
  @ApiBadRequestResponse({ description: 'Invalid request body' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async updateMe(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() body: unknown,
  ): Promise<MeResponse> {
    if (!user) {
      throw new UnauthorizedException();
    }

    const input = parseOrThrow(updateProfileSchema, body);

    let profile: UserProfileResult = null;

    if (input.displayName !== undefined) {
      profile = await this.users.updateDisplayName(user.id, input.displayName);
      if (!profile) {
        throw new UnauthorizedException('User profile not found');
      }
    }

    if (input.email !== undefined) {
      profile = await this.users.updateEmail(user.id, input.email);
      if (!profile) {
        throw new UnauthorizedException('User profile not found');
      }
    }

    // Nothing to write. Return current state rather than issuing an empty
    // UPDATE, which would bump `updated_at` for no reason.
    if (!profile) {
      return this.me(user);
    }

    return {
      id: profile.id,
      role: profile.role,
      phone: profile.phone,
      displayName: profile.displayName,
      email: profile.email,
    };
  }
}

type UserProfileResult = Awaited<ReturnType<UsersService['findById']>>;
