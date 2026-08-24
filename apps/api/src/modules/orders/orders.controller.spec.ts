import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  UnauthorizedException,
  type Provider,
} from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CorrelationModule } from '../../common/correlation/correlation.module';
import { CORRELATION_ID_HEADER } from '../../common/correlation/correlation';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../common/interceptors/response.interceptor';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { DomainError } from '../../common/errors/domain-error';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedUser } from '../../common/types';

/**
 * Phase E-2 — the HTTP boundary of `POST /api/v1/orders`.
 *
 * Same shape as `cart.controller.spec.ts`: `OrdersService` is a plain stub —
 * its own logic is `orders.service.spec.ts`'s job. This file proves the
 * wiring: an anonymous request never reaches the handler, the caller's own
 * verified id (never the body) is what the handler receives, a malformed
 * body is rejected before the service is called, and both success and every
 * domain error render through the real global filter/interceptor.
 */

const AUTHENTICATED_USER: AuthenticatedUser = {
  id: 'user-1',
  phone: '+66812345678',
  capabilities: { customer: true, merchant: [], rider: null, platformStaff: null },
};

const ADDRESS_ID = '11111111-1111-4111-8111-111111111111';

function fakeAuthGuard(user: AuthenticatedUser | null): CanActivate {
  @Injectable()
  class FakeAuthGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      if (!user) throw new UnauthorizedException();
      context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user = user;
      return true;
    }
  }
  return new FakeAuthGuard();
}

async function buildApp(options: {
  user: AuthenticatedUser | null;
  create?: jest.Mock;
  service?: Partial<Record<keyof OrdersService, jest.Mock>>;
  withRolesGuard?: boolean;
}): Promise<INestApplication> {
  const serviceStub = {
    create: options.create ?? jest.fn(),
    acceptOrder: jest.fn(),
    startPreparing: jest.fn(),
    markReady: jest.fn(),
    pickupOrder: jest.fn(),
    startDelivery: jest.fn(),
    completeDelivery: jest.fn(),
    cancelOrder: jest.fn(),
    ...options.service,
  };

  const guards: Provider[] = [{ provide: APP_GUARD, useValue: fakeAuthGuard(options.user) }];
  if (options.withRolesGuard) {
    guards.push({ provide: APP_GUARD, useClass: RolesGuard });
  }

  const moduleRef = await Test.createTestingModule({
    imports: [CorrelationModule],
    controllers: [OrdersController],
    providers: [
      { provide: OrdersService, useValue: serviceStub },
      ...guards,
      { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      Reflector,
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(0);
  return app;
}

describe('POST /api/v1/orders', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  it('rejects an unauthenticated request before it reaches the handler', async () => {
    const create = jest.fn();
    app = await buildApp({ user: null, create });

    const response = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .send({ addressId: ADDRESS_ID, paymentMethod: 'ONLINE' });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('passes the server-verified user id, never anything from the request body', async () => {
    const create = jest
      .fn()
      .mockResolvedValue({ orderId: 'order-1', orderNumber: 'BH-20260819-0001', state: 'CREATED' });
    app = await buildApp({ user: AUTHENTICATED_USER, create });

    // A client-supplied customerId in the body must have no effect — rejected
    // by strict schema validation before the service is even reachable.
    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .send({ addressId: ADDRESS_ID, paymentMethod: 'ONLINE', customerId: 'someone-else' })
      .expect(400);
    expect(create).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .send({ addressId: ADDRESS_ID, paymentMethod: 'ONLINE' })
      .expect(201);

    expect(create).toHaveBeenCalledWith('user-1', { addressId: ADDRESS_ID, paymentMethod: 'ONLINE' });
  });

  it('renders a successful creation, 201, in the shared envelope', async () => {
    const result = { orderId: 'order-1', orderNumber: 'BH-20260819-0001', state: 'CREATED' };
    app = await buildApp({ user: AUTHENTICATED_USER, create: jest.fn().mockResolvedValue(result) });

    const response = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .send({ addressId: ADDRESS_ID, paymentMethod: 'ONLINE' })
      .expect(201);

    expect(response.body).toEqual({ success: true, data: result });
  });

  it.each(['CART_EMPTY', 'ITEM_UNAVAILABLE', 'PRICE_CHANGED', 'MIXED_RESTAURANT', 'RESTAURANT_CLOSED'] as const)(
    'renders %s as a 409 through the real error envelope, with correlationId preserved',
    async (code) => {
      const create = jest.fn().mockRejectedValue(new DomainError(code));
      app = await buildApp({ user: AUTHENTICATED_USER, create });

      const response = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .set(CORRELATION_ID_HEADER, `order-${code}`)
        .send({ addressId: ADDRESS_ID, paymentMethod: 'ONLINE' })
        .expect(409);

      expect(response.body).toMatchObject({
        success: false,
        error: { code, correlationId: `order-${code}` },
      });
    },
  );

  it('renders NOT_FOUND (unowned/archived address) as 404', async () => {
    const create = jest.fn().mockRejectedValue(new DomainError('NOT_FOUND', { message: 'Address not found' }));
    app = await buildApp({ user: AUTHENTICATED_USER, create });

    const response = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .send({ addressId: ADDRESS_ID, paymentMethod: 'ONLINE' })
      .expect(404);

    expect(response.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('renders NOT_IMPLEMENTED as 501 through the real error envelope — generic catalogue mapping, not currently reachable via the fee gate', async () => {
    const create = jest.fn().mockRejectedValue(new DomainError('NOT_IMPLEMENTED'));
    app = await buildApp({ user: AUTHENTICATED_USER, create });

    const response = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .send({ addressId: ADDRESS_ID, paymentMethod: 'ONLINE' })
      .expect(501);

    expect(response.body).toMatchObject({ success: false, error: { code: 'NOT_IMPLEMENTED' } });
  });

  it('rejects a malformed body with VALIDATION_FAILED before the service is called', async () => {
    const create = jest.fn();
    app = await buildApp({ user: AUTHENTICATED_USER, create });

    const response = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .send({ addressId: 'not-a-uuid', paymentMethod: 'ONLINE' })
      .expect(400);

    expect(response.body).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects CASH before the service is called — DEC-016', async () => {
    const create = jest.fn();
    app = await buildApp({ user: AUTHENTICATED_USER, create });

    const response = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .send({ addressId: ADDRESS_ID, paymentMethod: 'CASH' })
      .expect(400);

    expect(response.body).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['restaurantId', 'orderNumber', 'subtotalSatang', 'deliveryFeeSatang', 'grandTotalSatang'])(
    'rejects a client-supplied %s with VALIDATION_FAILED, before the service is called',
    async (field) => {
      const create = jest.fn();
      app = await buildApp({ user: AUTHENTICATED_USER, create });

      const response = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .send({ addressId: ADDRESS_ID, paymentMethod: 'ONLINE', [field]: 'x' })
        .expect(400);

      expect(response.body).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
      expect(create).not.toHaveBeenCalled();
    },
  );
});

// ===========================================================================
// State transitions — Phase E-4.1
// ===========================================================================

const ORDER_ID = 'order-1';

const MERCHANT_USER: AuthenticatedUser = {
  id: 'merchant-1',
  phone: null,
  capabilities: {
    customer: true,
    merchant: [{ restaurantId: 'restaurant-a', memberRole: 'STAFF' }],
    rider: null,
    platformStaff: null,
  },
};

const RIDER_USER: AuthenticatedUser = {
  id: 'rider-1',
  phone: null,
  capabilities: { customer: true, merchant: [], rider: { riderId: 'rider-1' }, platformStaff: null },
};

const CUSTOMER_ONLY_USER: AuthenticatedUser = {
  id: 'customer-1',
  phone: null,
  capabilities: { customer: true, merchant: [], rider: null, platformStaff: null },
};

const OPERATOR_USER: AuthenticatedUser = {
  id: 'operator-1',
  phone: null,
  capabilities: { customer: true, merchant: [], rider: null, platformStaff: { staffRole: 'OPERATOR' } },
};

const TRANSITION_RESULT = { orderId: ORDER_ID, state: 'MERCHANT_ACCEPTED' };

describe.each([
  ['POST /:id/accept', 'accept', 'acceptOrder', MERCHANT_USER],
  ['POST /:id/start-preparing', 'start-preparing', 'startPreparing', MERCHANT_USER],
  ['POST /:id/mark-ready', 'mark-ready', 'markReady', MERCHANT_USER],
  ['POST /:id/pickup', 'pickup', 'pickupOrder', RIDER_USER],
  ['POST /:id/start-delivery', 'start-delivery', 'startDelivery', RIDER_USER],
  ['POST /:id/complete', 'complete', 'completeDelivery', RIDER_USER],
] as const)('%s', (_label, path, serviceMethod, actingUser) => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  it('rejects an unauthenticated request before it reaches the handler', async () => {
    app = await buildApp({ user: null });

    const response = await request(app.getHttpServer()).post(`/api/v1/orders/${ORDER_ID}/${path}`).send({});

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
  });

  it('calls the correct service method with the server-verified user and the route order id', async () => {
    const method = jest.fn().mockResolvedValue(TRANSITION_RESULT);
    app = await buildApp({ user: actingUser, service: { [serviceMethod]: method } });

    await request(app.getHttpServer()).post(`/api/v1/orders/${ORDER_ID}/${path}`).send({}).expect(200);

    expect(method).toHaveBeenCalledWith(actingUser, ORDER_ID);
  });

  it('renders a successful transition as 200 in the shared envelope', async () => {
    const method = jest.fn().mockResolvedValue(TRANSITION_RESULT);
    app = await buildApp({ user: actingUser, service: { [serviceMethod]: method } });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/orders/${ORDER_ID}/${path}`)
      .send({})
      .expect(200);

    expect(response.body).toEqual({ success: true, data: TRANSITION_RESULT });
  });

  it.each(['INVALID_TRANSITION', 'NOT_RESTAURANT_MEMBER'] as const)(
    'renders %s from the service through the real error envelope',
    async (code) => {
      const method = jest.fn().mockRejectedValue(new DomainError(code));
      app = await buildApp({ user: actingUser, service: { [serviceMethod]: method } });

      const response = await request(app.getHttpServer()).post(`/api/v1/orders/${ORDER_ID}/${path}`).send({});

      expect(response.body).toMatchObject({ success: false, error: { code } });
    },
  );

  it('renders NOT_FOUND from the service as 404', async () => {
    const method = jest.fn().mockRejectedValue(new DomainError('NOT_FOUND'));
    app = await buildApp({ user: actingUser, service: { [serviceMethod]: method } });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/orders/${ORDER_ID}/${path}`)
      .send({})
      .expect(404);

    expect(response.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('rejects a wrong-role actor via the real RolesGuard before the service is called', async () => {
    const method = jest.fn();
    // A customer-only user holds none of MERCHANT/RIDER — whichever this
    // route requires, a bare customer is always the wrong actor for it.
    app = await buildApp({
      user: CUSTOMER_ONLY_USER,
      service: { [serviceMethod]: method },
      withRolesGuard: true,
    });

    const response = await request(app.getHttpServer()).post(`/api/v1/orders/${ORDER_ID}/${path}`).send({});

    expect(response.status).toBe(403);
    expect(method).not.toHaveBeenCalled();
  });
});

describe('POST /:id/cancel', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  it('rejects an unauthenticated request before it reaches the handler', async () => {
    app = await buildApp({ user: null });

    const response = await request(app.getHttpServer()).post(`/api/v1/orders/${ORDER_ID}/cancel`).send({});

    expect(response.status).toBe(401);
  });

  it('calls cancelOrder with the user, order id, and reason', async () => {
    const cancelOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'CANCELLED' });
    app = await buildApp({ user: CUSTOMER_ONLY_USER, service: { cancelOrder } });

    await request(app.getHttpServer())
      .post(`/api/v1/orders/${ORDER_ID}/cancel`)
      .send({ reason: 'เปลี่ยนใจ' })
      .expect(200);

    expect(cancelOrder).toHaveBeenCalledWith(CUSTOMER_ONLY_USER, ORDER_ID, 'เปลี่ยนใจ');
  });

  it('accepts an empty body — reason is optional', async () => {
    const cancelOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'CANCELLED' });
    app = await buildApp({ user: CUSTOMER_ONLY_USER, service: { cancelOrder } });

    await request(app.getHttpServer()).post(`/api/v1/orders/${ORDER_ID}/cancel`).send({}).expect(200);

    expect(cancelOrder).toHaveBeenCalledWith(CUSTOMER_ONLY_USER, ORDER_ID, undefined);
  });

  it('allows an operator to call the same route', async () => {
    const cancelOrder = jest.fn().mockResolvedValue({ orderId: ORDER_ID, state: 'CANCELLED' });
    app = await buildApp({ user: OPERATOR_USER, service: { cancelOrder }, withRolesGuard: true });

    await request(app.getHttpServer()).post(`/api/v1/orders/${ORDER_ID}/cancel`).send({}).expect(200);

    expect(cancelOrder).toHaveBeenCalledWith(OPERATOR_USER, ORDER_ID, undefined);
  });

  it('rejects an unknown body field with VALIDATION_FAILED before the service is called', async () => {
    const cancelOrder = jest.fn();
    app = await buildApp({ user: CUSTOMER_ONLY_USER, service: { cancelOrder } });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/orders/${ORDER_ID}/cancel`)
      .send({ causeCode: 'CUSTOMER_CANCELLED' })
      .expect(400);

    expect(response.body).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it('renders INVALID_TRANSITION from the service through the real error envelope', async () => {
    const cancelOrder = jest.fn().mockRejectedValue(new DomainError('INVALID_TRANSITION'));
    app = await buildApp({ user: OPERATOR_USER, service: { cancelOrder } });

    const response = await request(app.getHttpServer()).post(`/api/v1/orders/${ORDER_ID}/cancel`).send({});

    expect(response.body).toMatchObject({ success: false, error: { code: 'INVALID_TRANSITION' } });
  });

  it('renders NOT_FOUND from the service as 404', async () => {
    const cancelOrder = jest.fn().mockRejectedValue(new DomainError('NOT_FOUND'));
    app = await buildApp({ user: CUSTOMER_ONLY_USER, service: { cancelOrder } });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/orders/${ORDER_ID}/cancel`)
      .send({})
      .expect(404);

    expect(response.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });
});
