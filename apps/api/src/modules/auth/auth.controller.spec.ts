import { UnauthorizedException } from '@nestjs/common';
import type { UserProfile } from '@banhao/types';
import { AuthController } from './auth.controller';
import { DomainError } from '../../common/errors/domain-error';
import { NO_CAPABILITIES } from '../../common/types';
import type { AuthenticatedUser } from '../../common/types';
import type { UsersService } from '../users/users.service';

const PROFILE: UserProfile = {
  id: 'u1',
  role: 'CUSTOMER',
  phone: '+66812345678',
  displayName: 'นก',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

const user: AuthenticatedUser = {
  id: 'u1',
  phone: '+66812345678',
  capabilities: { ...NO_CAPABILITIES, customer: true },
};

function controllerWith(overrides: Partial<UsersService> = {}) {
  const findById = jest.fn().mockResolvedValue(PROFILE);
  const updateDisplayName = jest.fn().mockResolvedValue({ ...PROFILE, displayName: 'นกใหม่' });

  const users = { findById, updateDisplayName, ...overrides } as unknown as UsersService;
  return { controller: new AuthController(users), findById, updateDisplayName };
}

describe('AuthController — GET /me', () => {
  it('returns the profile for an authenticated user', async () => {
    const { controller } = controllerWith();
    await expect(controller.me(user)).resolves.toEqual({
      id: 'u1',
      role: 'CUSTOMER',
      phone: '+66812345678',
      displayName: 'นก',
    });
  });

  it('reads the profile by the authenticated id, not by anything in the request', async () => {
    const { controller, findById } = controllerWith();
    await controller.me({ ...user, id: 'u-verified' });
    expect(findById).toHaveBeenCalledWith('u-verified');
  });

  it('rejects an unauthenticated request', async () => {
    const { controller } = controllerWith();
    await expect(controller.me(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when the profile has disappeared', async () => {
    const { controller } = controllerWith({
      findById: jest.fn().mockResolvedValue(null),
    } as Partial<UsersService>);
    await expect(controller.me(user)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not expose resolved capabilities in the response body', async () => {
    // DEC-APP-004 does not require it, and shipping the authorization model to
    // the client invites the client to reason about it.
    const { controller } = controllerWith();
    const result = await controller.me(user);
    expect(result).not.toHaveProperty('capabilities');
  });

  it('reports the database role, never a spoofable JWT claim', async () => {
    const { controller } = controllerWith({
      findById: jest.fn().mockResolvedValue({ ...PROFILE, role: 'CUSTOMER' }),
    } as Partial<UsersService>);

    // A principal whose capabilities were somehow inflated still reports the
    // profile's own role, because the response is built from the database row.
    const inflated: AuthenticatedUser = {
      ...user,
      capabilities: { ...NO_CAPABILITIES, customer: true, platformStaff: { staffRole: 'ADMIN' } },
    };

    await expect(controller.me(inflated)).resolves.toMatchObject({ role: 'CUSTOMER' });
  });
});

describe('AuthController — PATCH /me', () => {
  it('updates the display name', async () => {
    const { controller, updateDisplayName } = controllerWith();
    await expect(controller.updateMe(user, { displayName: 'นกใหม่' })).resolves.toMatchObject({
      displayName: 'นกใหม่',
    });
    expect(updateDisplayName).toHaveBeenCalledWith('u1', 'นกใหม่');
  });

  it('targets the authenticated id, never one supplied in the body', async () => {
    const { controller, updateDisplayName } = controllerWith();
    await controller.updateMe({ ...user, id: 'u-verified' }, { displayName: 'ok' });
    expect(updateDisplayName).toHaveBeenCalledWith('u-verified', 'ok');
  });

  it('rejects a body that also names another user, rather than stripping it', async () => {
    const { controller, updateDisplayName } = controllerWith();
    await expect(
      controller.updateMe(user, { displayName: 'ok', id: 'someone-else' }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(updateDisplayName).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request', async () => {
    const { controller } = controllerWith();
    await expect(controller.updateMe(undefined, { displayName: 'x' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it.each([
    ['role', { role: 'ADMIN' }],
    ['capabilities', { capabilities: { platformStaff: { staffRole: 'ADMIN' } } }],
    ['phone', { phone: '+66899999999' }],
    ['id', { id: 'another-user' }],
    ['restaurant membership', { restaurantId: 'r1', memberRole: 'OWNER' }],
    ['rider approval', { riderStatus: 'APPROVED' }],
    ['platform staff', { staffRole: 'ADMIN' }],
  ])('refuses an authorization-field injection attempt via %s', async (_label, body) => {
    const { controller, updateDisplayName } = controllerWith();

    await expect(controller.updateMe(user, body)).rejects.toBeInstanceOf(DomainError);
    // The decisive assertion: nothing was written at all.
    expect(updateDisplayName).not.toHaveBeenCalled();
  });

  it('reports injection attempts as VALIDATION_FAILED rather than silently ignoring them', async () => {
    const { controller } = controllerWith();
    try {
      await controller.updateMe(user, { role: 'ADMIN' });
      fail('expected DomainError');
    } catch (error) {
      expect((error as DomainError).code).toBe('VALIDATION_FAILED');
    }
  });

  it.each([
    ['empty display name', { displayName: '' }],
    ['non-string display name', { displayName: 42 }],
    ['over-long display name', { displayName: 'x'.repeat(81) }],
  ])('rejects invalid input — %s', async (_label, body) => {
    const { controller, updateDisplayName } = controllerWith();
    await expect(controller.updateMe(user, body)).rejects.toBeInstanceOf(DomainError);
    expect(updateDisplayName).not.toHaveBeenCalled();
  });

  it('makes no write when the body omits every updatable field', async () => {
    const { controller, updateDisplayName, findById } = controllerWith();
    await expect(controller.updateMe(user, {})).resolves.toMatchObject({ id: 'u1' });
    expect(updateDisplayName).not.toHaveBeenCalled();
    expect(findById).toHaveBeenCalled();
  });

  it('surfaces a persistence failure instead of reporting success', async () => {
    const { controller } = controllerWith({
      updateDisplayName: jest
        .fn()
        .mockRejectedValue(new DomainError('INTERNAL_ERROR', { message: 'db down' })),
    } as Partial<UsersService>);

    await expect(controller.updateMe(user, { displayName: 'x' })).rejects.toBeInstanceOf(
      DomainError,
    );
  });

  it('rejects when the row to update no longer exists', async () => {
    const { controller } = controllerWith({
      updateDisplayName: jest.fn().mockResolvedValue(null),
    } as Partial<UsersService>);

    await expect(controller.updateMe(user, { displayName: 'x' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
