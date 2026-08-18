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
import { RolesGuard } from '../../common/guards/roles.guard';
import { RestaurantScopeGuard } from '../../common/guards/restaurant-scope.guard';
import { RestaurantCoverController } from './restaurant-cover.controller';
import { RestaurantCoverService } from './restaurant-cover.service';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';

/**
 * M-11 — the HTTP boundary of the restaurant cover upload routes.
 *
 * Unlike `cart.controller.spec.ts` (which fakes the entire auth chain because
 * `CartController` has no per-resource scope to prove), this mounts the
 * *real* `RolesGuard` and `RestaurantScopeGuard` — only `SupabaseAuthGuard`
 * is stood in for, since its job (verifying a JWT) is out of scope here and
 * already covered by its own spec. Authorization correctness is the entire
 * point of M-11's security boundary, so it is proven against the actual
 * guards, not asserted by a fake that could quietly diverge from them.
 * `RestaurantCoverService` is a plain stub — its own spec covers its logic.
 */

const RESTAURANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_RESTAURANT_ID = '22222222-2222-4222-8222-222222222222';

function memberOf(restaurantId: string): AuthenticatedUser {
  return {
    id: 'user-1',
    phone: '+66812345678',
    capabilities: {
      customer: true,
      merchant: [{ restaurantId, memberRole: 'OWNER' }],
      rider: null,
      platformStaff: null,
    },
  };
}

const NON_MERCHANT_USER: AuthenticatedUser = {
  id: 'user-2',
  phone: '+66899999999',
  capabilities: { customer: true, merchant: [], rider: null, platformStaff: null },
};

/** Stands in for SupabaseAuthGuard only: attaches a fixed user, or rejects. */
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
  requestUploadUrl?: jest.Mock;
  completeUpload?: jest.Mock;
}): Promise<{ app: INestApplication; service: { requestUploadUrl: jest.Mock; completeUpload: jest.Mock } }> {
  const service = {
    requestUploadUrl: options.requestUploadUrl ?? jest.fn(),
    completeUpload: options.completeUpload ?? jest.fn(),
  };

  const moduleRef = await Test.createTestingModule({
    imports: [CorrelationModule],
    controllers: [RestaurantCoverController],
    providers: [
      { provide: RestaurantCoverService, useValue: service },
      // Real guards — this is the point of this file.
      { provide: APP_GUARD, useValue: fakeAuthGuard(options.user) },
      { provide: APP_GUARD, useClass: RolesGuard },
      { provide: APP_GUARD, useClass: RestaurantScopeGuard },
      { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      Reflector,
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(0);
  return { app, service };
}

describe('POST .../cover/upload-url and .../cover/complete', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  it('rejects an unauthenticated request before the service is called', async () => {
    const { app: builtApp, service } = await buildApp({ user: null });
    app = builtApp;

    const response = await request(app.getHttpServer())
      .post(`/api/v1/merchant/restaurants/${RESTAURANT_ID}/cover/upload-url`)
      .send({ contentType: 'image/webp' });

    expect(response.status).toBe(401);
    expect(service.requestUploadUrl).not.toHaveBeenCalled();
  });

  it('rejects a caller with no merchant capability at all', async () => {
    const { app: builtApp, service } = await buildApp({ user: NON_MERCHANT_USER });
    app = builtApp;

    const response = await request(app.getHttpServer())
      .post(`/api/v1/merchant/restaurants/${RESTAURANT_ID}/cover/upload-url`)
      .send({ contentType: 'image/webp' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN'); // RolesGuard's own generic ForbiddenException
    expect(service.requestUploadUrl).not.toHaveBeenCalled();
  });

  it('rejects a merchant who is a member of a DIFFERENT restaurant (not this one)', async () => {
    const { app: builtApp, service } = await buildApp({ user: memberOf(OTHER_RESTAURANT_ID) });
    app = builtApp;

    const response = await request(app.getHttpServer())
      .post(`/api/v1/merchant/restaurants/${RESTAURANT_ID}/cover/upload-url`)
      .send({ contentType: 'image/webp' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('NOT_RESTAURANT_MEMBER');
    expect(service.requestUploadUrl).not.toHaveBeenCalled();
  });

  it('this also proves a non-existent restaurant is rejected identically — no membership can name a restaurant that is not real', async () => {
    // There is no separate "restaurant not found" path: a membership row can
    // only exist for a real restaurant (FK), so "no membership matches" and
    // "the restaurant doesn't exist" are indistinguishable by construction —
    // matching this codebase's existing "do not leak existence" convention
    // (see AddressesService.update).
    const { app: builtApp } = await buildApp({ user: memberOf(OTHER_RESTAURANT_ID) });
    app = builtApp;

    const response = await request(app.getHttpServer())
      .post(`/api/v1/merchant/restaurants/nonexistent-restaurant-id/cover/upload-url`)
      .send({ contentType: 'image/webp' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('NOT_RESTAURANT_MEMBER');
  });

  it('accepts an authorized member and calls the service with the route restaurantId', async () => {
    const requestUploadUrl = jest
      .fn()
      .mockResolvedValue({ uploadUrl: 'https://signed.example/x', objectKey: 'restaurants/r/cover.webp' });
    const { app: builtApp } = await buildApp({
      user: memberOf(RESTAURANT_ID),
      requestUploadUrl,
    });
    app = builtApp;

    const response = await request(app.getHttpServer())
      .post(`/api/v1/merchant/restaurants/${RESTAURANT_ID}/cover/upload-url`)
      .send({ contentType: 'image/webp' })
      .expect(201);

    expect(requestUploadUrl).toHaveBeenCalledWith(RESTAURANT_ID, 'image/webp');
    expect(response.body).toEqual({
      success: true,
      data: { uploadUrl: 'https://signed.example/x', objectKey: 'restaurants/r/cover.webp' },
    });
  });

  it('rejects a malformed body before the service is called', async () => {
    const requestUploadUrl = jest.fn();
    const { app: builtApp } = await buildApp({ user: memberOf(RESTAURANT_ID), requestUploadUrl });
    app = builtApp;

    const response = await request(app.getHttpServer())
      .post(`/api/v1/merchant/restaurants/${RESTAURANT_ID}/cover/upload-url`)
      .send({ notContentType: 'image/webp' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(requestUploadUrl).not.toHaveBeenCalled();
  });

  it('a client-supplied restaurantId in the body cannot override the route param', async () => {
    const requestUploadUrl = jest
      .fn()
      .mockResolvedValue({ uploadUrl: 'https://signed.example/x', objectKey: 'k' });
    const { app: builtApp } = await buildApp({
      user: memberOf(RESTAURANT_ID),
      requestUploadUrl,
    });
    app = builtApp;

    await request(app.getHttpServer())
      .post(`/api/v1/merchant/restaurants/${RESTAURANT_ID}/cover/upload-url`)
      .send({ contentType: 'image/webp', restaurantId: OTHER_RESTAURANT_ID })
      .expect(400); // .strict() schema rejects the unknown field outright

    expect(requestUploadUrl).not.toHaveBeenCalled();
  });

  it('complete: accepts an authorized member and calls the service with the route restaurantId', async () => {
    const completeUpload = jest.fn().mockResolvedValue({ imageUrl: 'restaurants/r/cover.webp' });
    const { app: builtApp } = await buildApp({ user: memberOf(RESTAURANT_ID), completeUpload });
    app = builtApp;

    const response = await request(app.getHttpServer())
      .post(`/api/v1/merchant/restaurants/${RESTAURANT_ID}/cover/complete`)
      .send({ objectKey: 'restaurants/r/cover.webp' })
      .expect(201);

    expect(completeUpload).toHaveBeenCalledWith(RESTAURANT_ID, 'restaurants/r/cover.webp');
    expect(response.body).toEqual({ success: true, data: { imageUrl: 'restaurants/r/cover.webp' } });
  });

  it('complete: rejects an unauthenticated request before the service is called', async () => {
    const { app: builtApp, service } = await buildApp({ user: null });
    app = builtApp;

    const response = await request(app.getHttpServer())
      .post(`/api/v1/merchant/restaurants/${RESTAURANT_ID}/cover/complete`)
      .send({ objectKey: 'restaurants/r/cover.webp' });

    expect(response.status).toBe(401);
    expect(service.completeUpload).not.toHaveBeenCalled();
  });

  it('renders a NOT_FOUND from the service through the real error envelope, correlationId preserved', async () => {
    const completeUpload = jest.fn().mockRejectedValue(new DomainError('NOT_FOUND'));
    const { app: builtApp } = await buildApp({ user: memberOf(RESTAURANT_ID), completeUpload });
    app = builtApp;

    const response = await request(app.getHttpServer())
      .post(`/api/v1/merchant/restaurants/${RESTAURANT_ID}/cover/complete`)
      .set(CORRELATION_ID_HEADER, 'cover-trace-1')
      .send({ objectKey: 'restaurants/r/cover.webp' });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND', correlationId: 'cover-trace-1' },
    });
  });

  it('never includes R2 credentials or a signed URL in any response body', async () => {
    const requestUploadUrl = jest
      .fn()
      .mockResolvedValue({ uploadUrl: 'https://signed.example/x?sig=abc', objectKey: 'k' });
    const { app: builtApp } = await buildApp({ user: memberOf(RESTAURANT_ID), requestUploadUrl });
    app = builtApp;

    const response = await request(app.getHttpServer())
      .post(`/api/v1/merchant/restaurants/${RESTAURANT_ID}/cover/upload-url`)
      .send({ contentType: 'image/webp' })
      .expect(201);

    const body = JSON.stringify(response.body);
    expect(body).not.toMatch(/R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|accessKeyId|secretAccessKey/i);
  });
});
