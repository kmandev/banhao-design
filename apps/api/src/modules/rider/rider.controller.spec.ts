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
import { RolesGuard } from '../../common/guards/roles.guard';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';
import { RiderController } from './rider.controller';
import { DeliveryArrivalService } from './delivery-arrival.service';
import { DeliveryCompletionService } from './delivery-completion.service';
import { DeliveryEnRouteService } from './delivery-en-route.service';
import { DeliveryPickupService } from './delivery-pickup.service';
import { DeliveryProofService } from './delivery-proof.service';
import { DeliveryReleaseService } from './delivery-release.service';
import { OfferAcceptanceService } from './offer-acceptance.service';
import { RiderLocationService } from './rider-location.service';

/**
 * The HTTP boundary of the rider surface — the ten routes of Phases G-2…G-7.2.
 *
 * Same shape as `orders.controller.spec.ts`: every service is a plain stub,
 * because each one's behaviour is covered by its own spec. What this file
 * proves is the boundary those specs cannot see — that an anonymous or
 * non-rider caller never reaches a handler, that the rider identity a handler
 * receives is the server-verified one and never a body field, that a malformed
 * body is rejected before any service runs, and that success and every domain
 * error render through the real global filter and interceptor.
 *
 * `@Roles('RIDER')` is the rider **approval** gate (`CapabilitiesService`
 * resolves `capabilities.rider` only for `riders.status = 'APPROVED'`), so the
 * 403 cases below are the only place that gate is exercised over HTTP.
 */

const RIDER_ID = 'rider-1';
const DELIVERY_ID = '22222222-2222-4222-8222-222222222222';
const OFFER_ID = '33333333-3333-4333-8333-333333333333';

const APPROVED_RIDER: AuthenticatedUser = {
  id: 'user-rider-1',
  phone: '+66812345678',
  capabilities: {
    customer: true,
    merchant: [],
    rider: { riderId: RIDER_ID },
    platformStaff: null,
  },
};

/** A signed-in customer with no rider capability — a pending or suspended rider looks identical here. */
const NON_RIDER: AuthenticatedUser = {
  id: 'user-customer-1',
  phone: '+66899999999',
  capabilities: { customer: true, merchant: [], rider: null, platformStaff: null },
};

type ServiceStubs = {
  location: { updateLocation: jest.Mock };
  offers: { acceptOffer: jest.Mock; declineOffer: jest.Mock };
  releases: { cancelDelivery: jest.Mock };
  arrivals: { arrive: jest.Mock };
  pickups: { pickup: jest.Mock };
  departures: { startDelivery: jest.Mock };
  completions: { complete: jest.Mock };
  proofs: { requestUploadUrl: jest.Mock };
};

function makeStubs(): ServiceStubs {
  return {
    location: { updateLocation: jest.fn() },
    offers: { acceptOffer: jest.fn(), declineOffer: jest.fn() },
    releases: { cancelDelivery: jest.fn() },
    arrivals: { arrive: jest.fn() },
    pickups: { pickup: jest.fn() },
    departures: { startDelivery: jest.fn() },
    completions: { complete: jest.fn() },
    proofs: { requestUploadUrl: jest.fn() },
  };
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

async function buildApp(
  user: AuthenticatedUser | null,
  stubs: ServiceStubs,
): Promise<INestApplication> {
  // The real RolesGuard, not a fake: @Roles('RIDER') is the approval gate and
  // stubbing it would leave the thing under test unexercised.
  const guards: Provider[] = [
    { provide: APP_GUARD, useValue: fakeAuthGuard(user) },
    { provide: APP_GUARD, useClass: RolesGuard },
  ];

  const moduleRef = await Test.createTestingModule({
    imports: [CorrelationModule],
    controllers: [RiderController],
    providers: [
      { provide: RiderLocationService, useValue: stubs.location },
      { provide: OfferAcceptanceService, useValue: stubs.offers },
      { provide: DeliveryReleaseService, useValue: stubs.releases },
      { provide: DeliveryArrivalService, useValue: stubs.arrivals },
      { provide: DeliveryPickupService, useValue: stubs.pickups },
      { provide: DeliveryEnRouteService, useValue: stubs.departures },
      { provide: DeliveryCompletionService, useValue: stubs.completions },
      { provide: DeliveryProofService, useValue: stubs.proofs },
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

/**
 * Every route, with a body where the schema requires one. The order matches
 * the controller so a new route added without a test here is visible in review.
 */
const ROUTES: ReadonlyArray<{ name: string; path: string; body?: unknown }> = [
  { name: 'location', path: '/api/v1/rider/location', body: { lat: 15.1, lng: 105.2 } },
  { name: 'offer accept', path: `/api/v1/rider/offers/${OFFER_ID}/accept` },
  { name: 'offer decline', path: `/api/v1/rider/offers/${OFFER_ID}/decline` },
  { name: 'arrived', path: `/api/v1/rider/deliveries/${DELIVERY_ID}/arrived` },
  { name: 'picked-up', path: `/api/v1/rider/deliveries/${DELIVERY_ID}/picked-up` },
  { name: 'en-route', path: `/api/v1/rider/deliveries/${DELIVERY_ID}/en-route` },
  {
    name: 'proof upload-url',
    path: `/api/v1/rider/deliveries/${DELIVERY_ID}/proof/upload-url`,
    body: { contentType: 'image/jpeg' },
  },
  {
    name: 'delivered',
    path: `/api/v1/rider/deliveries/${DELIVERY_ID}/delivered`,
    body: { objectKey: `deliveries/${DELIVERY_ID}/proof.jpg` },
  },
  { name: 'cancel', path: `/api/v1/rider/deliveries/${DELIVERY_ID}/cancel`, body: {} },
];

describe('RiderController', () => {
  let app: INestApplication;
  let stubs: ServiceStubs;

  beforeEach(() => {
    stubs = makeStubs();
  });

  afterEach(async () => {
    await app?.close();
  });

  function calledServiceMethods(): string[] {
    return Object.values(stubs)
      .flatMap((service) => Object.entries(service))
      .filter(([, mock]) => (mock as jest.Mock).mock.calls.length > 0)
      .map(([method]) => method);
  }

  describe('authentication and the rider approval gate', () => {
    it.each(ROUTES)('rejects an anonymous request to $name with 401', async ({ path, body }) => {
      app = await buildApp(null, stubs);

      const response = await request(app.getHttpServer())
        .post(path)
        .send(body ?? {});

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
      expect(calledServiceMethods()).toEqual([]);
    });

    it.each(ROUTES)(
      'rejects a signed-in caller without the rider capability on $name with 403',
      async ({ path, body }) => {
        app = await buildApp(NON_RIDER, stubs);

        const response = await request(app.getHttpServer())
          .post(path)
          .send(body ?? {});

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
        expect(calledServiceMethods()).toEqual([]);
      },
    );
  });

  describe('identity', () => {
    it('passes the rider id resolved from capabilities to the location service', async () => {
      stubs.location.updateLocation.mockResolvedValue({
        riderId: RIDER_ID,
        locationUpdatedAt: '2026-09-01T00:00:00.000Z',
      });
      app = await buildApp(APPROVED_RIDER, stubs);

      await request(app.getHttpServer())
        .post('/api/v1/rider/location')
        .send({ lat: 15.1, lng: 105.2 })
        .expect(200);

      expect(stubs.location.updateLocation).toHaveBeenCalledWith(RIDER_ID, {
        lat: 15.1,
        lng: 105.2,
      });
    });

    it('passes the whole authenticated user, not a body field, to every delivery command', async () => {
      stubs.arrivals.arrive.mockResolvedValue({ deliveryId: DELIVERY_ID, state: 'AT_MERCHANT' });
      app = await buildApp(APPROVED_RIDER, stubs);

      await request(app.getHttpServer())
        .post(`/api/v1/rider/deliveries/${DELIVERY_ID}/arrived`)
        .expect(200);

      expect(stubs.arrivals.arrive).toHaveBeenCalledWith(APPROVED_RIDER, DELIVERY_ID);
    });
  });

  describe('request validation', () => {
    it('rejects a location body that names a rider, rather than ignoring the field', async () => {
      app = await buildApp(APPROVED_RIDER, stubs);

      const response = await request(app.getHttpServer())
        .post('/api/v1/rider/location')
        .send({ lat: 15.1, lng: 105.2, riderId: 'someone-else' });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        success: false,
        error: { code: 'VALIDATION_FAILED' },
      });
      expect(stubs.location.updateLocation).not.toHaveBeenCalled();
    });

    it('rejects an out-of-range coordinate', async () => {
      app = await buildApp(APPROVED_RIDER, stubs);

      await request(app.getHttpServer())
        .post('/api/v1/rider/location')
        .send({ lat: 91, lng: 105.2 })
        .expect(400);

      expect(stubs.location.updateLocation).not.toHaveBeenCalled();
    });

    it('rejects a completion with no proof key — the photo is mandatory (DEC-038)', async () => {
      app = await buildApp(APPROVED_RIDER, stubs);

      await request(app.getHttpServer())
        .post(`/api/v1/rider/deliveries/${DELIVERY_ID}/delivered`)
        .send({})
        .expect(400);

      expect(stubs.completions.complete).not.toHaveBeenCalled();
    });

    it('rejects a completion body that tries to name a bucket alongside the key', async () => {
      app = await buildApp(APPROVED_RIDER, stubs);

      await request(app.getHttpServer())
        .post(`/api/v1/rider/deliveries/${DELIVERY_ID}/delivered`)
        .send({ objectKey: 'k', bucket: 'public' })
        .expect(400);

      expect(stubs.completions.complete).not.toHaveBeenCalled();
    });

    it('accepts a cancel with no body at all — the reason is optional (DEC-021)', async () => {
      stubs.releases.cancelDelivery.mockResolvedValue({
        deliveryId: DELIVERY_ID,
        state: 'RIDER_SEARCHING',
        riderId: RIDER_ID,
      });
      app = await buildApp(APPROVED_RIDER, stubs);

      await request(app.getHttpServer())
        .post(`/api/v1/rider/deliveries/${DELIVERY_ID}/cancel`)
        .expect(200);

      expect(stubs.releases.cancelDelivery).toHaveBeenCalledWith(
        APPROVED_RIDER,
        DELIVERY_ID,
        undefined,
      );
    });

    it('trims and forwards a supplied cancellation reason', async () => {
      stubs.releases.cancelDelivery.mockResolvedValue({
        deliveryId: DELIVERY_ID,
        state: 'RIDER_SEARCHING',
        riderId: RIDER_ID,
      });
      app = await buildApp(APPROVED_RIDER, stubs);

      await request(app.getHttpServer())
        .post(`/api/v1/rider/deliveries/${DELIVERY_ID}/cancel`)
        .send({ reason: '  ยางแตก  ' })
        .expect(200);

      expect(stubs.releases.cancelDelivery).toHaveBeenCalledWith(
        APPROVED_RIDER,
        DELIVERY_ID,
        'ยางแตก',
      );
    });
  });

  describe('response rendering', () => {
    it('renders a success in the shared envelope, at 200 rather than 201', async () => {
      const result = { deliveryId: DELIVERY_ID, state: 'RIDER_ASSIGNED', riderId: RIDER_ID };
      stubs.offers.acceptOffer.mockResolvedValue(result);
      app = await buildApp(APPROVED_RIDER, stubs);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/rider/offers/${OFFER_ID}/accept`)
        .expect(200);

      expect(response.body).toEqual({ success: true, data: result });
    });

    it.each([
      ['OFFER_TAKEN', 409],
      ['OFFER_EXPIRED', 409],
      ['RIDER_HAS_ACTIVE_DELIVERY', 409],
      ['NOT_ASSIGNED_RIDER', 403],
      ['NOT_FOUND', 404],
    ] as const)('renders %s at %i with its code intact', async (code, status) => {
      stubs.offers.acceptOffer.mockRejectedValue(new DomainError(code));
      app = await buildApp(APPROVED_RIDER, stubs);

      const response = await request(app.getHttpServer()).post(
        `/api/v1/rider/offers/${OFFER_ID}/accept`,
      );

      expect(response.status).toBe(status);
      expect(response.body).toMatchObject({ success: false, error: { code } });
    });

    it('carries a correlationId on an error so the response can be traced to a log line', async () => {
      stubs.releases.cancelDelivery.mockRejectedValue(new DomainError('NOT_RELEASABLE'));
      app = await buildApp(APPROVED_RIDER, stubs);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/rider/deliveries/${DELIVERY_ID}/cancel`)
        .send({});

      expect(response.status).toBe(409);
      expect(response.body.error.correlationId).toEqual(expect.any(String));
    });

    it('does not leak an unexpected error to the client', async () => {
      stubs.pickups.pickup.mockRejectedValue(new Error('supabase: connection refused to db-1'));
      app = await buildApp(APPROVED_RIDER, stubs);

      const response = await request(app.getHttpServer()).post(
        `/api/v1/rider/deliveries/${DELIVERY_ID}/picked-up`,
      );

      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({ success: false, error: { code: 'INTERNAL_ERROR' } });
      expect(JSON.stringify(response.body)).not.toContain('db-1');
    });
  });

  describe('surface', () => {
    it('exposes no route to read offers — DEC-APP-008 has the driver app read them under RLS', async () => {
      app = await buildApp(APPROVED_RIDER, stubs);

      await request(app.getHttpServer()).get('/api/v1/rider/offers').expect(404);
    });
  });
});
