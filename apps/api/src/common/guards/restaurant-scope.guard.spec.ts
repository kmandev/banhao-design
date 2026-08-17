import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RestaurantScopeGuard } from './restaurant-scope.guard';
import { DomainError } from '../errors/domain-error';
import { NO_CAPABILITIES } from '../types';
import type { ActorCapabilities, AuthenticatedUser } from '../types';

const REST_A = '11111111-1111-4111-8111-111111111111';
const REST_B = '22222222-2222-4222-8222-222222222222';

function actor(capabilities: Partial<ActorCapabilities>): AuthenticatedUser {
  return {
    id: 'u1',
    phone: null,
    capabilities: { ...NO_CAPABILITIES, customer: true, ...capabilities },
  };
}

const merchantOfA = actor({ merchant: [{ restaurantId: REST_A, memberRole: 'OWNER' }] });
const customer = actor({});
const rider = actor({ rider: { riderId: 'rider-1' } });
const admin = actor({ platformStaff: { staffRole: 'ADMIN' } });

function contextWith(
  user: AuthenticatedUser | undefined,
  params: Record<string, string | undefined>,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, params }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function guardScoped(scope: { param?: string } | undefined): RestaurantScopeGuard {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(scope),
  } as unknown as Reflector;
  return new RestaurantScopeGuard(reflector);
}

/** The catalogue code is the contract; asserting the class alone would miss it. */
function expectNotMember(run: () => unknown): void {
  try {
    run();
    fail('expected a NOT_RESTAURANT_MEMBER DomainError');
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('NOT_RESTAURANT_MEMBER');
  }
}

describe('RestaurantScopeGuard', () => {
  it('ignores routes that are not restaurant-scoped', () => {
    const guard = guardScoped(undefined);
    expect(guard.canActivate(contextWith(customer, {}))).toBe(true);
  });

  // --- the core requirement: merchant scope is per restaurant ----------------

  it('allows a merchant acting on a restaurant they are an active member of', () => {
    const guard = guardScoped({ param: 'restaurantId' });
    expect(guard.canActivate(contextWith(merchantOfA, { restaurantId: REST_A }))).toBe(true);
  });

  it('DENIES a merchant acting on a restaurant they do not belong to', () => {
    const guard = guardScoped({ param: 'restaurantId' });
    expectNotMember(() => guard.canActivate(contextWith(merchantOfA, { restaurantId: REST_B })));
  });

  it('denies a merchant whose membership was revoked', () => {
    // A revoked row never reaches the guard: CapabilitiesService filters on
    // `revoked_at is null`, so revocation presents here as an empty membership
    // list rather than a flag to inspect.
    const revoked = actor({ merchant: [] });
    const guard = guardScoped({ param: 'restaurantId' });
    expectNotMember(() => guard.canActivate(contextWith(revoked, { restaurantId: REST_A })));
  });

  it('denies a customer with no merchant capability', () => {
    const guard = guardScoped({ param: 'restaurantId' });
    expectNotMember(() => guard.canActivate(contextWith(customer, { restaurantId: REST_A })));
  });

  it('denies a rider', () => {
    const guard = guardScoped({ param: 'restaurantId' });
    expectNotMember(() => guard.canActivate(contextWith(rider, { restaurantId: REST_A })));
  });

  it('denies platform staff — no silent admin bypass lives in this guard', () => {
    const guard = guardScoped({ param: 'restaurantId' });
    expectNotMember(() => guard.canActivate(contextWith(admin, { restaurantId: REST_A })));
  });

  // --- fail-closed edges -----------------------------------------------------

  it('rejects an unauthenticated principal', () => {
    const guard = guardScoped({ param: 'restaurantId' });
    expectNotMember(() => guard.canActivate(contextWith(undefined, { restaurantId: REST_A })));
  });

  it('fails closed when the principal carries no capability context', () => {
    const malformed = { id: 'u1', phone: null } as unknown as AuthenticatedUser;
    const guard = guardScoped({ param: 'restaurantId' });
    expectNotMember(() => guard.canActivate(contextWith(malformed, { restaurantId: REST_A })));
  });

  it('fails closed when the scoped route parameter is absent', () => {
    // Otherwise an unidentified restaurant would be authorized by default.
    const guard = guardScoped({ param: 'restaurantId' });
    expectNotMember(() => guard.canActivate(contextWith(merchantOfA, {})));
  });

  it('honours a custom parameter name', () => {
    const guard = guardScoped({ param: 'shopId' });
    expect(guard.canActivate(contextWith(merchantOfA, { shopId: REST_A }))).toBe(true);
    expectNotMember(() => guard.canActivate(contextWith(merchantOfA, { shopId: REST_B })));
  });

  it('reads scope from the path only — a body cannot redirect the check', () => {
    // The request carries a body naming a restaurant the actor DOES belong to,
    // while the path names one they do not. The path must win.
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: merchantOfA,
          params: { restaurantId: REST_B },
          body: { restaurantId: REST_A },
          query: { restaurantId: REST_A },
        }),
      }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;

    expectNotMember(() => guardScoped({ param: 'restaurantId' }).canActivate(context));
  });

  it('scopes each membership independently when the actor has several', () => {
    const multi = actor({
      merchant: [
        { restaurantId: REST_A, memberRole: 'OWNER' },
        { restaurantId: REST_B, memberRole: 'STAFF' },
      ],
    });
    const guard = guardScoped({ param: 'restaurantId' });

    expect(guard.canActivate(contextWith(multi, { restaurantId: REST_A }))).toBe(true);
    expect(guard.canActivate(contextWith(multi, { restaurantId: REST_B }))).toBe(true);
    expectNotMember(() =>
      guard.canActivate(contextWith(multi, { restaurantId: '33333333-3333-4333-8333-333333333333' })),
    );
  });
});
