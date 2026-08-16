/**
 * BANHAO tick worker (DEC-APP-010).
 *
 * A Cloudflare Worker cron, firing every minute, that authenticates a single
 * `POST /internal/tick` call the way `TickHmacGuard`
 * (apps/api/src/common/guards/tick-hmac.guard.ts) requires — and nothing
 * else. This Worker adapts to that guard's protocol; the guard is never
 * changed to accommodate this Worker.
 *
 * Protocol, exactly:
 *   - `Content-Type: application/json`, a non-empty JSON body
 *   - header `X-Tick-Signature`: lowercase hex `HMAC-SHA256(secret, body)`,
 *     computed over the *exact* bytes sent — the same string is signed and
 *     sent, never reconstructed in between
 *
 * Uses the Workers runtime's native `crypto.subtle` (Web Crypto), not
 * `node:crypto` — this needs no `nodejs_compat` compatibility flag, keeping
 * the Worker's runtime surface minimal.
 */

export interface Env {
  /** Non-secret. The Cloud Run URL to tick. Empty until the API is deployed. */
  API_URL: string;
  /**
   * A Wrangler secret (`wrangler secret put INTERNAL_TICK_SECRET`), not a
   * `[vars]` entry — declared here only for its type, never its value.
   */
  INTERNAL_TICK_SECRET: string;
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runTick(env));
  },
} satisfies ExportedHandler<Env>;

async function runTick(env: Env): Promise<void> {
  if (!env.API_URL) {
    throw new Error('tick-worker: API_URL is not configured');
  }
  if (!env.INTERNAL_TICK_SECRET) {
    throw new Error('tick-worker: INTERNAL_TICK_SECRET is not configured');
  }

  // Built once. This exact string is what gets signed AND what gets sent —
  // never re-stringified in between, which is what keeps the signature valid.
  const body = JSON.stringify({ tick: true, at: new Date().toISOString() });
  const signature = await signHex(body, env.INTERNAL_TICK_SECRET);

  const response = await fetch(`${env.API_URL}/internal/tick`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tick-Signature': signature,
    },
    body,
  });

  if (!response.ok) {
    // Deliberately no retry/queue here — a scheduled trigger failure is
    // Cloudflare's own concern to retry, and BANHAO's tick is idempotent by
    // design (DEC-APP-010), so the next minute's tick is a sufficient retry.
    // Never logs the secret or the signature — only the transport outcome.
    throw new Error(`tick-worker: POST /internal/tick failed with HTTP ${response.status}`);
  }
}

/** Lowercase hex HMAC-SHA256 of `body`, computed over its exact UTF-8 bytes. */
async function signHex(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
