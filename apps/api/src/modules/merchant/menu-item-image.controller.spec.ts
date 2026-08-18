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
import { MenuItemImageController } from './menu-item-image.controller';
import { MenuItemImageService } from './menu-item-image.service';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';

/**
 * M-12 — the HTTP boundary of the menu item image upload routes.
 *
 * Mounts the **real** `RolesGuard` — only `SupabaseAuthGuard` is stood in
 * for, matching `restaurant-cover.controller.spec.ts`. Deliberately does
 * **not** mount `RestaurantScopeGuard`: these routes carry no `restaurantId`
 * route parameter for it to read (see `MenuItemImageController`'s own doc
 * comment), so it has nothing to prove here. The per-menu-item ownership
 * check this controller ultimately depends on lives in `MenuItemImageService`
 * and is proven for real in that service's own spec — here,
 * `MenuItemImageService` is a plain stub, and what's under test is routing,
 * `@Roles('MERCHANT')`, request/response shape, and error rendering.
 */

const RESTAURANT_ID = '11111111-1111-4111-8111-111111111111';
const MENU_ITEM_ID = '33333333-3333-4333-8333-333333333333';

function merchantUser(): AuthenticatedUser {
  return {
    id: 'user-1',
    phone: '+66812345678',
    capabilities: {
      customer: true,
      merchant: [{ restaurantId: RESTAURANT_ID, memberRole: 'OWNER' }],
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
}): Promise<{
  app: INestApplication;
  service: { requestUploadUrl: jest.Mock; completeUpload: jest.Mock };
}> {
  const service = {
    requestUploadUrl: options.requestUploadUrl ?? jest.fn(),
    completeUpload: options.completeUpload ?? jest.fn(),
  };

  const moduleRef = await Test.createTestingModule({
    imports: [CorrelationModule],
    controllers: [MenuItemImageController],
    providers: [
      { provide: MenuItemImageService, useValue: service },
      { provide: APP_GUARD, useValue: fakeAuthGuard(options.user) },
      { provide: APP_GUARD, useClass: RolesGuard },
      { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      Reflector,
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(0);
  return { app, service };
}

describe('POST .../menu-items/:menuItemId/image/upload-url and .../image/complete', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  it('rejects an unauthenticated request before the service is called', async () => {
    const { app: builtApp, service } = await buildApp({ user: null });
    app = builtApp;

    const response = await request(app.getHttpServer())
      .post(`/api/v1/merchant/menu-items/${MENU_ITEM_ID}/image/upload-url`)
      .send({ contentType: 'image/webp' });

    expect(response.status).toBe(401);
    expect(service.requestUploadUrl).not.toHaveBeenCalled();
  });

  it('rejects a caller with no merchant capability at all, via the real RolesGuard', async () => {
    const { app: builtApp, service } = await buildApp({ user: NON_MERCHANT_USER });
    app = builtApp;

    const response = await request(app.getHttpServer())
      .post(`/api/v1/merchant/menu-items/${MENU_ITEM_ID}/image/upload-url`)
      .send({ contentType: 'image/webp' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(service.requestUploadUrl).not.toHaveBeenCalled();
  });

  it('accepts an authenticated merchant and calls the service with menuItemId + capabilities', async () => {
    const requestUploadUrl = jest.fn().mockResolvedValue({
      uploadUrl: 'https://signed.example/x',
      objectKey: `menu-items/${MENU_ITEM_ID}/uuid.webp`,
    });
    const { app: builtApp } = await buildApp({ user: merchantUser(), requestUploadUrl });
    app = builtApp;

    const response = await request(app.getHttpServer())
      .post(`/api/v1/merchant/menu-items/${MENU_ITEM_ID}/image/upload-url`)
      .send({ contentType: 'image/webp' })
      .expect(201);

    expect(requestUploadUrl).toHaveBeenCalledWith(
      MENU_ITEM_ID,
      'image/webp',
      merchantUser().capabilities,
    );
    expect(response.body).toEqual({
      success: true,
      data: { uploadUrl: 'https://signed.example/x', objectKey: `menu-items/${MENU_ITEM_ID}/uuid.webp` },
    });
  });

  it('rejects a malformed body before the service is called', async () => {
    const requestUploadUrl = jest.fn();
    const { app: builtApp } = await buildApp({ user: merchantUser(), requestUploadUrl });
    app = builtApp;

    const response = await request(app.getHttpServer())
      .post(`/api/v1/merchant/menu-items/${MENU_ITEM_ID}/image/upload-url`)
      .send({ notContentType: 'image/webp' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(requestUploadUrl).not.toHaveBeenCalled();
  });

  it('a client-supplied restaurantId in the body cannot participate — .strict() rejects the unknown field', async () => {
    const requestUploadUrl = jest.fn();
    const { app: builtApp } = await buildApp({ user: merchantUser(), requestUploadUrl });
    app = builtApp;

    await request(app.getHttpServer())
      .post(`/api/v1/merchant/menu-items/${MENU_ITEM_ID}/image/upload-url`)
      .send({ contentType: 'image/webp', restaurantId: RESTAURANT_ID })
      .expect(400);

    expect(requestUploadUrl).not.toHaveBeenCalled();
  });

  it('renders a NOT_RESTAURANT_MEMBER from the service as 403, via the real error envelope', async () => {
    const requestUploadUrl = jest.fn().mockRejectedValue(new DomainError('NOT_RESTAURANT_MEMBER'));
    const { app: builtApp } = await buildApp({ user: merchantUser(), requestUploadUrl });
    app = builtApp;

    const response = await request(app.getHttpServer())
      .post(`/api/v1/merchant/menu-items/${MENU_ITEM_ID}/image/upload-url`)
      .send({ contentType: 'image/webp' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('NOT_RESTAURANT_MEMBER');
  });

  it('complete: accepts an authenticated merchant and calls the service with menuItemId + capabilities', async () => {
    const objectKey = `menu-items/${MENU_ITEM_ID}/uuid.webp`;
    const completeUpload = jest
      .fn()
      .mockResolvedValue({ imageUrl: `https://assets.example.com/${objectKey}` });
    const { app: builtApp } = await buildApp({ user: merchantUser(), completeUpload });
    app = builtApp;

    const response = await request(app.getHttpServer())
      .post(`/api/v1/merchant/menu-items/${MENU_ITEM_ID}/image/complete`)
      .send({ objectKey })
      .expect(201);

    expect(completeUpload).toHaveBeenCalledWith(MENU_ITEM_ID, objectKey, merchantUser().capabilities);
    expect(response.body).toEqual({
      success: true,
      data: { imageUrl: `https://assets.example.com/${objectKey}` },
    });
  });

  it('complete response carries a resolved URL, not a bare object key (M-12 differs from M-11 here — see controller doc comment)', async () => {
    const objectKey = `menu-items/${MENU_ITEM_ID}/uuid.webp`;
    const completeUpload = jest
      .fn()
      .mockResolvedValue({ imageUrl: `https://assets.example.com/${objectKey}` });
    const { app: builtApp } = await buildApp({ user: merchantUser(), completeUpload });
    app = builtApp;

    const response = await request(app.getHttpServer())
      .post(`/api/v1/merchant/menu-items/${MENU_ITEM_ID}/image/complete`)
      .send({ objectKey })
      .expect(201);

    expect(response.body.data.imageUrl.startsWith('https://')).toBe(true);
  });

  it('complete: rejects an unauthenticated request before the service is called', async () => {
    const { app: builtApp, service } = await buildApp({ user: null });
    app = builtApp;

    const response = await request(app.getHttpServer())
      .post(`/api/v1/merchant/menu-items/${MENU_ITEM_ID}/image/complete`)
      .send({ objectKey: `menu-items/${MENU_ITEM_ID}/uuid.webp` });

    expect(response.status).toBe(401);
    expect(service.completeUpload).not.toHaveBeenCalled();
  });

  it('renders a NOT_FOUND from the service through the real error envelope, correlationId preserved', async () => {
    const completeUpload = jest.fn().mockRejectedValue(new DomainError('NOT_FOUND'));
    const { app: builtApp } = await buildApp({ user: merchantUser(), completeUpload });
    app = builtApp;

    const response = await request(app.getHttpServer())
      .post(`/api/v1/merchant/menu-items/${MENU_ITEM_ID}/image/complete`)
      .set(CORRELATION_ID_HEADER, 'menu-image-trace-1')
      .send({ objectKey: `menu-items/${MENU_ITEM_ID}/uuid.webp` });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND', correlationId: 'menu-image-trace-1' },
    });
  });

  it('never includes R2 credentials or a signed URL in any response body', async () => {
    const requestUploadUrl = jest.fn().mockResolvedValue({
      uploadUrl: 'https://signed.example/x?X-Amz-Signature=abc',
      objectKey: `menu-items/${MENU_ITEM_ID}/uuid.webp`,
    });
    const { app: builtApp } = await buildApp({ user: merchantUser(), requestUploadUrl });
    app = builtApp;

    const response = await request(app.getHttpServer())
      .post(`/api/v1/merchant/menu-items/${MENU_ITEM_ID}/image/upload-url`)
      .send({ contentType: 'image/webp' })
      .expect(201);

    const body = JSON.stringify(response.body);
    expect(body).not.toMatch(/R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|accessKeyId|secretAccessKey/i);
  });
});
