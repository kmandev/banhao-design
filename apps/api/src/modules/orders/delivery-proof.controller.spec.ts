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
import { DeliveryProofController } from './delivery-proof.controller';
import { DeliveryProofService } from './delivery-proof.service';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';

/**
 * `GET /api/v1/orders/:id/delivery-proof` — the HTTP boundary. `DeliveryProofService`
 * is a plain stub, same shape as `orders.controller.spec.ts`: ownership logic
 * and retention behaviour are that service's own spec's job. This file only
 * proves the wiring — an unauthenticated request never reaches the handler,
 * and both a proof and a `null`/`NOT_FOUND` result render through the real
 * global filter/interceptor.
 */

const AUTHENTICATED_USER: AuthenticatedUser = {
  id: 'user-1',
  phone: '+66812345678',
  capabilities: { customer: true, merchant: [], rider: null, platformStaff: null },
};

const ORDER_ID = '22222222-2222-4222-8222-222222222222';

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
  getProof?: jest.Mock;
}): Promise<INestApplication> {
  const serviceStub = { getProof: options.getProof ?? jest.fn() };

  const guards: Provider[] = [{ provide: APP_GUARD, useValue: fakeAuthGuard(options.user) }];

  const moduleRef = await Test.createTestingModule({
    imports: [CorrelationModule],
    controllers: [DeliveryProofController],
    providers: [
      { provide: DeliveryProofService, useValue: serviceStub },
      ...guards,
      { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      Reflector,
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  return app;
}

describe('GET /api/v1/orders/:id/delivery-proof', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  it('rejects an unauthenticated request before it reaches the handler', async () => {
    const getProof = jest.fn();
    app = await buildApp({ user: null, getProof });

    const response = await request(app.getHttpServer()).get(`/api/v1/orders/${ORDER_ID}/delivery-proof`);

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
    expect(getProof).not.toHaveBeenCalled();
  });

  it('passes the server-verified user and the path order id to the service', async () => {
    const getProof = jest.fn().mockResolvedValue(null);
    app = await buildApp({ user: AUTHENTICATED_USER, getProof });

    await request(app.getHttpServer()).get(`/api/v1/orders/${ORDER_ID}/delivery-proof`).expect(200);

    expect(getProof).toHaveBeenCalledWith(AUTHENTICATED_USER, ORDER_ID);
  });

  it('renders null in the shared envelope when no usable proof exists', async () => {
    app = await buildApp({ user: AUTHENTICATED_USER, getProof: jest.fn().mockResolvedValue(null) });

    const response = await request(app.getHttpServer()).get(`/api/v1/orders/${ORDER_ID}/delivery-proof`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: null });
  });

  it('renders the signed-URL response in the shared envelope', async () => {
    const result = {
      photoUrl: 'https://private.example/deliveries/x/proof/y.jpg?signed=1',
      capturedAt: '2026-08-20T10:00:00.000Z',
      deliveredAt: '2026-08-20T10:00:00.000Z',
    };
    app = await buildApp({ user: AUTHENTICATED_USER, getProof: jest.fn().mockResolvedValue(result) });

    const response = await request(app.getHttpServer()).get(`/api/v1/orders/${ORDER_ID}/delivery-proof`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: result });
  });

  it('renders a foreign/missing order as 404, indistinguishable from each other', async () => {
    const getProof = jest.fn().mockRejectedValue(new DomainError('NOT_FOUND', { message: 'Order not found' }));
    app = await buildApp({ user: AUTHENTICATED_USER, getProof });

    const response = await request(app.getHttpServer()).get(`/api/v1/orders/${ORDER_ID}/delivery-proof`);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });
});
