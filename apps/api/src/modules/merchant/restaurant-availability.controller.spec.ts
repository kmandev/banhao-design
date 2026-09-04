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
import { RestaurantAvailabilityController } from './restaurant-availability.controller';
import { RestaurantAvailabilityService } from './restaurant-availability.service';

/** M-13's HTTP boundary. Both real guards, a stubbed service. */

const RESTAURANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_RESTAURANT_ID = '22222222-2222-4222-8222-222222222222';
const PATH = `/api/v1/merchant/restaurants/${RESTAURANT_ID}/availability`;

function merchantOf(restaurantId: string): AuthenticatedUser {
  return {
    id: `user-${restaurantId}`,
    phone: '+66812345678',
    capabilities: { ...NO_CAPABILITIES, merchant: [{ restaurantId, memberRole: 'OWNER' }] },
  };
}

const CUSTOMER: AuthenticatedUser = {
  id: 'user-customer',
  phone: '+66899999999',
  capabilities: { ...NO_CAPABILITIES, customer: true },
};

const RESPONSE_SHAPE = {
  restaurantId: RESTAURANT_ID,
  availabilityMode: 'BUSY' as const,
  busyPrepMinutes: 20,
  updatedAt: '2026-09-04T00:00:00.000Z',
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
  setAvailability: jest.Mock,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [CorrelationModule],
    controllers: [RestaurantAvailabilityController],
    providers: [
      { provide: RestaurantAvailabilityService, useValue: { setAvailability } },
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

describe('RestaurantAvailabilityController', () => {
  let app: INestApplication;
  let setAvailability: jest.Mock;

  beforeEach(() => {
    setAvailability = jest.fn().mockResolvedValue(RESPONSE_SHAPE);
  });

  afterEach(async () => {
    await app?.close();
  });

  describe('authorization', () => {
    it('rejects an anonymous request with 401', async () => {
      app = await buildApp(null, setAvailability);

      await request(app.getHttpServer()).put(PATH).send({ mode: 'BUSY', busyPrepMinutes: 20 }).expect(401);
      expect(setAvailability).not.toHaveBeenCalled();
    });

    it('rejects a customer with 403', async () => {
      app = await buildApp(CUSTOMER, setAvailability);

      await request(app.getHttpServer()).put(PATH).send({ mode: 'BUSY', busyPrepMinutes: 20 }).expect(403);
      expect(setAvailability).not.toHaveBeenCalled();
    });

    it('rejects a merchant of another restaurant with 403', async () => {
      app = await buildApp(merchantOf(OTHER_RESTAURANT_ID), setAvailability);

      const response = await request(app.getHttpServer())
        .put(PATH)
        .send({ mode: 'BUSY', busyPrepMinutes: 20 });

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ error: { code: 'NOT_RESTAURANT_MEMBER' } });
      expect(setAvailability).not.toHaveBeenCalled();
    });
  });

  it('passes the path restaurantId, the caller id, and the parsed body to the service', async () => {
    const user = merchantOf(RESTAURANT_ID);
    app = await buildApp(user, setAvailability);

    await request(app.getHttpServer()).put(PATH).send({ mode: 'BUSY', busyPrepMinutes: 20 }).expect(200);

    expect(setAvailability).toHaveBeenCalledWith(RESTAURANT_ID, user.id, {
      mode: 'BUSY',
      busyPrepMinutes: 20,
    });
  });

  it('answers 200 with the saved availability', async () => {
    app = await buildApp(merchantOf(RESTAURANT_ID), setAvailability);

    const response = await request(app.getHttpServer())
      .put(PATH)
      .send({ mode: 'BUSY', busyPrepMinutes: 20 })
      .expect(200);

    expect(response.body).toEqual({ success: true, data: RESPONSE_SHAPE });
  });

  describe('validation', () => {
    it('accepts NORMAL with no body fields beyond mode', async () => {
      app = await buildApp(merchantOf(RESTAURANT_ID), setAvailability);

      await request(app.getHttpServer()).put(PATH).send({ mode: 'NORMAL' }).expect(200);
      expect(setAvailability).toHaveBeenCalledWith(RESTAURANT_ID, expect.any(String), { mode: 'NORMAL' });
    });

    it('accepts PAUSED with no body fields beyond mode', async () => {
      app = await buildApp(merchantOf(RESTAURANT_ID), setAvailability);

      await request(app.getHttpServer()).put(PATH).send({ mode: 'PAUSED' }).expect(200);
      expect(setAvailability).toHaveBeenCalledWith(RESTAURANT_ID, expect.any(String), { mode: 'PAUSED' });
    });

    it('rejects BUSY with no busyPrepMinutes', async () => {
      app = await buildApp(merchantOf(RESTAURANT_ID), setAvailability);

      const response = await request(app.getHttpServer()).put(PATH).send({ mode: 'BUSY' });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
      expect(setAvailability).not.toHaveBeenCalled();
    });

    it.each([25, 0, -10, 15, 100])(
      'rejects a busyPrepMinutes outside the five approved values (%d)',
      async (value) => {
        app = await buildApp(merchantOf(RESTAURANT_ID), setAvailability);

        const response = await request(app.getHttpServer())
          .put(PATH)
          .send({ mode: 'BUSY', busyPrepMinutes: value });

        expect(response.status).toBe(400);
        expect(setAvailability).not.toHaveBeenCalled();
      },
    );

    it.each([10, 20, 30, 45, 60])('accepts busyPrepMinutes = %d', async (value) => {
      app = await buildApp(merchantOf(RESTAURANT_ID), setAvailability);

      await request(app.getHttpServer()).put(PATH).send({ mode: 'BUSY', busyPrepMinutes: value }).expect(200);
    });

    it('rejects PAUSED with a busyPrepMinutes field — the union forbids it', async () => {
      app = await buildApp(merchantOf(RESTAURANT_ID), setAvailability);

      const response = await request(app.getHttpServer())
        .put(PATH)
        .send({ mode: 'PAUSED', busyPrepMinutes: 20 });

      expect(response.status).toBe(400);
      expect(setAvailability).not.toHaveBeenCalled();
    });

    it('rejects an unknown mode', async () => {
      app = await buildApp(merchantOf(RESTAURANT_ID), setAvailability);

      const response = await request(app.getHttpServer()).put(PATH).send({ mode: 'CLOSED' });

      expect(response.status).toBe(400);
      expect(setAvailability).not.toHaveBeenCalled();
    });

    it('rejects availability_set_by / setterType / any extra field — the union is strict', async () => {
      app = await buildApp(merchantOf(RESTAURANT_ID), setAvailability);

      const response = await request(app.getHttpServer())
        .put(PATH)
        .send({ mode: 'PAUSED', availabilitySetBy: 'MERCHANT' });

      expect(response.status).toBe(400);
      expect(setAvailability).not.toHaveBeenCalled();
    });
  });

  it('propagates INVALID_TRANSITION (e.g. PAUSED -> BUSY directly) as 409', async () => {
    setAvailability.mockRejectedValue(
      new DomainError('INVALID_TRANSITION', { details: { currentMode: 'PAUSED', targetMode: 'BUSY' } }),
    );
    app = await buildApp(merchantOf(RESTAURANT_ID), setAvailability);

    const response = await request(app.getHttpServer())
      .put(PATH)
      .send({ mode: 'BUSY', busyPrepMinutes: 20 });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: { code: 'INVALID_TRANSITION' } });
  });

  it('does not leak an unexpected error', async () => {
    setAvailability.mockRejectedValue(new Error('supabase: connection refused to db-1'));
    app = await buildApp(merchantOf(RESTAURANT_ID), setAvailability);

    const response = await request(app.getHttpServer())
      .put(PATH)
      .send({ mode: 'BUSY', busyPrepMinutes: 20 });

    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('db-1');
  });

  it('exposes no read route — availability is public, read straight from Supabase', async () => {
    app = await buildApp(merchantOf(RESTAURANT_ID), setAvailability);

    await request(app.getHttpServer()).get(PATH).expect(404);
  });
});
