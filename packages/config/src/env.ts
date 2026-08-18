import { z } from 'zod';

/**
 * Server-side environment. Validated at startup so a misconfigured deployment
 * fails immediately and loudly rather than at the first request.
 *
 * SECURITY: `supabaseServiceRoleKey` bypasses Row Level Security. It is read
 * only here, in backend context, and must never reach a client bundle.
 * See AGENTS.md and docs/ARCHITECTURE.md.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGINS: z.string().default('http://localhost:3001'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_SECRET: z.string().min(1),

  // DEC-APP-010: authenticates POST /internal/tick (HMAC-SHA256 over the raw
  // request body — see apps/api/src/common/guards/tick-hmac.guard.ts). Never
  // sent to any client bundle; only apps/api reads it.
  INTERNAL_TICK_SECRET: z.string().min(1),

  // Cloudflare R2 (object storage) — optional at this schema's level
  // deliberately. Nothing in the API calls StorageService yet (no
  // merchant/restaurant upload endpoint exists to authorize a caller before
  // reaching it — see apps/api/src/modules/storage), so requiring these here
  // would fail every unrelated route's startup — cart, auth, payments — for a
  // feature with zero live callers. StorageService itself validates presence
  // of all five at construction time, which is where "R2 is actually needed"
  // becomes true. R2_SECRET_ACCESS_KEY must never reach a client bundle —
  // same rule as SUPABASE_SERVICE_ROLE_KEY above.
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET: z.string().min(1).optional(),
  R2_PUBLIC_URL: z.string().url().optional(),
});

export type ServerEnv = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  corsOrigins: string[];
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  supabaseJwtSecret: string;
  internalTickSecret: string;
  r2AccountId: string | undefined;
  r2AccessKeyId: string | undefined;
  r2SecretAccessKey: string | undefined;
  r2Bucket: string | undefined;
  r2PublicUrl: string | undefined;
};

export class EnvValidationError extends Error {
  constructor(issues: string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}\n\n` +
        'Copy .env.example to .env and fill in the required values.',
    );
    this.name = 'EnvValidationError';
  }
}

export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const parsed = serverEnvSchema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new EnvValidationError(issues);
  }

  const env = parsed.data;

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    supabaseUrl: env.SUPABASE_URL,
    supabaseAnonKey: env.SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseJwtSecret: env.SUPABASE_JWT_SECRET,
    internalTickSecret: env.INTERNAL_TICK_SECRET,
    r2AccountId: env.R2_ACCOUNT_ID,
    r2AccessKeyId: env.R2_ACCESS_KEY_ID,
    r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY,
    r2Bucket: env.R2_BUCKET,
    r2PublicUrl: env.R2_PUBLIC_URL,
  };
}
