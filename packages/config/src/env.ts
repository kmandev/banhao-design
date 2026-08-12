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
  };
}
