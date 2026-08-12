import { loadServerEnv, EnvValidationError } from './env';

const validEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_JWT_SECRET: 'jwt-secret',
  INTERNAL_TICK_SECRET: 'tick-secret',
};

describe('loadServerEnv', () => {
  it('loads a valid environment and applies defaults', () => {
    const env = loadServerEnv(validEnv);

    expect(env.nodeEnv).toBe('development');
    expect(env.port).toBe(3000);
    expect(env.supabaseUrl).toBe('https://example.supabase.co');
  });

  it('splits CORS_ORIGINS into a trimmed list', () => {
    const env = loadServerEnv({
      ...validEnv,
      CORS_ORIGINS: 'http://localhost:3001, https://admin.banhao.app',
    });

    expect(env.corsOrigins).toEqual(['http://localhost:3001', 'https://admin.banhao.app']);
  });

  it('throws when a required Supabase value is missing', () => {
    const { SUPABASE_JWT_SECRET: _omitted, ...incomplete } = validEnv;

    expect(() => loadServerEnv(incomplete)).toThrow(EnvValidationError);
  });

  it('loads INTERNAL_TICK_SECRET (DEC-APP-010)', () => {
    const env = loadServerEnv(validEnv);

    expect(env.internalTickSecret).toBe('tick-secret');
  });

  it('throws when INTERNAL_TICK_SECRET is missing', () => {
    const { INTERNAL_TICK_SECRET: _omitted, ...incomplete } = validEnv;

    expect(() => loadServerEnv(incomplete)).toThrow(EnvValidationError);
  });

  it('throws when INTERNAL_TICK_SECRET is empty', () => {
    expect(() => loadServerEnv({ ...validEnv, INTERNAL_TICK_SECRET: '' })).toThrow(
      EnvValidationError,
    );
  });

  it('throws when SUPABASE_URL is not a URL', () => {
    expect(() => loadServerEnv({ ...validEnv, SUPABASE_URL: 'not-a-url' })).toThrow(
      EnvValidationError,
    );
  });
});
