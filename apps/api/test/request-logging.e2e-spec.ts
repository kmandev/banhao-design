import { Controller, Get, INestApplication, Param } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Writable } from 'node:stream';
import request from 'supertest';
import { CorrelationModule } from '../src/common/correlation/correlation.module';
import { CORRELATION_ID_HEADER } from '../src/common/correlation/correlation';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { LoggingModule } from '../src/common/logging/logging.module';
import { JsonLogger } from '../src/common/logging/json-logger';

/**
 * The two halves of V1.1 §11 working together: one structured line per
 * request, correlated.
 *
 * Wired the way `AppModule` wires them — `CorrelationModule` then
 * `LoggingModule` — because the ordering is the whole point. A request line
 * written before the correlation middleware ran would be the one line nothing
 * can be traced from.
 */

@Controller('t')
class ProbeController {
  @Get('ok')
  ok(): { fine: true } {
    return { fine: true };
  }

  @Get('orders/:id')
  order(@Param('id') id: string): { id: string } {
    return { id };
  }

  @Get('boom')
  boom(): never {
    throw new Error('pg: password=hunter2 constraint=orders_pkey');
  }
}

describe('request logging (integration)', () => {
  let app: INestApplication;
  const written: string[] = [];

  beforeAll(async () => {
    const stream = new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        written.push(chunk.toString());
        callback();
      },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [CorrelationModule, LoggingModule],
      controllers: [ProbeController],
      providers: [{ provide: APP_INTERCEPTOR, useClass: ResponseInterceptor }],
    }).compile();

    app = moduleRef.createNestApplication({
      logger: new JsonLogger(new Set(['fatal', 'error', 'warn', 'log']), stream),
    });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    written.length = 0;
  });

  function requestLines(): Record<string, unknown>[] {
    return written
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.context === 'Request');
  }

  it('writes exactly one line for one request', async () => {
    await request(app.getHttpServer()).get('/t/ok').expect(200);

    expect(requestLines()).toHaveLength(1);
  });

  it('records method, route, status and duration at INFO', async () => {
    await request(app.getHttpServer()).get('/t/ok').expect(200);

    const line = requestLines()[0];
    expect(line?.severity).toBe('INFO');
    expect(String(line?.message)).toMatch(/^GET \/t\/ok 200 \d+\.\dms$/);
  });

  it('carries the correlation id the client supplied, matching the response header', async () => {
    const response = await request(app.getHttpServer())
      .get('/t/ok')
      .set(CORRELATION_ID_HEADER, 'trace-req-1')
      .expect(200);

    expect(response.headers[CORRELATION_ID_HEADER.toLowerCase()]).toBe('trace-req-1');
    expect(requestLines()[0]?.correlationId).toBe('trace-req-1');
  });

  it('logs the route pattern, so lines group by operation and no id is written', async () => {
    await request(app.getHttpServer()).get('/t/orders/order-42').expect(200);

    const message = String(requestLines()[0]?.message);
    expect(message).toContain('/t/orders/:id');
    expect(message).not.toContain('order-42');
  });

  it('logs the literal path of an unmatched route, which has no pattern', async () => {
    await request(app.getHttpServer()).get('/nope').expect(404);

    expect(String(requestLines()[0]?.message)).toContain('GET /nope 404');
  });

  it('records a 4xx as a warning, not an error', async () => {
    await request(app.getHttpServer()).get('/nope').expect(404);

    expect(requestLines()[0]?.severity).toBe('WARNING');
  });

  it('records a 5xx as an error', async () => {
    await request(app.getHttpServer()).get('/t/boom').expect(500);

    expect(requestLines()[0]?.severity).toBe('ERROR');
  });

  it('never puts an internal detail in the request line', async () => {
    await request(app.getHttpServer()).get('/t/boom').expect(500);

    const message = String(requestLines()[0]?.message);
    expect(message).not.toContain('hunter2');
    expect(message).not.toContain('orders_pkey');
  });
});
