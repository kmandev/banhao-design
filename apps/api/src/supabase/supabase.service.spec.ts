import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from 'jose';

/**
 * `SupabaseService.verifyAccessToken` — ES256 verification against the
 * project's JWKS.
 *
 * Real cryptography, no network. Keys are generated locally with jose, tokens
 * are genuinely signed, and the entire `createRemoteJWKSet` → `jwtVerify` path
 * runs for real — only the JWKS *transport* is intercepted.
 *
 * The interception point matters: jose's Node build fetches a JWKS with
 * `node:https.get`, **not** `globalThis.fetch`. Stubbing `fetch` here would
 * silently do nothing, every verification would fail on an unreachable JWKS,
 * and every negative test below would pass for entirely the wrong reason
 * while the positive ones failed. Mocking `node:https` is what makes the
 * positive cases genuinely exercise signature verification.
 */

/** Mutable so the mock factory can read it lazily (jest requires a `mock*` name). */
const mockJwksState: { keys: JWK[]; requestedUrls: string[]; failWith: Error | null } = {
  keys: [],
  requestedUrls: [],
  failWith: null,
};

jest.mock('node:https', () => {
  const actual = jest.requireActual('node:https');
  return {
    ...actual,
    get: (url: string, _options?: unknown) => {
      mockJwksState.requestedUrls.push(String(url));

      const request = new EventEmitter() as EventEmitter & { destroy: () => void };
      request.destroy = () => undefined;

      process.nextTick(() => {
        if (mockJwksState.failWith) {
          request.emit('error', mockJwksState.failWith);
          return;
        }

        const body = Buffer.from(JSON.stringify({ keys: mockJwksState.keys }));
        const response = Readable.from([body]) as Readable & { statusCode: number };
        response.statusCode = 200;
        request.emit('response', response);
      });

      return request;
    },
  };
});

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({})),
}));

const loadServerEnvMock = jest.fn();
jest.mock('@banhao/config', () => ({
  loadServerEnv: () => loadServerEnvMock(),
}));

import { SupabaseService } from './supabase.service';

const SUPABASE_URL = 'https://test-project.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const AUDIENCE = 'authenticated';
const SUBJECT = 'c5dacbbe-00e4-4b8e-9cdb-1fe573f73e68';
const TRUSTED_KID = 'trusted-key-1';

interface KeyMaterial {
  privateKey: KeyLike;
  publicJwk: JWK;
}

/** The EC keypair the JWKS publishes — the only one that should ever verify. */
let trusted: KeyMaterial;
/** A structurally valid EC keypair deliberately absent from the JWKS. */
let untrusted: KeyMaterial;
/** Symmetric key, for the HS256 downgrade test. */
let hmacSecret: Uint8Array;

const LEGACY_SECRET = 'legacy-symmetric-secret-value-32chars';
const SERVICE_ROLE_KEY = 'service-role-key-value';

async function makeKey(kid: string): Promise<KeyMaterial> {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = kid;
  publicJwk.alg = 'ES256';
  publicJwk.use = 'sig';
  return { privateKey, publicJwk };
}

beforeAll(async () => {
  trusted = await makeKey(TRUSTED_KID);
  untrusted = await makeKey('untrusted-key-1');
  hmacSecret = new TextEncoder().encode(LEGACY_SECRET);
});

beforeEach(() => {
  mockJwksState.keys = [trusted.publicJwk];
  mockJwksState.requestedUrls = [];
  mockJwksState.failWith = null;

  loadServerEnvMock.mockReset();
  loadServerEnvMock.mockReturnValue({
    supabaseUrl: SUPABASE_URL,
    supabaseServiceRoleKey: SERVICE_ROLE_KEY,
    supabaseAnonKey: 'anon-key',
    supabaseJwtSecret: LEGACY_SECRET,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

interface TokenOverrides {
  issuer?: string;
  audience?: string;
  subject?: string;
  expiresIn?: string;
  key?: KeyMaterial;
  kid?: string;
}

async function signToken(overrides: TokenOverrides = {}): Promise<string> {
  const key = overrides.key ?? trusted;
  return new SignJWT({ role: 'authenticated', phone: '+66812345678' })
    .setProtectedHeader({ alg: 'ES256', kid: overrides.kid ?? (key.publicJwk.kid as string) })
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setSubject(overrides.subject ?? SUBJECT)
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? '1h')
    .sign(key.privateKey);
}

function service(): SupabaseService {
  return new SupabaseService();
}

/** Captures what the service's own logger emitted during one call. */
function captureLogs(subject: SupabaseService): string[] {
  const logged: string[] = [];
  const logger = (subject as unknown as { logger: { debug: (m: string) => void } }).logger;
  jest.spyOn(logger, 'debug').mockImplementation((message: unknown) => {
    logged.push(String(message));
  });
  return logged;
}

describe('verifyAccessToken — accepts a genuine Supabase ES256 token', () => {
  it('verifies a valid token and returns its claims', async () => {
    await expect(service().verifyAccessToken(await signToken())).resolves.toEqual({
      sub: SUBJECT,
      role: 'authenticated',
      phone: '+66812345678',
      email: undefined,
    });
  });

  it('verifies a token carrying the expected issuer and audience', async () => {
    const claims = await service().verifyAccessToken(
      await signToken({ issuer: ISSUER, audience: AUDIENCE }),
    );

    expect(claims?.sub).toBe(SUBJECT);
  });

  it('derives the JWKS URL from SUPABASE_URL, never from anything in the token', async () => {
    await service().verifyAccessToken(await signToken());

    expect(mockJwksState.requestedUrls).toEqual([JWKS_URL]);
  });

  it('tolerates a trailing slash on the configured SUPABASE_URL', async () => {
    loadServerEnvMock.mockReturnValue({
      supabaseUrl: `${SUPABASE_URL}/`,
      supabaseServiceRoleKey: SERVICE_ROLE_KEY,
      supabaseAnonKey: 'anon-key',
      supabaseJwtSecret: LEGACY_SECRET,
    });

    const claims = await service().verifyAccessToken(await signToken());

    expect(claims?.sub).toBe(SUBJECT);
    expect(mockJwksState.requestedUrls).toEqual([JWKS_URL]);
  });

  it('selects the right key when the JWKS publishes several', async () => {
    mockJwksState.keys = [untrusted.publicJwk, trusted.publicJwk];

    const claims = await service().verifyAccessToken(await signToken());

    expect(claims?.sub).toBe(SUBJECT);
  });
});

describe('verifyAccessToken — rejects everything else', () => {
  it('rejects an expired token', async () => {
    await expect(
      service().verifyAccessToken(await signToken({ expiresIn: '-1h' })),
    ).resolves.toBeNull();
  });

  it('rejects a token whose signature has been tampered with', async () => {
    const token = await signToken();
    const [header, payload, signature = ''] = token.split('.');
    // The FIRST character, not the last. An ES256 signature is 64 bytes, which
    // base64url-encodes to 86 characters — 516 bits of alphabet for 512 bits of
    // signature, so the final character carries only two significant bits and
    // four bits of padding a decoder discards. Editing it can leave the decoded
    // bytes, and therefore the verification result, completely unchanged. Every
    // bit of the first character is significant, so this always produces a
    // genuinely different signature.
    const tamperedChar = signature.startsWith('A') ? 'B' : 'A';
    const tampered = `${header}.${payload}.${tamperedChar}${signature.slice(1)}`;

    await expect(service().verifyAccessToken(tampered)).resolves.toBeNull();
  });

  it('rejects a token signed by an unrelated EC key that claims a trusted kid', async () => {
    // The attack a naive "look the kid up and trust it" implementation allows:
    // correct kid, wrong private key.
    await expect(
      service().verifyAccessToken(await signToken({ key: untrusted, kid: TRUSTED_KID })),
    ).resolves.toBeNull();
  });

  it('rejects a token whose kid is absent from the trusted JWKS', async () => {
    await expect(
      service().verifyAccessToken(await signToken({ key: untrusted })),
    ).resolves.toBeNull();
  });

  it('rejects a token from the wrong issuer', async () => {
    await expect(
      service().verifyAccessToken(
        await signToken({ issuer: 'https://evil-project.supabase.co/auth/v1' }),
      ),
    ).resolves.toBeNull();
  });

  it('rejects a token with the wrong audience', async () => {
    await expect(
      service().verifyAccessToken(await signToken({ audience: 'anon' })),
    ).resolves.toBeNull();
  });

  it('rejects an HS256 token signed with the legacy symmetric secret', async () => {
    // The downgrade this fix exists to prevent: SUPABASE_JWT_SECRET is still
    // configured, and must never be able to authenticate anyone.
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(SUBJECT)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(hmacSecret);

    await expect(service().verifyAccessToken(token)).resolves.toBeNull();
  });

  it('rejects an unsigned ("alg: none") token', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: SUBJECT, iss: ISSUER, aud: AUDIENCE, exp: 9999999999 }),
    ).toString('base64url');

    await expect(service().verifyAccessToken(`${header}.${payload}.`)).resolves.toBeNull();
  });

  it.each([
    ['malformed', 'not-a-jwt'],
    ['empty', ''],
    ['two-segment', 'aaa.bbb'],
    ['whitespace', '   '],
  ])('rejects a %s token', async (_label, token) => {
    await expect(service().verifyAccessToken(token)).resolves.toBeNull();
  });

  it('rejects an otherwise-valid token that carries no subject', async () => {
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: TRUSTED_KID })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(trusted.privateKey);

    await expect(service().verifyAccessToken(token)).resolves.toBeNull();
  });
});

describe('JWKS resolver lifecycle', () => {
  it('is constructed lazily — no JWKS fetch happens until the first verification', () => {
    service();

    expect(mockJwksState.requestedUrls).toEqual([]);
  });

  it('reuses one resolver across verifications rather than refetching each time', async () => {
    const subject = service();
    const token = await signToken();

    await subject.verifyAccessToken(token);
    await subject.verifyAccessToken(token);
    await subject.verifyAccessToken(token);

    // jose's RemoteJWKSet caches after the first successful fetch; three
    // verifications must not mean three network round trips.
    expect(mockJwksState.requestedUrls).toHaveLength(1);
  });

  it('returns null rather than throwing when the JWKS endpoint is unreachable', async () => {
    mockJwksState.failWith = new Error('network unreachable');

    await expect(service().verifyAccessToken(await signToken())).resolves.toBeNull();
  });

  it('recovers on a later call once the JWKS endpoint is reachable again', async () => {
    const subject = service();
    mockJwksState.failWith = new Error('network unreachable');
    await expect(subject.verifyAccessToken(await signToken())).resolves.toBeNull();

    mockJwksState.failWith = null;
    await expect(subject.verifyAccessToken(await signToken())).resolves.toMatchObject({
      sub: SUBJECT,
    });
  });
});

describe('security — nothing sensitive is ever logged', () => {
  it('logs jose\'s failure reason only, never the token, its payload or its signature', async () => {
    const subject = service();
    const logged = captureLogs(subject);
    const token = await signToken({ expiresIn: '-1h' });

    await subject.verifyAccessToken(token);

    const all = logged.join('\n');
    expect(logged.length).toBeGreaterThan(0);
    expect(all).not.toContain(token);
    for (const segment of token.split('.')) {
      if (segment) expect(all).not.toContain(segment);
    }
  });

  it('never logs the signature on a signature failure', async () => {
    const subject = service();
    const logged = captureLogs(subject);
    const token = await signToken({ key: untrusted, kid: TRUSTED_KID });

    await subject.verifyAccessToken(token);

    expect(logged.join('\n')).not.toContain(token.split('.')[2]);
  });

  it('never logs the legacy JWT secret or the service-role key', async () => {
    const subject = service();
    const logged = captureLogs(subject);

    await subject.verifyAccessToken(await signToken({ expiresIn: '-1h' }));
    await subject.verifyAccessToken('malformed');

    const all = logged.join('\n');
    expect(all).not.toContain(LEGACY_SECRET);
    expect(all).not.toContain(SERVICE_ROLE_KEY);
  });
});
