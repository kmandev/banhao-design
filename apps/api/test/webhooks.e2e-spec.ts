import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CorrelationModule } from '../src/common/correlation/correlation.module';
import {
  CORRELATION_ID_HEADER,
  CORRELATION_ID_HEADER_LOWER,
} from '../src/common/correlation/correlation';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { WebhooksModule } from '../src/modules/webhooks/webhooks.module';
import { PAYMENT_PROVIDER } from '../src/modules/payments/payment-provider.interface';
import type { PaymentProvider, WebhookVerification } from '../src/modules/payments/payment-provider.interface';
import { IS_PUBLIC_KEY, Public } from '../src/common/decorators/public.decorator';
import { SupabaseModule } from '../src/supabase/supabase.module';
import { SupabaseService } from '../src/supabase/supabase.service';

/** A recording double so tests can assert exactly what the controller forwarded. */
class RecordingProvider implements PaymentProvider {
  readonly name = 'recording';
  received: { rawBody: string; headers: Record<string, string> }[] = [];
  private nextResult: WebhookVerification = { verified: false, reason: 'default' };

  setNextResult(result: WebhookVerification): void {
    this.nextResult = result;
  }

  createPayment(): never {
    throw new Error('not used by A-5');
  }

  refund(): never {
    throw new Error('not used by A-5');
  }

  verifyWebhookSignature(rawBody: string, headers: Record<string, string>): WebhookVerification {
    this.received.push({ rawBody, headers });
    return this.nextResult;
  }
}

/**
 * Global auth-guard double that honours @Public() exactly like
 * SupabaseAuthGuard: rejects by default, opts out via the same metadata key.
 * Registered as APP_GUARD so it applies to the webhook route too — the point
 * of these tests is proving @Public() (not a hand-picked exemption) is what
 * lets the webhook through.
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

@Controller('probe')
class ProbeController {
  @Get('protected')
  protectedRoute(): never {
    throw new Error('unreachable — the global guard rejects first');
  }

  @Get('public')
  @Public()
  publicRoute(): { ok: true } {
    return { ok: true };
  }
}

/**
 * Minimal `SupabaseService` double for the one thing this controller does with
 * it: `persistEvent`'s `payment_events` INSERT (F-2a).
 *
 * When these tests were written the controller wrote nothing on a verified
 * webhook, so no double was needed. It now records the event, and with the
 * real service pointed at a fake `SUPABASE_URL` every success-path test would
 * 500 on a failed network write. This records the insert instead, so the
 * success path both works and stays assertable.
 */
class FakeSupabaseService {
  inserted: Record<string, unknown>[] = [];

  readonly admin = {
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        if (table === 'payment_events') {
          this.inserted.push(row);
        }
        return { error: null };
      },
    }),
  };
}

/**
 * End-to-end proof of DEC-APP-005: raw body reaches the provider byte-for-byte,
 * the webhook route needs no Authorization, its response bypasses the global
 * envelope, and everything from A-2/A-3/A-4 keeps working around it.
 */
describe('POST /webhooks/payments/:provider (integration)', () => {
  let app: INestApplication;
  let provider: RecordingProvider;
  let supabase: FakeSupabaseService;
  const originalEnv = process.env;

  beforeAll(async () => {
    provider = new RecordingProvider();
    supabase = new FakeSupabaseService();

    // `WebhooksModule` pulls in `PaymentsModule`, whose `PaymentsService`
    // needs `SupabaseService`, which refuses to construct without a Supabase
    // configuration. Obviously-fake values: the real provider is overridden
    // below and no Supabase call is made by any test in this file.
    process.env = {
      ...originalEnv,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
      SUPABASE_JWT_SECRET: 'jwt',
      INTERNAL_TICK_SECRET: 'e2e-tick-secret-unused-here',
    };

    const moduleRef = await Test.createTestingModule({
      // `SupabaseModule` is `@Global()`; `AppModule` importing it once is what
      // makes `SupabaseService` resolvable in production. A testing module
      // built from `WebhooksModule` alone gets no such import.
      imports: [CorrelationModule, SupabaseModule, WebhooksModule],
      controllers: [ProbeController],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
        { provide: APP_GUARD, useClass: RejectingGuard },
      ],
    })
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(provider)
      .overrideProvider(SupabaseService)
      .useValue(supabase)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  beforeEach(() => {
    provider.received = [];
    provider.setNextResult({ verified: false, reason: 'default' });
    supabase.inserted = [];
  });

  afterAll(async () => {
    await app.close();
    process.env = originalEnv;
  });

  const server = (): ReturnType<INestApplication['getHttpServer']> => app.getHttpServer();

  describe('raw body bootstrap', () => {
    it('delivers the exact bytes to the provider, not a reparsed JSON string', async () => {
      // Irregular formatting a JSON.parse → JSON.stringify round trip would
      // normalise: extra spaces, unordered keys, a trailing space before '}'.
      const raw = '{"b":1,  "a":2, "note":"line1\\nline2"  }';
      provider.setNextResult({ verified: false, reason: 'x' });

      await request(server())
        .post('/webhooks/payments/null')
        .set('Content-Type', 'application/json')
        .send(raw)
        .expect(401);

      expect(provider.received).toHaveLength(1);
      expect(provider.received.at(0)?.rawBody).toBe(raw);
    });

    it('preserves whitespace and key order exactly at the byte level', async () => {
      const raw = '{   "z":true,"a":false   }';

      await request(server()).post('/webhooks/payments/null').type('json').send(raw).expect(401);

      const forwarded = provider.received.at(-1)?.rawBody;
      expect(forwarded).toBe(raw);
      // A parse+reserialize would have produced this instead — proving the
      // controller did NOT do that.
      expect(forwarded).not.toBe(JSON.stringify(JSON.parse(raw)));
    });

    it('still parses JSON normally on an unrelated, non-webhook route', async () => {
      // Enabling rawBody must not disable ordinary body parsing elsewhere.
      await request(server()).get('/probe/public').expect(200);
    });
  });

  describe('public access', () => {
    it('is reachable without an Authorization header', async () => {
      await request(server())
        .post('/webhooks/payments/null')
        .send('{}')
        .type('json')
        .expect((res) => {
          // 401 here is a signature-verification failure, not an
          // authentication failure — no WWW-Authenticate-style rejection
          // before the handler even ran.
          expect(res.status).toBe(401);
        });

      expect(provider.received).toHaveLength(1);
    });

    it('leaves an unrelated protected route protected', async () => {
      await request(server()).get('/probe/protected').expect(401);
    });
  });

  describe('response envelope exclusion (DEC-APP-005)', () => {
    it('does not wrap a successful webhook response in { success, data }', async () => {
      provider.setNextResult({
        verified: true,
        providerPaymentId: 'p-1',
        // DEC-028's idempotency anchor — `payment_events.provider_event_id`.
        // Required by `WebhookVerification` since F-2b; these stubs predate it.
        providerEventId: 'evt-1',
        providerEvent: 'payment.succeeded',
        rawPayload: {},
      });

      const response = await request(server())
        .post('/webhooks/payments/null')
        .send('{}')
        .type('json')
        .expect(200);

      expect(response.body).toEqual({ received: true });
      expect(response.body).not.toHaveProperty('success');
    });

    it('keeps the envelope on an ordinary route (scoped exclusion)', async () => {
      const response = await request(server()).get('/probe/public').expect(200);

      expect(response.body).toEqual({ success: true, data: { ok: true } });
    });
  });

  describe('signature verification — fail closed', () => {
    it('rejects with 401 when the provider reports verified: false', async () => {
      provider.setNextResult({ verified: false, reason: 'bad signature' });

      const response = await request(server())
        .post('/webhooks/payments/null')
        .send('{}')
        .type('json')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('does not report success for a well-formed but bogus/attacker payload', async () => {
      // Syntactically valid JSON is a more realistic attack shape than broken
      // syntax — a real webhook body is almost always well-formed, since it's
      // the SIGNATURE that must fail, not the parser.
      const raw = '{"event":"payment.succeeded","amount":999999,"forged":true}';
      provider.setNextResult({ verified: false, reason: 'signature mismatch' });

      const response = await request(server())
        .post('/webhooks/payments/null')
        .type('json')
        .send(raw)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(provider.received.at(-1)?.rawBody).toBe(raw);
    });

    it('sends an empty raw body (never undefined-as-trusted) for a content-type body-parser does not buffer', async () => {
      // No registered parser (json/urlencoded) matches text/plain, so Nest
      // never populates req.rawBody for it — real Express/body-parser
      // behaviour, not something the controller controls. The controller must
      // still fail closed rather than treat the absence of a body as success.
      provider.setNextResult({ verified: false, reason: 'no body' });

      const response = await request(server())
        .post('/webhooks/payments/null')
        .set('Content-Type', 'text/plain')
        .send('not even json {{{')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(provider.received.at(-1)?.rawBody).toBe('');
    });
  });

  describe('correlation id (A-4 unaffected)', () => {
    it('generates an id for a webhook request that sends none', async () => {
      provider.setNextResult({ verified: false, reason: 'x' });

      const response = await request(server())
        .post('/webhooks/payments/null')
        .send('{}')
        .type('json')
        .expect(401);

      expect(response.headers[CORRELATION_ID_HEADER_LOWER]).toMatch(
        /^[0-9a-f-]{36}$/,
      );
      expect(response.body.error.correlationId).toBe(response.headers[CORRELATION_ID_HEADER_LOWER]);
    });

    it('adopts an inbound id and echoes it, including through a webhook failure', async () => {
      provider.setNextResult({ verified: false, reason: 'x' });

      const response = await request(server())
        .post('/webhooks/payments/null')
        .set(CORRELATION_ID_HEADER, 'webhook-trace-1')
        .send('{}')
        .type('json')
        .expect(401);

      expect(response.headers[CORRELATION_ID_HEADER_LOWER]).toBe('webhook-trace-1');
      expect(response.body.error.correlationId).toBe('webhook-trace-1');
    });

    it('carries the header on a successful (raw, unwrapped) webhook response too', async () => {
      provider.setNextResult({
        verified: true,
        providerPaymentId: 'p-1',
        // DEC-028's idempotency anchor — `payment_events.provider_event_id`.
        // Required by `WebhookVerification` since F-2b; these stubs predate it.
        providerEventId: 'evt-1',
        providerEvent: 'payment.succeeded',
        rawPayload: {},
      });

      const response = await request(server())
        .post('/webhooks/payments/null')
        .set(CORRELATION_ID_HEADER, 'webhook-success-1')
        .send('{}')
        .type('json')
        .expect(200);

      expect(response.headers[CORRELATION_ID_HEADER_LOWER]).toBe('webhook-success-1');
      expect(response.body).toEqual({ received: true });
    });
  });

  describe('security', () => {
    it('never leaks provider secrets or headers into the error body', async () => {
      provider.setNextResult({ verified: false, reason: 'bad signature' });

      const response = await request(server())
        .post('/webhooks/payments/null')
        .set('X-Signature', 'super-secret-signature-value')
        .send('{"amount":500000}')
        .type('json')
        .expect(401);

      const body = JSON.stringify(response.body);
      expect(body).not.toContain('super-secret-signature-value');
    });

    it('does not report success for an unsigned/empty body', async () => {
      provider.setNextResult({ verified: false, reason: 'empty' });

      await request(server()).post('/webhooks/payments/null').expect(401);
    });
  });
});
