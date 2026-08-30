import { UnauthorizedException } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { DomainError } from '../../common/errors/domain-error';
import { NO_CAPABILITIES } from '../../common/types';
import type { AuthenticatedUser } from '../../common/types';
import type { NotificationsService, Notification } from './notifications.service';

const NOTIFICATION_ID = '11111111-1111-4111-8111-111111111111';

const NOTIFICATION: Notification = {
  id: NOTIFICATION_ID,
  eventType: 'OrderPickedUp',
  title: 'OrderPickedUp',
  body: null,
  deepLink: null,
  orderId: 'order-1',
  read: false,
  createdAt: '2026-08-30T10:00:00Z',
};

const user: AuthenticatedUser = {
  id: 'u1',
  phone: '+66812345678',
  capabilities: { ...NO_CAPABILITIES, customer: true },
};

function controllerWith() {
  const service = {
    list: jest.fn().mockResolvedValue([NOTIFICATION]),
    markRead: jest.fn().mockResolvedValue({ ...NOTIFICATION, read: true }),
  };
  return {
    controller: new NotificationsController(service as unknown as NotificationsService),
    service,
  };
}

describe('NotificationsController — authentication', () => {
  it.each([
    ['list', (c: NotificationsController) => c.list(undefined)],
    ['markRead', (c: NotificationsController) => c.markRead(undefined, NOTIFICATION_ID)],
  ])('rejects an unauthenticated %s', async (_label, run) => {
    const { controller } = controllerWith();
    await expect(run(controller)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('passes the authenticated id through on list', async () => {
    const { controller, service } = controllerWith();
    await controller.list({ ...user, id: 'u-verified' });
    expect(service.list).toHaveBeenCalledWith('u-verified');
  });

  it('passes the authenticated id through on markRead', async () => {
    const { controller, service } = controllerWith();
    await controller.markRead({ ...user, id: 'u-verified' }, NOTIFICATION_ID);
    expect(service.markRead).toHaveBeenCalledWith('u-verified', NOTIFICATION_ID);
  });
});

describe('NotificationsController — read path', () => {
  it("lists the caller's notifications", async () => {
    const { controller, service } = controllerWith();
    await expect(controller.list(user)).resolves.toEqual([NOTIFICATION]);
    expect(service.list).toHaveBeenCalledWith('u1');
  });

  it('marks a notification read', async () => {
    const { controller, service } = controllerWith();
    await expect(controller.markRead(user, NOTIFICATION_ID)).resolves.toEqual({
      ...NOTIFICATION,
      read: true,
    });
    expect(service.markRead).toHaveBeenCalledWith('u1', NOTIFICATION_ID);
  });

  it('rejects a malformed id on markRead before touching the database', async () => {
    const { controller, service } = controllerWith();
    await expect(controller.markRead(user, 'not-a-uuid')).rejects.toBeInstanceOf(DomainError);
    expect(service.markRead).not.toHaveBeenCalled();
  });

  it('propagates a NOT_FOUND from the service unchanged — a foreign or nonexistent notification', async () => {
    const { controller, service } = controllerWith();
    service.markRead.mockRejectedValue(new DomainError('NOT_FOUND'));
    await expect(controller.markRead(user, NOTIFICATION_ID)).rejects.toBeInstanceOf(DomainError);
  });
});
