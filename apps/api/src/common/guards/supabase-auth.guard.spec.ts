import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import { NO_CAPABILITIES } from '../types';
import type { ActorCapabilities, AuthenticatedUser } from '../types';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { UsersService } from '../../modules/users/users.service';
import type { CapabilitiesService } from '../../modules/users/capabilities.service';

interface MockRequest {
  headers: Record<string, string | undefined>;
  user?: unknown;
}

function contextWith(request: MockRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

const profile = {
  id: 'user-1',
  role: 'CUSTOMER' as const,
  phone: '+66812345678',
  displayName: null,
  createdAt: '2026-08-09T00:00:00Z',
  updatedAt: '2026-08-09T00:00:00Z',
};

const customerOnly: ActorCapabilities = { ...NO_CAPABILITIES, customer: true };

function buildGuard(options: {
  isPublic?: boolean;
  claims?: { sub: string } | null;
  profileResult?: typeof profile | null;
  capabilities?: ActorCapabilities;
  capabilitiesError?: Error;
}) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(options.isPublic ?? false),
  } as unknown as Reflector;

  const supabase = {
    verifyAccessToken: jest.fn().mockResolvedValue(options.claims ?? null),
  } as unknown as SupabaseService;

  const users = {
    findById: jest.fn().mockResolvedValue(options.profileResult ?? null),
  } as unknown as UsersService;

  const capabilities = {
    resolve: options.capabilitiesError
      ? jest.fn().mockRejectedValue(options.capabilitiesError)
      : jest.fn().mockResolvedValue(options.capabilities ?? customerOnly),
  } as unknown as CapabilitiesService;

  return {
    guard: new SupabaseAuthGuard(reflector, supabase, users, capabilities),
    supabase,
    users,
    capabilities,
  };
}

describe('SupabaseAuthGuard', () => {
  it('allows a @Public() route without any token', async () => {
    const { guard, supabase } = buildGuard({ isPublic: true });
    const request: MockRequest = { headers: {} };

    await expect(guard.canActivate(contextWith(request))).resolves.toBe(true);
    expect(supabase.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rejects a protected route with no Authorization header', async () => {
    const { guard } = buildGuard({});

    await expect(guard.canActivate(contextWith({ headers: {} }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a non-bearer Authorization scheme', async () => {
    const { guard } = buildGuard({});
    const request: MockRequest = { headers: { authorization: 'Basic abc123' } };

    await expect(guard.canActivate(contextWith(request))).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token that fails verification', async () => {
    const { guard } = buildGuard({ claims: null });
    const request: MockRequest = { headers: { authorization: 'Bearer bad-token' } };

    await expect(guard.canActivate(contextWith(request))).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a verified token with no application profile, rather than auto-provisioning', async () => {
    const { guard } = buildGuard({ claims: { sub: 'user-1' }, profileResult: null });
    const request: MockRequest = { headers: { authorization: 'Bearer good-token' } };

    await expect(guard.canActivate(contextWith(request))).rejects.toThrow(UnauthorizedException);
  });

  it('attaches the database-backed user with resolved capabilities on success', async () => {
    const { guard } = buildGuard({ claims: { sub: 'user-1' }, profileResult: profile });
    const request: MockRequest = { headers: { authorization: 'Bearer good-token' } };

    await expect(guard.canActivate(contextWith(request))).resolves.toBe(true);
    expect(request.user).toEqual({
      id: 'user-1',
      phone: '+66812345678',
      capabilities: customerOnly,
    });
  });

  it('does not put the legacy profile role on the principal at all', async () => {
    const { guard } = buildGuard({ claims: { sub: 'user-1' }, profileResult: profile });
    const request: MockRequest = { headers: { authorization: 'Bearer good-token' } };

    await guard.canActivate(contextWith(request));

    // DEC-APP-004: profiles.role authorizes nothing and must not travel with
    // the request, or it will drift back into an authorization decision.
    expect(request.user).not.toHaveProperty('role');
  });

  it('resolves capabilities from the database, not from token claims', async () => {
    // A token claiming ADMIN must not produce a privileged principal — the
    // database membership is the only source, and here it grants nothing.
    const { guard, capabilities } = buildGuard({
      claims: { sub: 'user-1', role: 'ADMIN' } as { sub: string },
      profileResult: profile,
    });
    const request: MockRequest = { headers: { authorization: 'Bearer spoofed' } };

    await guard.canActivate(contextWith(request));

    expect(capabilities.resolve).toHaveBeenCalledWith('user-1');
    const user = request.user as AuthenticatedUser;
    expect(user.capabilities.platformStaff).toBeNull();
    expect(user.capabilities.merchant).toEqual([]);
    expect(user.capabilities.rider).toBeNull();
  });

  it('rejects the request when capabilities cannot be resolved, rather than proceeding', async () => {
    const { guard } = buildGuard({
      claims: { sub: 'user-1' },
      profileResult: profile,
      capabilitiesError: new Error('connection reset'),
    });
    const request: MockRequest = { headers: { authorization: 'Bearer good-token' } };

    await expect(guard.canActivate(contextWith(request))).rejects.toThrow(UnauthorizedException);
    expect(request.user).toBeUndefined();
  });
});
