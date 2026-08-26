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

  // DEC-APP-007: the dev-only signing key for NullPaymentProvider's webhook
  // simulator (HMAC-SHA256 over the raw webhook body — same pattern as
  // INTERNAL_TICK_SECRET above). Optional at this schema's level so
  // production never needs it defined; NullPaymentProvider's own constructor
  // refuses to start if this happens to be set while NODE_ENV=production —
  // the startup assertion DEC-APP-007 requires. Never sent to any client
  // bundle; only apps/api reads it, and only in development.
  PAYMENT_WEBHOOK_DEV_SECRET: z.string().min(1).optional(),

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

  // The PRIVATE bucket — delivery proof photos (POD, G-7.2 Phase 2) and
  // nothing else. Separate from R2_BUCKET because public access in R2 is a
  // BUCKET-level setting: R2_PUBLIC_URL is an *.r2.dev development domain,
  // which makes every object in R2_BUCKET readable by anyone holding its key.
  // A proof photo shows a customer's doorway and is personal data under PDPA
  // (Q-012), so it must live where no public base URL exists at all rather
  // than relying on a random key being unguessable. Two buckets cost nothing
  // extra — R2 bills stored bytes and operations, never buckets.
  //
  // Optional here for the same reason the five above are: only the POD
  // endpoints need it, and StorageService raises StorageConfigError at the
  // point of use rather than failing every unrelated route's startup. There
  // is deliberately NO R2_PRIVATE_PUBLIC_URL — a private object is only ever
  // reachable through a short-lived signed URL the API mints per request.
  R2_PRIVATE_BUCKET: z.string().min(1).optional(),

  // DEC-039 — the POD proof-photo retention purge's operational on/off
  // switch. Unlike POD_RETENTION_DAYS/POD_ORPHAN_RETENTION_DAYS (DEC-039's
  // approved numbers, kept as constants in pod-retention-policy.ts per the
  // same reasoning DEC-037's ACCEPT_WINDOW_SECONDS documents), this is not a
  // business value — it is a deploy-time toggle, the same kind of thing
  // NODE_ENV is. Defaults to OFF: absent or anything other than the literal
  // string 'true' means no destructive delete ever runs, so a fresh
  // environment never starts purging evidence by accident.
  POD_RETENTION_PURGE_ENABLED: z.enum(['true', 'false']).optional(),
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
  paymentWebhookDevSecret: string | undefined;
  r2AccountId: string | undefined;
  r2AccessKeyId: string | undefined;
  r2SecretAccessKey: string | undefined;
  r2Bucket: string | undefined;
  r2PublicUrl: string | undefined;
  r2PrivateBucket: string | undefined;
  podRetentionPurgeEnabled: boolean;
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
    paymentWebhookDevSecret: env.PAYMENT_WEBHOOK_DEV_SECRET,
    r2AccountId: env.R2_ACCOUNT_ID,
    r2AccessKeyId: env.R2_ACCESS_KEY_ID,
    r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY,
    r2Bucket: env.R2_BUCKET,
    r2PublicUrl: env.R2_PUBLIC_URL,
    r2PrivateBucket: env.R2_PRIVATE_BUCKET,
    podRetentionPurgeEnabled: env.POD_RETENTION_PURGE_ENABLED === 'true',
  };
}
