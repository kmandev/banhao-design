import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { HealthModule } from '../src/modules/health/health.module';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { SupabaseService } from '../src/supabase/supabase.service';

/**
 * Integration test for GET /health.
 *
 * HealthModule is imported directly rather than AppModule so the test needs no
 * real Supabase credentials — /health is @Public() and has no dependency on
 * auth. The database ping does need a client, so a double stands in for
 * `SupabaseService`: this file is about the endpoint's contract, and
 * `health.service.spec.ts` covers what the ping does with each outcome.
 */

/** A PostgREST builder is thenable; only `.then` is ever awaited here. */
function fakeSupabase(result: { error: { message: string } | null }): Partial<SupabaseService> {
  return {
    admin: {
      from: () => ({
        select: () => ({
          limit: () => Promise.resolve(result),
        }),
      }),
    } as unknown as SupabaseService['admin'],
  };
}

async function buildApp(supabase: Partial<SupabaseService>): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [HealthModule],
    providers: [{ provide: APP_INTERCEPTOR, useClass: ResponseInterceptor }],
  })
    // Replaces the definition, so the real SupabaseService constructor — which
    // calls loadServerEnv() — never runs.
    .overrideProvider(SupabaseService)
    .useValue(supabase)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  return app;
}

describe('GET /health (integration)', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  it('returns 200 with the shared success envelope', async () => {
    app = await buildApp(fakeSupabase({ error: null }));

    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({ status: 'ok', service: 'banhao-api' });
    expect(typeof response.body.data.timestamp).toBe('string');
  });

  it('reports the database ping alongside the service status', async () => {
    app = await buildApp(fakeSupabase({ error: null }));

    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(response.body.data.database.status).toBe('ok');
    expect(typeof response.body.data.database.latencyMs).toBe('number');
  });

  it('stays 200 and reports degraded when the database does not answer', async () => {
    // A failing probe must not make Cloud Run restart the instance: restarting
    // an API process does not repair a database, it only turns an outage into
    // a crash loop.
    app = await buildApp(fakeSupabase({ error: { message: 'connection refused to db-1' } }));

    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(response.body.data).toMatchObject({
      status: 'degraded',
      database: { status: 'unreachable' },
    });
  });

  it('does not leak the database error to the caller', async () => {
    app = await buildApp(fakeSupabase({ error: { message: 'connection refused to db-1' } }));

    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(JSON.stringify(response.body)).not.toContain('db-1');
  });

  it('is reachable without authentication', async () => {
    app = await buildApp(fakeSupabase({ error: null }));

    await request(app.getHttpServer()).get('/health').expect(200);
  });

  it('returns the error envelope for an unknown route', async () => {
    app = await buildApp(fakeSupabase({ error: null }));

    const response = await request(app.getHttpServer()).get('/nope').expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
