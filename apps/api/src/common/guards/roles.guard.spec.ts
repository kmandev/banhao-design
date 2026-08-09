import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@banhao/types';
import { RolesGuard } from './roles.guard';
import type { AuthenticatedUser } from '../types';

function contextWithUser(user: AuthenticatedUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function guardRequiring(roles: Role[] | undefined): RolesGuard {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(roles) } as unknown as Reflector;
  return new RolesGuard(reflector);
}

const customer: AuthenticatedUser = { id: 'u1', role: 'CUSTOMER', phone: null };
const admin: AuthenticatedUser = { id: 'u2', role: 'ADMIN', phone: null };

describe('RolesGuard', () => {
  it('allows any authenticated user when no roles are required', () => {
    expect(guardRequiring(undefined).canActivate(contextWithUser(customer))).toBe(true);
  });

  it('allows a user whose role is in the required list', () => {
    expect(guardRequiring(['ADMIN']).canActivate(contextWithUser(admin))).toBe(true);
  });

  it('rejects a user whose role is not in the required list', () => {
    expect(() => guardRequiring(['ADMIN']).canActivate(contextWithUser(customer))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects when no user is attached, rather than failing open', () => {
    expect(() => guardRequiring(['ADMIN']).canActivate(contextWithUser(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('allows when the user matches one of several permitted roles', () => {
    const guard = guardRequiring(['MERCHANT', 'ADMIN']);
    expect(guard.canActivate(contextWithUser(admin))).toBe(true);
  });

  it('does not leak which role was required in the error message', () => {
    try {
      guardRequiring(['ADMIN']).canActivate(contextWithUser(customer));
      fail('expected ForbiddenException');
    } catch (error) {
      expect((error as Error).message).toBe('Insufficient permissions');
      expect((error as Error).message).not.toContain('ADMIN');
    }
  });
});
