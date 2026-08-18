import { Test } from '@nestjs/testing';

/**
 * `SupabaseService` must be resolvable through the **real** NestJS container,
 * not merely constructible with `new`.
 *
 * This exists because a previous task shipped a service whose unit tests all
 * passed while the DI container could not construct it at all (a `type`-only
 * constructor parameter is not a resolvable token) — a gap `new Service()`
 * tests are structurally blind to. `SupabaseService` is the authentication
 * gate for every protected route, so a DI failure here would take down the
 * whole API.
 *
 * `@supabase/supabase-js` is mocked so no real client is created; everything
 * else — module wiring, provider resolution, lifecycle hooks — is real.
 */

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({})),
}));

import { SupabaseModule } from './supabase.module';
import { SupabaseService } from './supabase.service';

const REQUIRED_ENV = {
  SUPABASE_URL: 'https://test-project.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_JWT_SECRET: 'jwt-secret',
  INTERNAL_TICK_SECRET: 'tick-secret',
};

describe('SupabaseModule — real NestJS dependency injection', () => {
  const original = { ...process.env };

  beforeEach(() => {
    Object.assign(process.env, REQUIRED_ENV);
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it('resolves SupabaseService through the container', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [SupabaseModule] }).compile();

    const service = moduleRef.get(SupabaseService);
    expect(service).toBeInstanceOf(SupabaseService);

    await moduleRef.close();
  });

  it('the container-resolved instance can verify a token (rejecting a bad one)', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [SupabaseModule] }).compile();
    const service = moduleRef.get(SupabaseService);

    // Proves the JWKS resolver was actually built during construction — a
    // half-constructed service would throw here rather than return null.
    await expect(service.verifyAccessToken('not-a-jwt')).resolves.toBeNull();

    await moduleRef.close();
  });

  it('initialises through its lifecycle hook without throwing', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [SupabaseModule] }).compile();
    const app = moduleRef.createNestApplication();

    await expect(app.init()).resolves.toBeDefined();

    await app.close();
  });
});
