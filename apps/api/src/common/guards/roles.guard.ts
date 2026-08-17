import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { hasCapability } from '../types';
import type { AuthenticatedUser, Capability } from '../types';

/**
 * Enforces @Roles(...) on the server as a **capability** check.
 *
 * Runs after SupabaseAuthGuard, so `request.user.capabilities` is the
 * database-backed membership resolved for this request (DEC-033 / DEC-APP-004),
 * not `profiles.role` and not anything the client asserted.
 *
 * **Scope is deliberately not checked here.** This guard answers "is this actor
 * a merchant at all?", never "may this actor act on restaurant X?" — membership
 * is per-restaurant, and that question belongs to resource-level authorization,
 * a separate Phase B task. The scope needed to answer it is carried on
 * `capabilities.merchant`; use `hasMerchantAccess()` from `../types` there.
 * Answering it silently inside this guard would hide where authorization
 * actually happens.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Capability[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles decorator means any authenticated user may proceed.
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Insufficient permissions');
    }

    // Fail closed on a principal with no capability context at all, rather than
    // letting a malformed `request.user` reach the `some` check below.
    if (!user.capabilities) {
      throw new ForbiddenException('Insufficient permissions');
    }

    if (!required.some((capability) => hasCapability(user.capabilities, capability))) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
