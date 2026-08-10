/**
 * iOS Simulator QA proxy for Supabase.
 *
 * WHY THIS EXISTS
 * ---------------
 * The iOS Simulator's CFNetwork stack cannot hold an HTTP/3 (QUIC) connection to
 * Supabase. The first HTTPS request to the project host succeeds over HTTP/2, the
 * response advertises `alt-svc: h3`, CFNetwork caches that, and every subsequent
 * request switches to QUIC and dies with NSURLErrorNetworkConnectionLost (-1005),
 * which React Native surfaces as "Network request failed". Verified from the
 * Simulator's own logs; `curl` inside the same Simulator runtime (which does not
 * use QUIC) reaches the same host fine, and clearing Expo Go's HTTPStorages
 * database buys exactly one more successful request. There is no per-app switch
 * to disable HTTP/3 in Expo Go.
 *
 * This proxy sidesteps it by giving the Simulator a plain-HTTP loopback origin.
 * Cleartext HTTP never negotiates QUIC, so every request survives.
 *
 * WHAT IT IS NOT
 * --------------
 * It is not a mock, a stub, or a fake backend. Every request is forwarded
 * verbatim to the real Supabase project over HTTPS from the host (where the
 * network works), and the real response is returned unchanged. Sessions are
 * issued by real GoTrue, and RLS is enforced by the real database. Nothing about
 * authentication is bypassed.
 *
 * USE
 * ---
 *   node scripts/sim-supabase-proxy.mjs
 *
 * then point the customer app's local .env at it for the duration of QA:
 *
 *   EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54331
 *
 * Local development only. Never point a build that ships anywhere at this.
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const PORT = Number(process.env.SIM_PROXY_PORT ?? 54331);

const env = Object.fromEntries(
  readFileSync(new URL('../apps/customer/.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

// Read the upstream from an explicit override first so that pointing .env at the
// proxy does not make the proxy point at itself.
const UPSTREAM = (process.env.SIM_PROXY_UPSTREAM ?? env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(
  /\/$/,
  '',
);

if (!UPSTREAM.startsWith('https://')) {
  console.error(
    'Refusing to start: upstream must be the https Supabase URL.\n' +
      'Set SIM_PROXY_UPSTREAM=https://<project>.supabase.co when .env already points at this proxy.',
  );
  process.exit(1);
}

/** Hop-by-hop headers must not be forwarded. */
const STRIP = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
  'te',
  'trailer',
  'content-length',
  // fetch() already decompressed the body, so forwarding the upstream encoding
  // would make the client try to gunzip plaintext and drop the connection.
  'content-encoding',
  // Dropped so the Simulator is never told an HTTP/3 endpoint exists.
  'alt-svc',
]);

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!STRIP.has(k.toLowerCase())) headers[k] = v;
  }

  const target = UPSTREAM + req.url;

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
      redirect: 'manual',
    });

    const out = {};
    upstream.headers.forEach((value, key) => {
      if (!STRIP.has(key.toLowerCase())) out[key] = value;
    });

    const payload = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, out);
    res.end(payload);

    // Paths only — never log query strings, bodies, tokens, or OTP codes.
    console.log(`${res.statusCode} ${req.method} ${req.url.split('?')[0]}`);
  } catch (err) {
    console.error(`502 ${req.method} ${req.url.split('?')[0]} — ${err.message}`);
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'sim proxy upstream failure' }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`sim proxy listening on http://127.0.0.1:${PORT} -> ${UPSTREAM}`);
});
