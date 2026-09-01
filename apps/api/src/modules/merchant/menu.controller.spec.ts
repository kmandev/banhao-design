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
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../common/interceptors/response.interceptor';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RestaurantScopeGuard } from '../../common/guards/restaurant-scope.guard';
import { DomainError } from '../../common/errors/domain-error';
import { NO_CAPABILITIES, type AuthenticatedUser } from '../../common/types';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';

/**
 * M-11's HTTP boundary.
 *
 * The real `RolesGuard` **and** the real `RestaurantScopeGuard` run here, not
 * fakes: the two-shape authorization this controller uses is the thing most
 * worth testing, and stubbing either would leave it unexercised. Only
 * `SupabaseAuthGuard` is replaced, since a real JWT is not what these assert.
 *
 * `MenuService` is a stub — its behaviour is `menu.service.spec.ts`'s job.
 * What this file proves is the boundary: who reaches a handler, what the
 * handler receives, what a malformed body does, and how a domain error
 * renders.
 */

const RESTAURANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_RESTAURANT_ID = '22222222-2222-4222-8222-222222222222';
const CATEGORY_ID = '33333333-3333-4333-8333-333333333333';
const ITEM_ID = '44444444-4444-4444-8444-444444444444';

const MERCHANT_A: AuthenticatedUser = {
  id: 'user-merchant-a',
  phone: '+66812345678',
  capabilities: {
    ...NO_CAPABILITIES,
    merchant: [{ restaurantId: RESTAURANT_ID, memberRole: 'OWNER' }],
  },
};

const MERCHANT_B: AuthenticatedUser = {
  id: 'user-merchant-b',
  phone: '+66812345679',
  capabilities: {
    ...NO_CAPABILITIES,
    merchant: [{ restaurantId: OTHER_RESTAURANT_ID, memberRole: 'OWNER' }],
  },
};

const CUSTOMER: AuthenticatedUser = {
  id: 'user-customer',
  phone: '+66899999999',
  capabilities: { ...NO_CAPABILITIES, customer: true },
};

const RIDER: AuthenticatedUser = {
  id: 'user-rider',
  phone: '+66899999998',
  capabilities: { ...NO_CAPABILITIES, rider: { riderId: 'rider-1' } },
};

type ServiceStub = Record<keyof MenuService, jest.Mock>;

function makeStub(): ServiceStub {
  return {
    createCategory: jest.fn(),
    updateCategory: jest.fn(),
    archiveCategory: jest.fn(),
    reorderCategories: jest.fn(),
    createItem: jest.fn(),
    updateItem: jest.fn(),
    setItemAvailability: jest.fn(),
    archiveItem: jest.fn(),
    reorderItems: jest.fn(),
    replaceOptionGroups: jest.fn(),
  } as unknown as ServiceStub;
}

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

async function buildApp(user: AuthenticatedUser | null, stub: ServiceStub): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [CorrelationModule],
    controllers: [MenuController],
    providers: [
      { provide: MenuService, useValue: stub },
      { provide: APP_GUARD, useValue: fakeAuthGuard(user) },
      { provide: APP_GUARD, useClass: RolesGuard },
      { provide: APP_GUARD, useClass: RestaurantScopeGuard },
      { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      Reflector,
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  return app;
}

/** Every route, with a valid body where one is required. */
const ROUTES: ReadonlyArray<{
  name: string;
  method: 'post' | 'patch' | 'put';
  path: string;
  body?: unknown;
  scoped: boolean;
}> = [
  {
    name: 'create category',
    method: 'post',
    path: `/api/v1/merchant/restaurants/${RESTAURANT_ID}/menu-categories`,
    body: { name: 'ของหวาน' },
    scoped: true,
  },
  {
    name: 'rename category',
    method: 'patch',
    path: `/api/v1/merchant/menu-categories/${CATEGORY_ID}`,
    body: { name: 'ของหวาน' },
    scoped: false,
  },
  {
    name: 'archive category',
    method: 'post',
    path: `/api/v1/merchant/menu-categories/${CATEGORY_ID}/archive`,
    scoped: false,
  },
  {
    name: 'reorder categories',
    method: 'post',
    path: `/api/v1/merchant/restaurants/${RESTAURANT_ID}/menu-categories/reorder`,
    body: { categoryIds: [CATEGORY_ID] },
    scoped: true,
  },
  {
    name: 'create item',
    method: 'post',
    path: `/api/v1/merchant/restaurants/${RESTAURANT_ID}/menu-items`,
    body: { categoryId: CATEGORY_ID, name: 'ข้าวผัดกุ้ง', basePriceSatang: 6500 },
    scoped: true,
  },
  {
    name: 'update item',
    method: 'patch',
    path: `/api/v1/merchant/menu-items/${ITEM_ID}`,
    body: { name: 'ข้าวผัดหมู' },
    scoped: false,
  },
  {
    name: 'set availability',
    method: 'patch',
    path: `/api/v1/merchant/menu-items/${ITEM_ID}/availability`,
    body: { isAvailable: false },
    scoped: false,
  },
  {
    name: 'archive item',
    method: 'post',
    path: `/api/v1/merchant/menu-items/${ITEM_ID}/archive`,
    scoped: false,
  },
  {
    name: 'reorder items',
    method: 'post',
    path: `/api/v1/merchant/restaurants/${RESTAURANT_ID}/menu-items/reorder`,
    body: { categoryId: CATEGORY_ID, menuItemIds: [ITEM_ID] },
    scoped: true,
  },
  {
    name: 'replace option groups',
    method: 'put',
    path: `/api/v1/merchant/menu-items/${ITEM_ID}/option-groups`,
    body: { groups: [] },
    scoped: false,
  },
];

describe('MenuController', () => {
  let app: INestApplication;
  let stub: ServiceStub;

  beforeEach(() => {
    stub = makeStub();
  });

  afterEach(async () => {
    await app?.close();
  });

  function called(): string[] {
    return Object.entries(stub)
      .filter(([, mock]) => mock.mock.calls.length > 0)
      .map(([name]) => name);
  }

  describe('authorization', () => {
    it.each(ROUTES)('rejects an anonymous request to $name with 401', async ({ method, path, body }) => {
      app = await buildApp(null, stub);

      const response = await request(app.getHttpServer())[method](path).send(body ?? {});

      expect(response.status).toBe(401);
      expect(called()).toEqual([]);
    });

    it.each(ROUTES)('rejects a customer on $name with 403', async ({ method, path, body }) => {
      app = await buildApp(CUSTOMER, stub);

      const response = await request(app.getHttpServer())[method](path).send(body ?? {});

      expect(response.status).toBe(403);
      expect(called()).toEqual([]);
    });

    it.each(ROUTES)('rejects a rider on $name with 403', async ({ method, path, body }) => {
      app = await buildApp(RIDER, stub);

      const response = await request(app.getHttpServer())[method](path).send(body ?? {});

      expect(response.status).toBe(403);
      expect(called()).toEqual([]);
    });

    /**
     * The restaurant-scoped half. A merchant of a *different* shop is stopped
     * by `RestaurantScopeGuard` before the handler runs — `@Roles('MERCHANT')`
     * alone would have let them through, which is exactly why both guards
     * exist.
     */
    it.each(ROUTES.filter((route) => route.scoped))(
      'rejects a merchant of another restaurant on $name with 403',
      async ({ method, path, body }) => {
        app = await buildApp(MERCHANT_B, stub);

        const response = await request(app.getHttpServer())[method](path).send(body ?? {});

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({
          success: false,
          error: { code: 'NOT_RESTAURANT_MEMBER' },
        });
        expect(called()).toEqual([]);
      },
    );

    /**
     * The id-keyed half. These routes carry no `restaurantId`, so
     * `RestaurantScopeGuard` cannot act and the check happens inside the
     * service — which means the *guard* must let a merchant of any shop
     * through, and the service must then refuse. Asserting the guard's
     * behaviour here keeps the two halves honest about which one is
     * responsible.
     */
    it.each(ROUTES.filter((route) => !route.scoped))(
      'lets any merchant past the guards on $name, leaving ownership to the service',
      async ({ method, path, body, name }) => {
        stub.updateCategory.mockRejectedValue(new DomainError('NOT_RESTAURANT_MEMBER'));
        stub.archiveCategory.mockRejectedValue(new DomainError('NOT_RESTAURANT_MEMBER'));
        stub.updateItem.mockRejectedValue(new DomainError('NOT_RESTAURANT_MEMBER'));
        stub.setItemAvailability.mockRejectedValue(new DomainError('NOT_RESTAURANT_MEMBER'));
        stub.archiveItem.mockRejectedValue(new DomainError('NOT_RESTAURANT_MEMBER'));
        stub.replaceOptionGroups.mockRejectedValue(new DomainError('NOT_RESTAURANT_MEMBER'));
        app = await buildApp(MERCHANT_B, stub);

        const response = await request(app.getHttpServer())[method](path).send(body ?? {});

        // 403 either way — but from the service, and only after it was reached.
        expect(response.status).toBe(403);
        expect(called()).toHaveLength(1);
        expect(name).toBeTruthy();
      },
    );
  });

  describe('identity and payload', () => {
    it('passes the path restaurantId to a scoped create, never a body field', async () => {
      stub.createCategory.mockResolvedValue({ id: CATEGORY_ID, name: 'ของหวาน' });
      app = await buildApp(MERCHANT_A, stub);

      await request(app.getHttpServer())
        .post(`/api/v1/merchant/restaurants/${RESTAURANT_ID}/menu-categories`)
        .send({ name: 'ของหวาน' })
        .expect(201);

      expect(stub.createCategory).toHaveBeenCalledWith(RESTAURANT_ID, { name: 'ของหวาน' });
    });

    it('rejects a body that tries to name its own restaurant', async () => {
      app = await buildApp(MERCHANT_A, stub);

      await request(app.getHttpServer())
        .post(`/api/v1/merchant/restaurants/${RESTAURANT_ID}/menu-categories`)
        .send({ name: 'ของหวาน', restaurantId: OTHER_RESTAURANT_ID })
        .expect(400);

      expect(stub.createCategory).not.toHaveBeenCalled();
    });

    it('passes the caller’s resolved capabilities to an id-keyed route', async () => {
      stub.updateItem.mockResolvedValue({ id: ITEM_ID });
      app = await buildApp(MERCHANT_A, stub);

      await request(app.getHttpServer())
        .patch(`/api/v1/merchant/menu-items/${ITEM_ID}`)
        .send({ name: 'x' })
        .expect(200);

      expect(stub.updateItem).toHaveBeenCalledWith(ITEM_ID, { name: 'x' }, MERCHANT_A.capabilities);
    });
  });

  describe('validation', () => {
    it.each([
      ['a negative price', { categoryId: CATEGORY_ID, name: 'x', basePriceSatang: -1 }],
      ['a fractional satang price', { categoryId: CATEGORY_ID, name: 'x', basePriceSatang: 65.5 }],
      ['a blank name', { categoryId: CATEGORY_ID, name: '   ', basePriceSatang: 100 }],
      ['a missing category', { name: 'x', basePriceSatang: 100 }],
      ['a client-supplied image url', { categoryId: CATEGORY_ID, name: 'x', basePriceSatang: 1, imageUrl: 'a.jpg' }],
    ])('rejects %s on create with 400 and never calls the service', async (_label, body) => {
      app = await buildApp(MERCHANT_A, stub);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/merchant/restaurants/${RESTAURANT_ID}/menu-items`)
        .send(body);

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
      expect(stub.createItem).not.toHaveBeenCalled();
    });

    it('rejects an empty patch — a write with nothing to write', async () => {
      app = await buildApp(MERCHANT_A, stub);

      await request(app.getHttpServer()).patch(`/api/v1/merchant/menu-items/${ITEM_ID}`).send({}).expect(400);

      expect(stub.updateItem).not.toHaveBeenCalled();
    });

    it('rejects an availability body carrying anything but the boolean', async () => {
      app = await buildApp(MERCHANT_A, stub);

      await request(app.getHttpServer())
        .patch(`/api/v1/merchant/menu-items/${ITEM_ID}/availability`)
        .send({ isAvailable: false, basePriceSatang: 1 })
        .expect(400);

      expect(stub.setItemAvailability).not.toHaveBeenCalled();
    });

    it('rejects an option group with no options', async () => {
      app = await buildApp(MERCHANT_A, stub);

      await request(app.getHttpServer())
        .put(`/api/v1/merchant/menu-items/${ITEM_ID}/option-groups`)
        .send({ groups: [{ title: 'x', minSelect: 0, maxSelect: 1, options: [] }] })
        .expect(400);

      expect(stub.replaceOptionGroups).not.toHaveBeenCalled();
    });

    it('rejects maxSelect below minSelect', async () => {
      app = await buildApp(MERCHANT_A, stub);

      await request(app.getHttpServer())
        .put(`/api/v1/merchant/menu-items/${ITEM_ID}/option-groups`)
        .send({
          groups: [
            {
              title: 'x',
              minSelect: 3,
              maxSelect: 1,
              options: [{ label: 'a', priceDeltaSatang: 0, isAvailable: true }],
            },
          ],
        })
        .expect(400);

      expect(stub.replaceOptionGroups).not.toHaveBeenCalled();
    });
  });

  describe('response rendering', () => {
    it('returns 201 for a create and 200 for everything else', async () => {
      stub.createItem.mockResolvedValue({ id: ITEM_ID });
      stub.archiveItem.mockResolvedValue({ id: ITEM_ID, archivedAt: '2026-09-01T00:00:00.000Z' });
      app = await buildApp(MERCHANT_A, stub);

      await request(app.getHttpServer())
        .post(`/api/v1/merchant/restaurants/${RESTAURANT_ID}/menu-items`)
        .send({ categoryId: CATEGORY_ID, name: 'x', basePriceSatang: 100 })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/merchant/menu-items/${ITEM_ID}/archive`)
        .expect(200);
    });

    it('renders a conflict from a populated category archive with its code intact', async () => {
      stub.archiveCategory.mockRejectedValue(
        new DomainError('CONFLICT', { details: { activeItemCount: 9 } }),
      );
      app = await buildApp(MERCHANT_A, stub);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/merchant/menu-categories/${CATEGORY_ID}/archive`)
        .expect(409);

      expect(response.body).toMatchObject({
        success: false,
        error: { code: 'CONFLICT', details: { activeItemCount: 9 } },
      });
    });

    it('carries a correlationId on an error', async () => {
      stub.reorderCategories.mockRejectedValue(new DomainError('VALIDATION_FAILED'));
      app = await buildApp(MERCHANT_A, stub);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/merchant/restaurants/${RESTAURANT_ID}/menu-categories/reorder`)
        .send({ categoryIds: [] });

      expect(response.body.error.correlationId).toEqual(expect.any(String));
    });

    it('does not leak an unexpected error', async () => {
      stub.createItem.mockRejectedValue(new Error('supabase: connection refused to db-1'));
      app = await buildApp(MERCHANT_A, stub);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/merchant/restaurants/${RESTAURANT_ID}/menu-items`)
        .send({ categoryId: CATEGORY_ID, name: 'x', basePriceSatang: 100 });

      expect(response.status).toBe(500);
      expect(JSON.stringify(response.body)).not.toContain('db-1');
    });
  });

  describe('surface', () => {
    it('exposes no read route — the merchant reads the catalog under RLS (DEC-APP-008)', async () => {
      app = await buildApp(MERCHANT_A, stub);

      await request(app.getHttpServer())
        .get(`/api/v1/merchant/restaurants/${RESTAURANT_ID}/menu-items`)
        .expect(404);
    });

    it('exposes no delete route — removal is an archive (M11-D06)', async () => {
      app = await buildApp(MERCHANT_A, stub);

      await request(app.getHttpServer()).delete(`/api/v1/merchant/menu-items/${ITEM_ID}`).expect(404);
    });
  });
});
