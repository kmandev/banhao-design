import {
  BadRequestException,
  CanActivate,
  Controller,
  ForbiddenException,
  Get,
  INestApplication,
  Injectable,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CorrelationModule } from '../src/common/correlation/correlation.module';
import {
  CORRELATION_ID_HEADER,
  CORRELATION_ID_HEADER_LOWER,
  getCorrelationId,
} from '../src/common/correlation/correlation';
import { DomainError } from '../src/common/errors/domain-error';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';

/** Stands in for SupabaseAuthGuard: proves middleware runs before any guard. */
@Injectable()
class RejectingGuard implements CanActivate {
  canActivate(): boolean {
    throw new UnauthorizedException('Missing bearer token');
  }
}

@Controller('t')
class ProbeController {
  /** Success — the id has nowhere to live but the response header. */
  @Get('ok')
  ok(): { fine: true } {
    return { fine: true };
  }

  /** Reads the id the way a Phase E service will, with no parameter threading. */
  @Get('ctx')
  ctx(): { seen: string | undefined } {
    return { seen: getCorrelationId() };
  }

  @Get('domain')
  domain(): never {
    throw new DomainError('OFFER_TAKEN', { details: { deliveryId: 'd-1' } });
  }

  @Get('validation')
  validation(): never {
    throw new BadRequestException(['phone must be E.164']);
  }

  @Get('forbidden')
  forbidden(): never {
    throw new ForbiddenException();
  }

  @Get('boom')
  boom(): never {
    throw new Error('pg: password=hunter2 host=10.0.0.4 constraint=orders_pkey');
  }

  @Get('guarded')
  @UseGuards(RejectingGuard)
  guarded(): never {
    throw new Error('unreachable — the guard rejects first');
  }
}

/**
 * End-to-end proof that one correlation id spans the whole request lifecycle:
 * middleware → context → handler → exception → filter → response.
 *
 * The module mirrors production wiring by importing CorrelationModule rather
 * than re-registering the middleware, so the test exercises the real binding.
 */
describe('correlation id (integration)', () => {
  let app: INestApplication;
  let errorLogs: string[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CorrelationModule],
      controllers: [ProbeController],
      providers: [{ provide: APP_INTERCEPTOR, useClass: ResponseInterceptor }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    // A real listener, not just init(): several tests fire concurrent requests,
    // and supertest would otherwise race to bind an ephemeral server per call.
    await app.listen(0);
  });

  beforeEach(() => {
    errorLogs = [];
    // Nest's ConsoleLogger writes the message to stdout and the stack to
    // stderr. Capture both rather than silencing, so assertions about what
    // actually gets logged are real.
    for (const stream of [process.stdout, process.stderr] as const) {
      jest.spyOn(stream, 'write').mockImplementation((chunk: unknown): boolean => {
        errorLogs.push(String(chunk));
        return true;
      });
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = (): ReturnType<INestApplication['getHttpServer']> => app.getHttpServer();
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  describe('generation and adoption', () => {
    it('generates an id for a request that sends none', async () => {
      const response = await request(server()).get('/t/ok').expect(200);

      expect(response.headers[CORRELATION_ID_HEADER_LOWER]).toMatch(UUID_V4);
    });

    it('adopts a valid inbound id', async () => {
      const response = await request(server())
        .get('/t/ok')
        .set(CORRELATION_ID_HEADER, 'inbound-abc-123')
        .expect(200);

      expect(response.headers[CORRELATION_ID_HEADER_LOWER]).toBe('inbound-abc-123');
    });

    it('gives two requests different ids', async () => {
      const [a, b] = await Promise.all([
        request(server()).get('/t/ok'),
        request(server()).get('/t/ok'),
      ]);

      expect(a.headers[CORRELATION_ID_HEADER_LOWER]).not.toBe(b.headers[CORRELATION_ID_HEADER_LOWER]);
    });

    it('does not disturb the success envelope', async () => {
      const response = await request(server()).get('/t/ok').expect(200);

      expect(response.body).toEqual({ success: true, data: { fine: true } });
    });
  });

  describe('propagation into application code', () => {
    it('reaches a handler through async context', async () => {
      const response = await request(server())
        .get('/t/ctx')
        .set(CORRELATION_ID_HEADER, 'ctx-trace-1')
        .expect(200);

      expect(response.body.data.seen).toBe('ctx-trace-1');
    });

    it('matches the id echoed on the response header', async () => {
      const response = await request(server()).get('/t/ctx').expect(200);

      expect(response.body.data.seen).toBe(response.headers[CORRELATION_ID_HEADER_LOWER]);
    });

    it('keeps concurrent requests from seeing each other', async () => {
      const responses = await Promise.all(
        ['one', 'two', 'three', 'four'].map((id) =>
          request(server()).get('/t/ctx').set(CORRELATION_ID_HEADER, id),
        ),
      );

      expect(responses.map((r) => r.body.data.seen)).toEqual(['one', 'two', 'three', 'four']);
    });
  });

  describe('every failure class carries the id', () => {
    it.each([
      ['401 authentication', '/t/guarded', 401, 'UNAUTHORIZED'],
      ['403 authorization', '/t/forbidden', 403, 'FORBIDDEN'],
      ['404 unmatched route', '/t/nope', 404, 'NOT_FOUND'],
      ['400 validation', '/t/validation', 400, 'VALIDATION_FAILED'],
      ['409 domain error', '/t/domain', 409, 'OFFER_TAKEN'],
      ['500 unexpected', '/t/boom', 500, 'INTERNAL_ERROR'],
    ])('%s', async (_label, path, status, code) => {
      const incoming = `probe-${status}`;
      const response = await request(server())
        .get(path)
        .set(CORRELATION_ID_HEADER, incoming)
        .expect(status);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(code);
      expect(response.body.error.correlationId).toBe(incoming);
      expect(response.headers[CORRELATION_ID_HEADER_LOWER]).toBe(incoming);
    });

    it('generates an id for a failure when none was supplied', async () => {
      const response = await request(server()).get('/t/domain').expect(409);

      expect(response.body.error.correlationId).toMatch(UUID_V4);
      expect(response.headers[CORRELATION_ID_HEADER_LOWER]).toBe(
        response.body.error.correlationId,
      );
    });

    it('keeps the A-3 semantic code and details alongside the id', async () => {
      const response = await request(server()).get('/t/domain').expect(409);

      expect(response.body.error).toMatchObject({
        code: 'OFFER_TAKEN',
        details: { deliveryId: 'd-1' },
        correlationId: expect.stringMatching(UUID_V4),
      });
    });

    it('preserves validation details (A-3) unchanged', async () => {
      const response = await request(server()).get('/t/validation').expect(400);

      expect(response.body.error.details).toEqual({ issues: ['phone must be E.164'] });
    });
  });

  describe('logging', () => {
    it('logs an unexpected error against the same id the client received', async () => {
      const response = await request(server())
        .get('/t/boom')
        .set(CORRELATION_ID_HEADER, 'log-trace-9')
        .expect(500);

      expect(response.body.error.correlationId).toBe('log-trace-9');
      expect(errorLogs.join('\n')).toContain('correlationId=log-trace-9');
    });

    it('still logs the full server-side detail', async () => {
      await request(server()).get('/t/boom').expect(500);

      expect(errorLogs.join('\n')).toContain('hunter2');
    });
  });

  describe('security', () => {
    it('replaces an unsafe inbound value instead of echoing it', async () => {
      const response = await request(server())
        .get('/t/ok')
        .set(CORRELATION_ID_HEADER, 'evil value: X-Admin true')
        .expect(200);

      const echoed = response.headers[CORRELATION_ID_HEADER_LOWER];
      expect(echoed).toMatch(UUID_V4);
      expect(response.headers['x-admin']).toBeUndefined();
    });

    it('replaces an oversized id', async () => {
      const response = await request(server())
        .get('/t/ok')
        .set(CORRELATION_ID_HEADER, 'x'.repeat(2000))
        .expect(200);

      expect(response.headers[CORRELATION_ID_HEADER_LOWER]).toMatch(UUID_V4);
    });

    it('never leaks internal detail into the 500 body, only the id', async () => {
      const response = await request(server()).get('/t/boom').expect(500);
      const body = JSON.stringify(response.body);

      expect(body).not.toContain('hunter2');
      expect(body).not.toContain('10.0.0.4');
      expect(body).not.toContain('orders_pkey');
      expect(response.body.error.correlationId).toMatch(UUID_V4);
    });

    it('emits no Thai copy in any correlated error', async () => {
      for (const path of ['/t/domain', '/t/validation', '/t/boom', '/t/guarded']) {
        const response = await request(server()).get(path);

        expect(JSON.stringify(response.body)).not.toMatch(/[฀-๿]/);
      }
    });
  });
});
