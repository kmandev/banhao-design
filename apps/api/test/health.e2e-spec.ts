import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { HealthModule } from '../src/modules/health/health.module';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { APP_INTERCEPTOR } from '@nestjs/core';

/**
 * Integration test for GET /health.
 *
 * HealthModule is imported directly rather than AppModule so the test does not
 * require real Supabase credentials — /health is @Public() and has no
 * dependency on auth.
 */
describe('GET /health (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
      providers: [{ provide: APP_INTERCEPTOR, useClass: ResponseInterceptor }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with the shared success envelope', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({ status: 'ok', service: 'banhao-api' });
    expect(typeof response.body.data.timestamp).toBe('string');
  });

  it('is reachable without authentication', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
  });

  it('returns the error envelope for an unknown route', async () => {
    const response = await request(app.getHttpServer()).get('/nope').expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
