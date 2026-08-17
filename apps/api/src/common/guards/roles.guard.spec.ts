import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { NO_CAPABILITIES } from '../types';
import type { ActorCapabilities, AuthenticatedUser, Capability } from '../types';

function contextWithUser(user: AuthenticatedUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function guardRequiring(capabilities: Capability[] | undefined): RolesGuard {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(capabilities),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

function actor(capabilities: Partial<ActorCapabilities>): AuthenticatedUser {
  return {
    id: 'u1',
    phone: null,
    capabilities: { ...NO_CAPABILITIES, customer: true, ...capabilities },
  };
}

const customer = actor({});
const merchant = actor({ merchant: [{ restaurantId: 'r1', memberRole: 'OWNER' }] });
const rider = actor({ rider: { riderId: 'rider-1' } });
const operator = actor({ platformStaff: { staffRole: 'OPERATOR' } });
const admin = actor({ platformStaff: { staffRole: 'ADMIN' } });

describe('RolesGuard', () => {
  it('allows any authenticated user when no capabilities are required', () => {
    expect(guardRequiring(undefined).canActivate(contextWithUser(customer))).toBe(true);
  });

  it('allows a user holding the required capability', () => {
    expect(guardRequiring(['ADMIN']).canActivate(contextWithUser(admin))).toBe(true);
  });

  it('rejects a user not holding the required capability', () => {
    expect(() => guardRequiring(['ADMIN']).canActivate(contextWithUser(customer))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects when no user is attached, rather than failing open', () => {
    expect(() => guardRequiring(['ADMIN']).canActivate(contextWithUser(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('allows when the user matches one of several permitted capabilities', () => {
    const guard = guardRequiring(['MERCHANT', 'ADMIN']);
    expect(guard.canActivate(contextWithUser(admin))).toBe(true);
  });

  it('does not leak which capability was required in the error message', () => {
    try {
      guardRequiring(['ADMIN']).canActivate(contextWithUser(customer));
      fail('expected ForbiddenException');
    } catch (error) {
      expect((error as Error).message).toBe('Insufficient permissions');
      expect((error as Error).message).not.toContain('ADMIN');
    }
  });

  // --- capability semantics (DEC-033 / DEC-APP-004) ---------------------------

  it('treats an active membership as the MERCHANT capability', () => {
    expect(guardRequiring(['MERCHANT']).canActivate(contextWithUser(merchant))).toBe(true);
  });

  it('denies MERCHANT to a customer with no membership', () => {
    expect(() => guardRequiring(['MERCHANT']).canActivate(contextWithUser(customer))).toThrow(
      ForbiddenException,
    );
  });

  it('treats an approved rider identity as the RIDER capability', () => {
    expect(guardRequiring(['RIDER']).canActivate(contextWithUser(rider))).toBe(true);
  });

  it('denies RIDER to a merchant', () => {
    expect(() => guardRequiring(['RIDER']).canActivate(contextWithUser(merchant))).toThrow(
      ForbiddenException,
    );
  });

  it('grants OPERATOR to an ADMIN, since admin is strictly broader', () => {
    expect(guardRequiring(['OPERATOR']).canActivate(contextWithUser(admin))).toBe(true);
  });

  it('does NOT grant ADMIN to a mere OPERATOR', () => {
    expect(() => guardRequiring(['ADMIN']).canActivate(contextWithUser(operator))).toThrow(
      ForbiddenException,
    );
  });

  it('fails closed when the principal carries no capability context at all', () => {
    const malformed = { id: 'u1', phone: null } as unknown as AuthenticatedUser;
    expect(() => guardRequiring(['CUSTOMER']).canActivate(contextWithUser(malformed))).toThrow(
      ForbiddenException,
    );
  });

  it('fails closed when every capability is absent', () => {
    const nobody: AuthenticatedUser = { id: 'u1', phone: null, capabilities: NO_CAPABILITIES };
    expect(() => guardRequiring(['CUSTOMER']).canActivate(contextWithUser(nobody))).toThrow(
      ForbiddenException,
    );
  });
});
