import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  RESTAURANT_SCOPE_KEY,
  type RestaurantScopeOptions,
} from '../decorators/restaurant-scope.decorator';
import { DomainError } from '../errors/domain-error';
import { hasCapability, hasMerchantAccess } from '../types';
import type { AuthenticatedUser } from '../types';

/**
 * Enforces `@RestaurantScope()` — that the caller is an active member of the
 * *specific* restaurant named in the route.
 *
 * This is the second half of merchant authorization and the reason
 * `@Roles('MERCHANT')` is not sufficient on its own. `RolesGuard` answers "is
 * this actor a merchant at all?"; this guard answers "may this actor act on
 * restaurant X?". Both questions have to be asked, in that order, because
 * membership in DEC-033 is per-restaurant: an OWNER of one shop is a stranger
 * to every other.
 *
 * Every input is server-derived. The identity comes from the verified JWT via
 * `SupabaseAuthGuard`; the capabilities come from a database read on this
 * request; the restaurant id comes from the route path. Nothing the client
 * *asserts* participates in the decision.
 *
 * **Platform staff are not given a bypass here.** An operator acting on a shop
 * they do not belong to is a real Phase I need, but silently folding it into a
 * merchant guard would hide a privileged path inside an unprivileged one.
 * Admin routes declare `@Roles('ADMIN')` and are audited on their own terms.
 */
@Injectable()
export class RestaurantScopeGuard implements CanActivate {
  private readonly logger = new Logger(RestaurantScopeGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const scope = this.reflector.getAllAndOverride<RestaurantScopeOptions | undefined>(
      RESTAURANT_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Not a restaurant-scoped route — nothing for this guard to say.
    if (!scope) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
      params?: Record<string, string | undefined>;
    }>();

    const user = request.user;

    // Fails closed on an unauthenticated or malformed principal. Reaching here
    // without a user means the auth guard did not run, which is a wiring bug —
    // deny rather than assume it was intentional.
    if (!user?.capabilities) {
      throw new DomainError('NOT_RESTAURANT_MEMBER');
    }

    const paramName = scope.param ?? 'restaurantId';
    const restaurantId = request.params?.[paramName];

    // A scoped route whose parameter is missing cannot be authorized at all.
    // Denying is the only safe reading: the alternative is granting access to
    // an unidentified restaurant.
    if (!restaurantId) {
      this.logger.error(
        `@RestaurantScope route is missing route parameter "${paramName}"; denying`,
      );
      throw new DomainError('NOT_RESTAURANT_MEMBER');
    }

    // Checked explicitly rather than relying on `hasMerchantAccess` alone, so
    // the capability requirement holds even if a route forgets @Roles.
    if (!hasCapability(user.capabilities, 'MERCHANT')) {
      throw new DomainError('NOT_RESTAURANT_MEMBER');
    }

    // Revoked memberships never reach this point: CapabilitiesService filters
    // on `revoked_at is null`, so a revoked row is absent from `merchant`
    // rather than present-and-ignored. Revocation therefore takes effect on the
    // next request, not on the next token.
    if (!hasMerchantAccess(user.capabilities, restaurantId)) {
      throw new DomainError('NOT_RESTAURANT_MEMBER');
    }

    return true;
  }
}
