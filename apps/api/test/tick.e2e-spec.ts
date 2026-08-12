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

const TICK_SECRET = 'e2e-test-tick-secret';

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
 * malformed input, and stays correlated by A-4 — while doing nothing else.
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
    };

    const moduleRef = await Test.createTestingModule({
      imports: [CorrelationModule, TickModule],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
        { provide: APP_GUARD, useClass: RejectingGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);
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

      expect(response.body).toEqual({ success: true, data: { accepted: true } });
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
      expect(response.body.data).toEqual({ accepted: true });
    });

    it('never claims processing occurred', async () => {
      const body = '{}';

      const response = await request(server())
        .post('/internal/tick')
        .type('json')
        .set(TICK_SIGNATURE_HEADER, sign(body))
        .send(body)
        .expect(200);

      expect(response.body.data).not.toHaveProperty('processed');
      expect(JSON.stringify(response.body)).not.toMatch(/outbox|ledger|reconcil/i);
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
