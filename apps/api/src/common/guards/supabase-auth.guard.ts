import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SupabaseService } from '../../supabase/supabase.service';
import { UsersService } from '../../modules/users/users.service';
import type { AuthenticatedUser } from '../types';

/**
 * Verifies the Supabase-issued JWT on every request and attaches the resulting
 * user to `request.user`.
 *
 * Registered globally, so routes are authenticated by default and must opt out
 * with @Public(). The role is read from the database profile row — never from a
 * client-supplied header or JWT claim the client could influence.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly logger = new Logger(SupabaseAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly supabase: SupabaseService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: AuthenticatedUser;
    }>();

    const token = this.extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const claims = await this.supabase.verifyAccessToken(token);
    if (!claims) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const profile = await this.users.findById(claims.sub);
    if (!profile) {
      // Authenticated with Supabase but no application profile row exists yet.
      // Treated as unauthorized rather than auto-provisioning, so role
      // assignment stays an explicit, auditable server-side action.
      this.logger.warn(`No profile for authenticated user ${claims.sub}`);
      throw new UnauthorizedException('User profile not found');
    }

    request.user = {
      id: profile.id,
      role: profile.role,
      phone: profile.phone,
    };

    return true;
  }

  private extractBearerToken(header: string | undefined): string | null {
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
    return value;
  }
}
