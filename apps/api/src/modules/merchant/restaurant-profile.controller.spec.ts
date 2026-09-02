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
import { RestaurantProfileController } from './restaurant-profile.controller';
import { RestaurantProfileService } from './restaurant-profile.service';

/** M-10's HTTP boundary. Both real guards, a stubbed service. */

const RESTAURANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_RESTAURANT_ID = '22222222-2222-4222-8222-222222222222';
const PATH = `/api/v1/merchant/restaurants/${RESTAURANT_ID}/profile`;

function merchantOf(restaurantId: string): AuthenticatedUser {
  return {
    id: `user-${restaurantId}`,
    phone: '+66812345678',
    capabilities: { ...NO_CAPABILITIES, merchant: [{ restaurantId, memberRole: 'OWNER' }] },
  };
}

function staffOf(restaurantId: string): AuthenticatedUser {
  return {
    id: `staff-${restaurantId}`,
    phone: '+66822223333',
    capabilities: { ...NO_CAPABILITIES, merchant: [{ restaurantId, memberRole: 'STAFF' }] },
  };
}

const CUSTOMER: AuthenticatedUser = {
  id: 'user-customer',
  phone: '+66899999999',
  capabilities: { ...NO_CAPABILITIES, customer: true },
};

const VALID_PROFILE = {
  name: 'ร้านตามสั่งป้าสมร',
  description: 'ร้านก๋วยเตี๋ยวเรือและอาหารไทยตามสั่ง',
  phone: '081-234-5678',
  addressLine: '123 ถ.สถลมาร์ค ต.บุณฑริก อ.บุณฑริก จ.อุบลราชธานี 34230',
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

async function buildApp(
  user: AuthenticatedUser | null,
  updateProfile: jest.Mock,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [CorrelationModule],
    controllers: [RestaurantProfileController],
    providers: [
      { provide: RestaurantProfileService, useValue: { updateProfile } },
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

describe('RestaurantProfileController', () => {
  let app: INestApplication;
  let updateProfile: jest.Mock;

  beforeEach(() => {
    updateProfile = jest.fn().mockResolvedValue({
      restaurantId: RESTAURANT_ID,
      ...VALID_PROFILE,
      updatedAt: '2026-09-02T00:00:00.000Z',
    });
  });

  afterEach(async () => {
    await app?.close();
  });

  describe('authorization', () => {
    it('rejects an anonymous request with 401', async () => {
      app = await buildApp(null, updateProfile);

      await request(app.getHttpServer()).put(PATH).send(VALID_PROFILE).expect(401);
      expect(updateProfile).not.toHaveBeenCalled();
    });

    it('rejects a customer with 403', async () => {
      app = await buildApp(CUSTOMER, updateProfile);

      await request(app.getHttpServer()).put(PATH).send(VALID_PROFILE).expect(403);
      expect(updateProfile).not.toHaveBeenCalled();
    });

    it('rejects a merchant of another restaurant with 403', async () => {
      app = await buildApp(merchantOf(OTHER_RESTAURANT_ID), updateProfile);

      const response = await request(app.getHttpServer()).put(PATH).send(VALID_PROFILE);

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ error: { code: 'NOT_RESTAURANT_MEMBER' } });
      expect(updateProfile).not.toHaveBeenCalled();
    });

    it('allows a STAFF member of this restaurant — @RestaurantScope() does not narrow by role (M10-Q-05)', async () => {
      app = await buildApp(staffOf(RESTAURANT_ID), updateProfile);

      await request(app.getHttpServer()).put(PATH).send(VALID_PROFILE).expect(200);
      expect(updateProfile).toHaveBeenCalledWith(RESTAURANT_ID, VALID_PROFILE);
    });
  });

  it('passes the path restaurantId and the parsed body to the service', async () => {
    app = await buildApp(merchantOf(RESTAURANT_ID), updateProfile);

    await request(app.getHttpServer()).put(PATH).send(VALID_PROFILE).expect(200);

    expect(updateProfile).toHaveBeenCalledWith(RESTAURANT_ID, VALID_PROFILE);
  });

  it('answers 200, not 201 — this replaces a resource rather than creating one', async () => {
    app = await buildApp(merchantOf(RESTAURANT_ID), updateProfile);

    const response = await request(app.getHttpServer()).put(PATH).send(VALID_PROFILE).expect(200);

    expect(response.body).toEqual({
      success: true,
      data: { restaurantId: RESTAURANT_ID, ...VALID_PROFILE, updatedAt: '2026-09-02T00:00:00.000Z' },
    });
  });

  describe('validation', () => {
    it('rejects an empty name with 400 and never calls the service', async () => {
      app = await buildApp(merchantOf(RESTAURANT_ID), updateProfile);

      const response = await request(app.getHttpServer())
        .put(PATH)
        .send({ ...VALID_PROFILE, name: '' });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
      expect(updateProfile).not.toHaveBeenCalled();
    });

    it('rejects a missing name field', async () => {
      app = await buildApp(merchantOf(RESTAURANT_ID), updateProfile);
      const { name: _name, ...withoutName } = VALID_PROFILE;

      const response = await request(app.getHttpServer()).put(PATH).send(withoutName);

      expect(response.status).toBe(400);
      expect(updateProfile).not.toHaveBeenCalled();
    });

    it.each([
      ['status', { status: 'SUSPENDED' }],
      ['lat', { lat: 15.19 }],
      ['lng', { lng: 105.08 }],
      ['merchantId', { merchantId: 'someone-elses-merchant' }],
      ['cuisine', { cuisine: 'อาหารไทย' }],
      ['imageUrl', { imageUrl: 'restaurants/x/cover.jpg' }],
    ])('rejects a protected/unsupported field (%s) with 400 and never calls the service', async (_label, extra) => {
      app = await buildApp(merchantOf(RESTAURANT_ID), updateProfile);

      const response = await request(app.getHttpServer())
        .put(PATH)
        .send({ ...VALID_PROFILE, ...extra });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
      expect(updateProfile).not.toHaveBeenCalled();
    });

    it('accepts empty description, phone and addressLine', async () => {
      app = await buildApp(merchantOf(RESTAURANT_ID), updateProfile);

      await request(app.getHttpServer())
        .put(PATH)
        .send({ name: 'ร้านตามสั่งป้าสมร', description: '', phone: '', addressLine: '' })
        .expect(200);
    });
  });

  it('does not leak an unexpected error', async () => {
    updateProfile.mockRejectedValue(new Error('supabase: connection refused to db-1'));
    app = await buildApp(merchantOf(RESTAURANT_ID), updateProfile);

    const response = await request(app.getHttpServer()).put(PATH).send(VALID_PROFILE);

    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('db-1');
  });

  it('exposes no read route — the merchant reads their profile under RLS', async () => {
    app = await buildApp(merchantOf(RESTAURANT_ID), updateProfile);

    await request(app.getHttpServer()).get(PATH).expect(404);
  });
});
