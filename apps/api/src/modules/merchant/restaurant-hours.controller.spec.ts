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
import { RestaurantHoursController } from './restaurant-hours.controller';
import { RestaurantHoursService } from './restaurant-hours.service';

/** M-12's HTTP boundary. Both real guards, a stubbed service. */

const RESTAURANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_RESTAURANT_ID = '22222222-2222-4222-8222-222222222222';
const PATH = `/api/v1/merchant/restaurants/${RESTAURANT_ID}/hours`;

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

const VALID_WEEK = {
  days: [
    { dayOfWeek: 1, intervals: [{ opensAt: '08:00', closesAt: '20:00' }] },
    {
      dayOfWeek: 6,
      intervals: [
        { opensAt: '07:00', closesAt: '13:00' },
        { opensAt: '16:00', closesAt: '20:00' },
      ],
    },
  ],
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
  replaceHours: jest.Mock,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [CorrelationModule],
    controllers: [RestaurantHoursController],
    providers: [
      { provide: RestaurantHoursService, useValue: { replaceHours } },
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

describe('RestaurantHoursController', () => {
  let app: INestApplication;
  let replaceHours: jest.Mock;

  beforeEach(() => {
    replaceHours = jest.fn().mockResolvedValue({ restaurantId: RESTAURANT_ID, days: [] });
  });

  afterEach(async () => {
    await app?.close();
  });

  describe('authorization', () => {
    it('rejects an anonymous request with 401', async () => {
      app = await buildApp(null, replaceHours);

      await request(app.getHttpServer()).put(PATH).send(VALID_WEEK).expect(401);
      expect(replaceHours).not.toHaveBeenCalled();
    });

    it('rejects a customer with 403', async () => {
      app = await buildApp(CUSTOMER, replaceHours);

      await request(app.getHttpServer()).put(PATH).send(VALID_WEEK).expect(403);
      expect(replaceHours).not.toHaveBeenCalled();
    });

    it('rejects a merchant of another restaurant with 403', async () => {
      app = await buildApp(merchantOf(OTHER_RESTAURANT_ID), replaceHours);

      const response = await request(app.getHttpServer()).put(PATH).send(VALID_WEEK);

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ error: { code: 'NOT_RESTAURANT_MEMBER' } });
      expect(replaceHours).not.toHaveBeenCalled();
    });
  });

  it('passes the path restaurantId and the parsed week to the service', async () => {
    app = await buildApp(merchantOf(RESTAURANT_ID), replaceHours);

    await request(app.getHttpServer()).put(PATH).send(VALID_WEEK).expect(200);

    expect(replaceHours).toHaveBeenCalledWith(RESTAURANT_ID, VALID_WEEK);
  });

  it('answers 200, not 201 — this replaces a resource rather than creating one', async () => {
    app = await buildApp(merchantOf(RESTAURANT_ID), replaceHours);

    const response = await request(app.getHttpServer()).put(PATH).send({ days: [] }).expect(200);

    expect(response.body).toEqual({ success: true, data: { restaurantId: RESTAURANT_ID, days: [] } });
  });

  describe('validation', () => {
    it.each([
      ['a day outside 0–6', { days: [{ dayOfWeek: 7, intervals: [] }] }],
      ['a negative day', { days: [{ dayOfWeek: -1, intervals: [] }] }],
      [
        'a 12-hour time',
        { days: [{ dayOfWeek: 1, intervals: [{ opensAt: '8:00am', closesAt: '20:00' }] }] },
      ],
      [
        'a time with seconds',
        { days: [{ dayOfWeek: 1, intervals: [{ opensAt: '08:00:00', closesAt: '20:00' }] }] },
      ],
      [
        'an invented isClosed flag',
        { days: [{ dayOfWeek: 1, intervals: [], isClosed: true }] },
      ],
      [
        'the same day twice',
        {
          days: [
            { dayOfWeek: 1, intervals: [{ opensAt: '08:00', closesAt: '12:00' }] },
            { dayOfWeek: 1, intervals: [{ opensAt: '13:00', closesAt: '20:00' }] },
          ],
        },
      ],
    ])('rejects %s with 400 and never calls the service', async (_label, body) => {
      app = await buildApp(merchantOf(RESTAURANT_ID), replaceHours);

      const response = await request(app.getHttpServer()).put(PATH).send(body);

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
      expect(replaceHours).not.toHaveBeenCalled();
    });

    it('accepts a week where every day is closed', async () => {
      app = await buildApp(merchantOf(RESTAURANT_ID), replaceHours);

      await request(app.getHttpServer())
        .put(PATH)
        .send({ days: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, intervals: [] })) })
        .expect(200);
    });
  });

  it('renders a rejected week with its per-interval details intact', async () => {
    // The UI needs to know *which* interval, to move focus to it.
    replaceHours.mockRejectedValue(
      new DomainError('VALIDATION_FAILED', {
        details: { intervals: [{ dayOfWeek: 5, intervalIndex: 0, code: 'OVERNIGHT_UNSUPPORTED' }] },
      }),
    );
    app = await buildApp(merchantOf(RESTAURANT_ID), replaceHours);

    const response = await request(app.getHttpServer()).put(PATH).send(VALID_WEEK).expect(400);

    expect(response.body.error.details).toEqual({
      intervals: [{ dayOfWeek: 5, intervalIndex: 0, code: 'OVERNIGHT_UNSUPPORTED' }],
    });
  });

  it('does not leak an unexpected error', async () => {
    replaceHours.mockRejectedValue(new Error('supabase: connection refused to db-1'));
    app = await buildApp(merchantOf(RESTAURANT_ID), replaceHours);

    const response = await request(app.getHttpServer()).put(PATH).send(VALID_WEEK);

    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('db-1');
  });

  it('exposes no read route — the merchant reads their hours under RLS', async () => {
    app = await buildApp(merchantOf(RESTAURANT_ID), replaceHours);

    await request(app.getHttpServer()).get(PATH).expect(404);
  });
});
