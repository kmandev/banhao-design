import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { UsersService } from '../../modules/users/users.service';

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

function buildGuard(options: {
  isPublic?: boolean;
  claims?: { sub: string } | null;
  profileResult?: typeof profile | null;
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

  return { guard: new SupabaseAuthGuard(reflector, supabase, users), supabase, users };
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

  it('attaches the database-backed user on success', async () => {
    const { guard } = buildGuard({ claims: { sub: 'user-1' }, profileResult: profile });
    const request: MockRequest = { headers: { authorization: 'Bearer good-token' } };

    await expect(guard.canActivate(contextWith(request))).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'user-1', role: 'CUSTOMER', phone: '+66812345678' });
  });

  it('takes the role from the database, not from the token claims', async () => {
    // A token claiming ADMIN must not produce an ADMIN principal — the profile wins.
    const { guard } = buildGuard({
      claims: { sub: 'user-1', role: 'ADMIN' } as { sub: string },
      profileResult: profile,
    });
    const request: MockRequest = { headers: { authorization: 'Bearer spoofed' } };

    await guard.canActivate(contextWith(request));

    expect((request.user as { role: string }).role).toBe('CUSTOMER');
  });
});
