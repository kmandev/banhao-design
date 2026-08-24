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
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../common/interceptors/response.interceptor';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { DomainError } from '../../common/errors/domain-error';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedUser } from '../../common/types';

/**
 * Phase F-1 — the HTTP boundary of `POST /api/v1/orders/:id/payment`.
 *
 * Same shape as `orders.controller.spec.ts`: `PaymentsService` is a plain
 * stub — its own logic is `payments.service.spec.ts`'s job. This file proves
 * the wiring only.
 */

const ORDER_ID = 'order-1';

const CUSTOMER_USER: AuthenticatedUser = {
  id: 'customer-1',
  phone: null,
  capabilities: { customer: true, merchant: [], rider: null, platformStaff: null },
};

const PAYMENT_RESULT = {
  paymentId: 'payment-1',
  paymentReference: 'PAY-BH20260824-0002',
  state: 'PENDING',
  amountSatang: 7500,
  currency: 'THB',
  qr: { value: 'NULL-QR:order-1:NULL-fixed-id', expiresAt: '2026-08-24T05:00:00.000Z' },
};

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
  createPayment?: jest.Mock;
  withRolesGuard?: boolean;
}): Promise<INestApplication> {
  const createPayment = options.createPayment ?? jest.fn().mockResolvedValue(PAYMENT_RESULT);

  const guards: Provider[] = [{ provide: APP_GUARD, useValue: fakeAuthGuard(options.user) }];
  if (options.withRolesGuard) {
    guards.push({ provide: APP_GUARD, useClass: RolesGuard });
  }

  const moduleRef = await Test.createTestingModule({
    imports: [CorrelationModule],
    controllers: [PaymentsController],
    providers: [
      { provide: PaymentsService, useValue: { createPayment } },
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

describe('POST /api/v1/orders/:id/payment', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  it('rejects an unauthenticated request before it reaches the handler', async () => {
    const createPayment = jest.fn();
    app = await buildApp({ user: null, createPayment });

    const response = await request(app.getHttpServer()).post(`/api/v1/orders/${ORDER_ID}/payment`).send();

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
    expect(createPayment).not.toHaveBeenCalled();
  });

  it('calls the service with the server-verified user and the route order id', async () => {
    const createPayment = jest.fn().mockResolvedValue(PAYMENT_RESULT);
    app = await buildApp({ user: CUSTOMER_USER, createPayment });

    await request(app.getHttpServer()).post(`/api/v1/orders/${ORDER_ID}/payment`).send().expect(200);

    expect(createPayment).toHaveBeenCalledWith(CUSTOMER_USER, ORDER_ID);
  });

  it('renders a successful initiation as 200 in the shared envelope', async () => {
    const createPayment = jest.fn().mockResolvedValue(PAYMENT_RESULT);
    app = await buildApp({ user: CUSTOMER_USER, createPayment });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/orders/${ORDER_ID}/payment`)
      .send()
      .expect(200);

    expect(response.body).toEqual({ success: true, data: PAYMENT_RESULT });
  });

  it('renders ORDER_NOT_PAYABLE from the service through the real error envelope', async () => {
    const createPayment = jest
      .fn()
      .mockRejectedValue(new DomainError('ORDER_NOT_PAYABLE', { details: { currentState: 'PAID' } }));
    app = await buildApp({ user: CUSTOMER_USER, createPayment });

    const response = await request(app.getHttpServer()).post(`/api/v1/orders/${ORDER_ID}/payment`).send();

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ success: false, error: { code: 'ORDER_NOT_PAYABLE' } });
  });

  it('renders NOT_FOUND from the service as 404', async () => {
    const createPayment = jest.fn().mockRejectedValue(new DomainError('NOT_FOUND'));
    app = await buildApp({ user: CUSTOMER_USER, createPayment });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/orders/${ORDER_ID}/payment`)
      .send()
      .expect(404);

    expect(response.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('renders PROVIDER_UNAVAILABLE from the service through the real error envelope', async () => {
    const createPayment = jest.fn().mockRejectedValue(new DomainError('PROVIDER_UNAVAILABLE'));
    app = await buildApp({ user: CUSTOMER_USER, createPayment });

    const response = await request(app.getHttpServer()).post(`/api/v1/orders/${ORDER_ID}/payment`).send();

    expect(response.body).toMatchObject({ success: false, error: { code: 'PROVIDER_UNAVAILABLE' } });
  });

  it('rejects a non-customer actor via the real RolesGuard before the service is called', async () => {
    const createPayment = jest.fn();
    const riderUser: AuthenticatedUser = {
      id: 'rider-1',
      phone: null,
      capabilities: { customer: false, merchant: [], rider: { riderId: 'rider-1' }, platformStaff: null },
    };
    app = await buildApp({ user: riderUser, createPayment, withRolesGuard: true });

    const response = await request(app.getHttpServer()).post(`/api/v1/orders/${ORDER_ID}/payment`).send();

    expect(response.status).toBe(403);
    expect(createPayment).not.toHaveBeenCalled();
  });
});
