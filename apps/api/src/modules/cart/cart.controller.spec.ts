import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CorrelationModule } from '../../common/correlation/correlation.module';
import { CORRELATION_ID_HEADER } from '../../common/correlation/correlation';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../common/interceptors/response.interceptor';
import { CartController } from './cart.controller';
import { CartService, type CartValidationResult } from './cart.service';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';

/**
 * Phase D / D-6 — the HTTP boundary of `POST /api/v1/cart/validate`.
 *
 * `CartService` is a plain stub here; `cart.service.spec.ts` covers its
 * business logic. What this file proves is the wiring: an anonymous request
 * never reaches the handler, the caller's own verified id is what the handler
 * receives, and both success and every domain error are rendered through the
 * real global filter/interceptor — same mechanism the correlation e2e test
 * exercises, mounted here with the actual `CartController`.
 */

const AUTHENTICATED_USER: AuthenticatedUser = {
  id: 'user-1',
  phone: '+66812345678',
  capabilities: { customer: true, merchant: [], rider: null, platformStaff: null },
};

/** Stands in for SupabaseAuthGuard: attaches a fixed user, or rejects. */
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
  validate: jest.Mock;
}): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [CorrelationModule],
    controllers: [CartController],
    providers: [
      { provide: CartService, useValue: { validate: options.validate } },
      { provide: APP_GUARD, useValue: fakeAuthGuard(options.user) },
      { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      Reflector,
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  return app;
}

const EMPTY_RESULT: CartValidationResult = {
  cartId: null,
  restaurantId: null,
  subtotalSatang: 0,
  lines: [],
};

describe('POST /api/v1/cart/validate', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  it('rejects an unauthenticated request before it reaches the handler', async () => {
    const validate = jest.fn();
    app = await buildApp({ user: null, validate });

    const response = await request(app.getHttpServer()).post('/api/v1/cart/validate').send({});

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
    expect(validate).not.toHaveBeenCalled();
  });

  it('passes the server-verified user id, never anything from the request body', async () => {
    const validate = jest.fn().mockResolvedValue(EMPTY_RESULT);
    app = await buildApp({ user: AUTHENTICATED_USER, validate });

    // A client-supplied userId in the body must have no effect at all.
    await request(app.getHttpServer())
      .post('/api/v1/cart/validate')
      .send({ userId: 'someone-else' })
      .expect(400); // rejected by strict validation before it could matter

    expect(validate).not.toHaveBeenCalled();

    await request(app.getHttpServer()).post('/api/v1/cart/validate').send({}).expect(200);
    expect(validate).toHaveBeenCalledWith('user-1', {});
  });

  it('renders a successful validation in the shared envelope', async () => {
    const result: CartValidationResult = {
      cartId: 'cart-1',
      restaurantId: 'shop-1',
      subtotalSatang: 12000,
      lines: [
        {
          cartItemId: 'ci-1',
          menuItemId: 'mi-1',
          quantity: 2,
          unitPriceSatang: 6000,
          lineSubtotalSatang: 12000,
        },
      ],
    };
    app = await buildApp({ user: AUTHENTICATED_USER, validate: jest.fn().mockResolvedValue(result) });

    const response = await request(app.getHttpServer())
      .post('/api/v1/cart/validate')
      .send({})
      .expect(200);

    expect(response.body).toEqual({ success: true, data: result });
  });

  it.each(['ITEM_UNAVAILABLE', 'PRICE_CHANGED', 'MIXED_RESTAURANT'] as const)(
    'renders %s as a 409 through the real error envelope, with correlationId preserved',
    async (code) => {
      const validate = jest.fn().mockRejectedValue(new DomainError(code, { details: { x: 1 } }));
      app = await buildApp({ user: AUTHENTICATED_USER, validate });

      const response = await request(app.getHttpServer())
        .post('/api/v1/cart/validate')
        .set(CORRELATION_ID_HEADER, `cart-${code}`)
        .send({})
        .expect(409);

      expect(response.body).toMatchObject({
        success: false,
        error: { code, details: { x: 1 }, correlationId: `cart-${code}` },
      });
    },
  );

  it('rejects a malformed body with VALIDATION_FAILED before the service is called', async () => {
    const validate = jest.fn();
    app = await buildApp({ user: AUTHENTICATED_USER, validate });

    const response = await request(app.getHttpServer())
      .post('/api/v1/cart/validate')
      .send({ expectedLines: [{ cartItemId: 'not-a-uuid', expectedUnitPriceSatang: -1 }] })
      .expect(400);

    expect(response.body).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(validate).not.toHaveBeenCalled();
  });

  it('never invents a delivery fee, service fee, discount or total in the response (DEC-D-01)', async () => {
    app = await buildApp({
      user: AUTHENTICATED_USER,
      validate: jest.fn().mockResolvedValue(EMPTY_RESULT),
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/cart/validate')
      .send({})
      .expect(200);

    const keys = Object.keys(response.body.data);
    expect(keys).not.toContain('deliveryFeeSatang');
    expect(keys).not.toContain('serviceFeeSatang');
    expect(keys).not.toContain('discountSatang');
    expect(keys).not.toContain('totalSatang');
  });
});
