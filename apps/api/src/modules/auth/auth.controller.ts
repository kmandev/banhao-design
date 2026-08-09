import { Controller, Get, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { MeResponse } from '@banhao/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
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
    };
  }
}
