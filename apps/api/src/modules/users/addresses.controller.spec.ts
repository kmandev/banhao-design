import { UnauthorizedException } from '@nestjs/common';
import { AddressesController } from './addresses.controller';
import { DomainError } from '../../common/errors/domain-error';
import { NO_CAPABILITIES } from '../../common/types';
import type { AuthenticatedUser } from '../../common/types';
import type { AddressesService, Address } from './addresses.service';

const ADDRESS_ID = '11111111-1111-4111-8111-111111111111';

const ADDRESS: Address = {
  id: ADDRESS_ID,
  label: 'บ้าน',
  recipientName: 'นก',
  recipientPhone: '+66812345678',
  addressLine: '88 หมู่ 4 ต.บุณฑริก',
  landmark: 'ตรงข้ามร้านขายยา',
  instructions: null,
  lat: 14.78,
  lng: 105.42,
  isDefault: true,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

const user: AuthenticatedUser = {
  id: 'u1',
  phone: '+66812345678',
  capabilities: { ...NO_CAPABILITIES, customer: true },
};

const VALID_BODY = {
  recipientName: 'นก',
  recipientPhone: '+66812345678',
  addressLine: '88 หมู่ 4 ต.บุณฑริก',
};

function controllerWith() {
  const service = {
    list: jest.fn().mockResolvedValue([ADDRESS]),
    create: jest.fn().mockResolvedValue(ADDRESS),
    update: jest.fn().mockResolvedValue(ADDRESS),
    archive: jest.fn().mockResolvedValue(undefined),
  };
  return { controller: new AddressesController(service as unknown as AddressesService), service };
}

describe('AddressesController — authentication', () => {
  it.each([
    ['list', (c: AddressesController) => c.list(undefined)],
    ['create', (c: AddressesController) => c.create(undefined, VALID_BODY)],
    ['update', (c: AddressesController) => c.update(undefined, ADDRESS_ID, { label: 'x' })],
    ['remove', (c: AddressesController) => c.remove(undefined, ADDRESS_ID)],
  ])('rejects an unauthenticated %s', async (_label, run) => {
    const { controller } = controllerWith();
    await expect(run(controller)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each([
    ['list', (c: AddressesController) => c.list({ ...user, id: 'u-verified' })],
    ['create', (c: AddressesController) => c.create({ ...user, id: 'u-verified' }, VALID_BODY)],
  ])('passes the authenticated id through on %s', async (_label, run) => {
    const { controller, service } = controllerWith();
    await run(controller);
    const called = service.list.mock.calls[0] ?? service.create.mock.calls[0];
    expect(called?.[0]).toBe('u-verified');
  });
});

describe('AddressesController — CRUD', () => {
  it('lists the caller’s addresses', async () => {
    const { controller, service } = controllerWith();
    await expect(controller.list(user)).resolves.toEqual([ADDRESS]);
    expect(service.list).toHaveBeenCalledWith('u1');
  });

  it('creates an address', async () => {
    const { controller, service } = controllerWith();
    await expect(controller.create(user, VALID_BODY)).resolves.toEqual(ADDRESS);
    expect(service.create).toHaveBeenCalledWith('u1', expect.objectContaining(VALID_BODY));
  });

  it('creates an address with the optional Thai-addressing fields', async () => {
    const { controller, service } = controllerWith();
    await controller.create(user, {
      ...VALID_BODY,
      label: 'บ้าน',
      landmark: 'ตรงข้ามร้านขายยา',
      instructions: 'โทรก่อนถึง',
      lat: 14.78,
      lng: 105.42,
      isDefault: true,
    });
    expect(service.create).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ landmark: 'ตรงข้ามร้านขายยา', lat: 14.78, lng: 105.42 }),
    );
  });

  it('updates an address', async () => {
    const { controller, service } = controllerWith();
    await expect(controller.update(user, ADDRESS_ID, { label: 'ที่ทำงาน' })).resolves.toEqual(
      ADDRESS,
    );
    expect(service.update).toHaveBeenCalledWith('u1', ADDRESS_ID, { label: 'ที่ทำงาน' });
  });

  it('archives an address', async () => {
    const { controller, service } = controllerWith();
    await expect(controller.remove(user, ADDRESS_ID)).resolves.toBeUndefined();
    expect(service.archive).toHaveBeenCalledWith('u1', ADDRESS_ID);
  });
});

describe('AddressesController — validation', () => {
  it.each([
    ['missing recipientName', { recipientPhone: '+66812345678', addressLine: 'x' }],
    ['missing addressLine', { recipientName: 'นก', recipientPhone: '+66812345678' }],
    ['non-Thai phone', { ...VALID_BODY, recipientPhone: '0812345678' }],
    ['empty addressLine', { ...VALID_BODY, addressLine: '' }],
    ['lat without lng', { ...VALID_BODY, lat: 14.78 }],
    ['lng without lat', { ...VALID_BODY, lng: 105.42 }],
    ['out-of-range lat', { ...VALID_BODY, lat: 200, lng: 105.42 }],
    ['unknown field', { ...VALID_BODY, userId: 'someone-else' }],
    ['archived_at injection', { ...VALID_BODY, archivedAt: null }],
    ['not an object', 'nope'],
  ])('rejects create — %s', async (_label, body) => {
    const { controller, service } = controllerWith();
    await expect(controller.create(user, body)).rejects.toBeInstanceOf(DomainError);
    expect(service.create).not.toHaveBeenCalled();
  });

  it.each([
    ['empty patch', {}],
    ['unknown field', { userId: 'someone-else' }],
    ['zone_id injection', { zoneId: 'z1' }],
    ['archived_at injection', { archivedAt: null }],
    ['lat without lng', { lat: 14.78 }],
    ['invalid phone', { recipientPhone: 'abc' }],
  ])('rejects update — %s', async (_label, body) => {
    const { controller, service } = controllerWith();
    await expect(controller.update(user, ADDRESS_ID, body)).rejects.toBeInstanceOf(DomainError);
    expect(service.update).not.toHaveBeenCalled();
  });

  it.each([
    ['update', (c: AddressesController) => c.update(user, 'not-a-uuid', { label: 'x' })],
    ['remove', (c: AddressesController) => c.remove(user, 'not-a-uuid')],
  ])('rejects a malformed id on %s before touching the database', async (_label, run) => {
    const { controller, service } = controllerWith();
    await expect(run(controller)).rejects.toBeInstanceOf(DomainError);
    expect(service.update).not.toHaveBeenCalled();
    expect(service.archive).not.toHaveBeenCalled();
  });

  it('reports validation failures with the catalogue code and field details', async () => {
    const { controller } = controllerWith();
    try {
      await controller.create(user, { ...VALID_BODY, recipientPhone: 'nope' });
      fail('expected DomainError');
    } catch (error) {
      const domain = error as DomainError;
      expect(domain.code).toBe('VALIDATION_FAILED');
      expect(domain.details).toHaveProperty('recipientPhone');
    }
  });

  it('propagates a NOT_FOUND from the service unchanged', async () => {
    const { controller, service } = controllerWith();
    service.update.mockRejectedValue(new DomainError('NOT_FOUND'));
    await expect(controller.update(user, ADDRESS_ID, { label: 'x' })).rejects.toBeInstanceOf(
      DomainError,
    );
  });
});
