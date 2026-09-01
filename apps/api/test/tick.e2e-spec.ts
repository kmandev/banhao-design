import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { CorrelationModule } from '../src/common/correlation/correlation.module';
import {
  CORRELATION_ID_HEADER,
  CORRELATION_ID_HEADER_LOWER,
} from '../src/common/correlation/correlation';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { TickModule } from '../src/modules/tick/tick.module';
import { TICK_SIGNATURE_HEADER } from '../src/common/guards/tick-hmac.guard';
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';
import { PaymentEventProcessingService } from '../src/modules/payments/payment-event-processing.service';
import { PaymentAttemptExpiryService } from '../src/modules/payments/payment-attempt-expiry.service';
import { DispatchService } from '../src/modules/rider/dispatch.service';
import { NoRiderEscalationService } from '../src/modules/rider/no-rider-escalation.service';
import { ProofPhotoRetentionService } from '../src/modules/rider/proof-photo-retention.service';
import { OutboxDispatchService } from '../src/modules/notifications/outbox-dispatch.service';
import { SupabaseModule } from '../src/supabase/supabase.module';
import { UsersModule } from '../src/modules/users/users.module';

const TICK_SECRET = 'e2e-test-tick-secret';

/**
 * Fixed results for the six phases `TickController` runs, so this stays a
 * **transport** test.
 *
 * Every one of these services talks to Supabase (and, for POD retention, R2).
 * Left real, they would each attempt a network call against the fake
 * `SUPABASE_URL` below on every request this file makes — slow, flaky, and
 * proving nothing about the HMAC boundary that is actually under test. Their
 * own behaviour is covered by their own unit specs; what belongs here is only
 * that a correctly signed request reaches the handler and its result is
 * serialised through the normal success envelope.
 */
const PHASE_RESULTS = {
  paymentEvents: { processed: 0, skipped: 0 },
  paymentAttemptExpiry: { expired: 0, skipped: 0 },
  dispatch: { deliveries: 0, offers: 0, expiredOffers: 0 },
  noRiderEscalation: { escalated: 0, decisionPointReached: 0, skipped: 0, failed: 0 },
  podRetention: {
    enabled: false,
    referencedCandidates: 0,
    orphanCandidates: 0,
    purged: 0,
    skipped: 0,
    failed: 0,
  },
  outboxDispatch: { claimed: 0, dispatched: 0, skipped: 0, failed: 0 },
} as const;

function sign(body: string): string {
  return createHmac('sha256', TICK_SECRET).update(Buffer.from(body, 'utf8')).digest('hex');
}

/**
 * Mirrors SupabaseAuthGuard exactly: rejects by default, honours @Public().
 * Registered globally so these tests prove /internal/tick relies on its own
 * HMAC guard rather than on the absence of a global auth guard.
 */
@Injectable()
class RejectingGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    throw new UnauthorizedException('Missing bearer token');
  }
}

/**
 * End-to-end proof of A-6: worker/tick transport is authenticated by HMAC
 * (never Supabase JWT), verifies the exact raw body, fails closed on every
 * malformed input, and stays correlated by A-4.
 *
 * A-6 originally added "…while doing nothing else", and that half is no longer
 * true: F-2b (payment events), DEC-029 (attempt expiry), G-2 (dispatch),
 * DEC-022 (no-rider escalation), DEC-039 (POD retention) and H-2 (outbox)
 * have each since attached a phase behind this same guard, deliberately and
 * by approved decision. The *transport* contract A-6 fixed is unchanged and
 * is what this file still guards — see `TickController`'s own docblock, which
 * records that `accepted: true` stays stable for a caller checking only that.
 */
describe('POST /internal/tick (integration)', () => {
  let app: INestApplication;
  const originalEnv = process.env;

  beforeAll(async () => {
    process.env = {
      ...originalEnv,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
      SUPABASE_JWT_SECRET: 'jwt',
      INTERNAL_TICK_SECRET: TICK_SECRET,
      // `TickModule` imports `RiderModule`, which imports `StorageModule` for
      // proof-of-delivery photos. `StorageService` refuses to construct
      // without a complete R2 configuration, so Nest cannot build the module
      // graph at all without these — even though the overrides below mean no
      // R2 call is ever made. Obviously-fake values, never a real credential.
      R2_ACCOUNT_ID: 'e2e-account',
      R2_ACCESS_KEY_ID: 'e2e-access-key',
      R2_SECRET_ACCESS_KEY: 'e2e-secret',
      R2_BUCKET: 'e2e-bucket',
      R2_PUBLIC_URL: 'https://example.invalid',
    };

    const moduleRef = await Test.createTestingModule({
      // `SupabaseModule` and `UsersModule` are both `@Global()`, so `AppModule`
      // importing them once is what makes `SupabaseService` and
      // `AddressesService` resolvable everywhere in production. A testing
      // module that imports `TickModule` in isolation gets no such import, and
      // the phase services' own module graphs depend on both — so they are
      // imported explicitly here.
      imports: [CorrelationModule, SupabaseModule, UsersModule, TickModule],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
        { provide: APP_GUARD, useClass: RejectingGuard },
      ],
    })
      .overrideProvider(PaymentEventProcessingService)
      .useValue({ processPendingEvents: async () => PHASE_RESULTS.paymentEvents })
      .overrideProvider(PaymentAttemptExpiryService)
      .useValue({ processExpiredAttempts: async () => PHASE_RESULTS.paymentAttemptExpiry })
      .overrideProvider(DispatchService)
      .useValue({ runDispatchRound: async () => PHASE_RESULTS.dispatch })
      .overrideProvider(NoRiderEscalationService)
      .useValue({ run: async () => PHASE_RESULTS.noRiderEscalation })
      .overrideProvider(ProofPhotoRetentionService)
      .useValue({ run: async () => PHASE_RESULTS.podRetention })
      .overrideProvider(OutboxDispatchService)
      .useValue({ dispatchPending: async () => PHASE_RESULTS.outboxDispatch })
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env = originalEnv;
  });

  const server = (): ReturnType<INestApplication['getHttpServer']> => app.getHttpServer();

  describe('authentication', () => {
    it('accepts a correctly signed request', async () => {
      const body = '{}';

      const response = await request(server())
        .post('/internal/tick')
        .type('json')
        .set(TICK_SIGNATURE_HEADER, sign(body))
        .send(body)
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: { accepted: true, ...PHASE_RESULTS },
      });
    });

    it('rejects a request with no signature at all', async () => {
      const response = await request(server())
        .post('/internal/tick')
        .type('json')
        .send('{}')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects a wrong signature', async () => {
      await request(server())
        .post('/internal/tick')
        .type('json')
        .set(TICK_SIGNATURE_HEADER, 'a'.repeat(64))
        .send('{}')
        .expect(401);
    });

    it('rejects a signature computed for a body that was then modified', async () => {
      const signatureForOriginal = sign('{"tick":1}');

      await request(server())
        .post('/internal/tick')
        .type('json')
        .set(TICK_SIGNATURE_HEADER, signatureForOriginal)
        .send('{"tick":2}')
        .expect(401);
    });

    it('relies on its own guard, not on the absence of the global auth guard', async () => {
      // The global RejectingGuard is registered for every route in this test
      // module. /internal/tick only survives because @Public() + TickHmacGuard
      // together authenticate it — proving neither one alone would suffice.
      const body = '{}';

      await request(server())
        .post('/internal/tick')
        .type('json')
        .set(TICK_SIGNATURE_HEADER, sign(body))
        .send(body)
        .expect(200);
    });
  });

  describe('response contract', () => {
    it('uses the normal success envelope, not @RawResponse()', async () => {
      const body = '{}';

      const response = await request(server())
        .post('/internal/tick')
        .type('json')
        .set(TICK_SIGNATURE_HEADER, sign(body))
        .send(body)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({ accepted: true, ...PHASE_RESULTS });
    });

    // Replaces A-6's original "never claims processing occurred". That
    // assertion (no `processed` key, no /outbox|ledger|reconcil/ anywhere in
    // the body) described a tick that ran no phases, and six approved phases
    // have since been attached — it now asserts the opposite of the intended
    // design. What survives from it, and what actually protects callers, is
    // the stability of `accepted`: `TickController` documents that a caller
    // checking only `.accepted === true` sees no change as phases are added.
    it('keeps `accepted: true` stable as the caller-facing contract', async () => {
      const body = '{}';

      const response = await request(server())
        .post('/internal/tick')
        .type('json')
        .set(TICK_SIGNATURE_HEADER, sign(body))
        .send(body)
        .expect(200);

      expect(response.body.data.accepted).toBe(true);
    });

    // Each phase reports itself separately (DEC-018: separate state domains
    // stay separately accounted for). A seventh phase attaching here should
    // fail this test until it is consciously added — that is the point.
    it('reports every tick phase result under its own key', async () => {
      const body = '{}';

      const response = await request(server())
        .post('/internal/tick')
        .type('json')
        .set(TICK_SIGNATURE_HEADER, sign(body))
        .send(body)
        .expect(200);

      expect(Object.keys(response.body.data).sort()).toEqual(
        ['accepted', ...Object.keys(PHASE_RESULTS)].sort(),
      );
    });
  });

  describe('correlation id (A-4 unaffected)', () => {
    it('generates an id for a tick request that sends none', async () => {
      const body = '{}';

      const response = await request(server())
        .post('/internal/tick')
        .type('json')
        .set(TICK_SIGNATURE_HEADER, sign(body))
        .send(body)
        .expect(200);

      expect(response.headers[CORRELATION_ID_HEADER_LOWER]).toMatch(
        /^[0-9a-f-]{36}$/,
      );
    });

    it('preserves an inbound id on success', async () => {
      const body = '{}';

      const response = await request(server())
        .post('/internal/tick')
        .type('json')
        .set(TICK_SIGNATURE_HEADER, sign(body))
        .set(CORRELATION_ID_HEADER, 'tick-success-1')
        .send(body)
        .expect(200);

      expect(response.headers[CORRELATION_ID_HEADER_LOWER]).toBe('tick-success-1');
    });

    it('preserves an inbound id on a failed authentication and matches the error body', async () => {
      const response = await request(server())
        .post('/internal/tick')
        .type('json')
        .set(CORRELATION_ID_HEADER, 'tick-fail-1')
        .send('{}')
        .expect(401);

      expect(response.headers[CORRELATION_ID_HEADER_LOWER]).toBe('tick-fail-1');
      expect(response.body.error.correlationId).toBe('tick-fail-1');
    });
  });

  describe('security', () => {
    it('never leaks the secret or the expected signature in a failure body', async () => {
      const response = await request(server())
        .post('/internal/tick')
        .type('json')
        .set(TICK_SIGNATURE_HEADER, 'a'.repeat(64))
        .send('{}')
        .expect(401);

      const body = JSON.stringify(response.body);
      expect(body).not.toContain(TICK_SECRET);
      expect(body).not.toContain(sign('{}'));
    });

    it('does not report success for a well-formed but incorrect signature', async () => {
      // Valid hex, correct length, wrong digest — the realistic attack shape.
      const almostRight = sign('{}').replace(/^./, (c) => (c === '0' ? '1' : '0'));

      await request(server())
        .post('/internal/tick')
        .type('json')
        .set(TICK_SIGNATURE_HEADER, almostRight)
        .send('{}')
        .expect(401);
    });
  });
});
