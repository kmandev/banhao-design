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

  describe('PAYMENT_WEBHOOK_DEV_SECRET (optional — dev-only null-provider webhook simulator, DEC-APP-007)', () => {
    it('loads as undefined when absent', () => {
      const env = loadServerEnv(validEnv);

      expect(env.paymentWebhookDevSecret).toBeUndefined();
    });

    it('loads the value when present', () => {
      const env = loadServerEnv({ ...validEnv, PAYMENT_WEBHOOK_DEV_SECRET: 'dev-secret' });

      expect(env.paymentWebhookDevSecret).toBe('dev-secret');
    });

    it('throws when present but empty', () => {
      expect(() =>
        loadServerEnv({ ...validEnv, PAYMENT_WEBHOOK_DEV_SECRET: '' }),
      ).toThrow(EnvValidationError);
    });
  });

  describe('R2 (optional — no live caller yet)', () => {
    it('loads successfully with no R2 variables at all, as undefined', () => {
      const env = loadServerEnv(validEnv);

      expect(env.r2AccountId).toBeUndefined();
      expect(env.r2AccessKeyId).toBeUndefined();
      expect(env.r2SecretAccessKey).toBeUndefined();
      expect(env.r2Bucket).toBeUndefined();
      expect(env.r2PublicUrl).toBeUndefined();
    });

    it('loads all five when present', () => {
      const env = loadServerEnv({
        ...validEnv,
        R2_ACCOUNT_ID: 'acct-1',
        R2_ACCESS_KEY_ID: 'key-1',
        R2_SECRET_ACCESS_KEY: 'secret-1',
        R2_BUCKET: 'banhao-assets',
        R2_PUBLIC_URL: 'https://assets.banhao.app',
      });

      expect(env.r2AccountId).toBe('acct-1');
      expect(env.r2AccessKeyId).toBe('key-1');
      expect(env.r2SecretAccessKey).toBe('secret-1');
      expect(env.r2Bucket).toBe('banhao-assets');
      expect(env.r2PublicUrl).toBe('https://assets.banhao.app');
    });

    it('throws when R2_PUBLIC_URL is present but not a URL', () => {
      expect(() =>
        loadServerEnv({ ...validEnv, R2_PUBLIC_URL: 'not-a-url' }),
      ).toThrow(EnvValidationError);
    });
  });
});
