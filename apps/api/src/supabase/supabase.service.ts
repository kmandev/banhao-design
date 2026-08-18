import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { loadServerEnv, type ServerEnv } from '@banhao/config';

export interface SupabaseJwtClaims {
  sub: string;
  role?: string;
  phone?: string;
  email?: string;
}

/**
 * The only signature algorithm accepted for a Supabase access token.
 *
 * Supabase issues ES256 (asymmetric, verified against the project's public
 * JWKS) — confirmed against the live project, whose tokens carry
 * `{"alg":"ES256","kid":…}`. Pinning this list is the algorithm-confusion
 * defence: without it, `jwtVerify` would accept whatever the *token's own
 * header* claims, letting an attacker pick the algorithm. There is
 * deliberately no HS256 fallback — `SUPABASE_JWT_SECRET` is the legacy
 * symmetric secret and must never be able to validate a token here, because a
 * "try ES256, then try HS256" ladder is an authentication downgrade an
 * attacker chooses, not a compatibility nicety.
 */
const ACCEPTED_JWT_ALGORITHMS = ['ES256'] as const;

/** Supabase Auth's audience for a signed-in end user. */
const EXPECTED_JWT_AUDIENCE = 'authenticated';

/**
 * Owns the two Supabase clients and JWT verification.
 *
 * SECURITY: `admin` uses the service role key and bypasses Row Level Security.
 * It exists only here, in backend context, and must never be exposed to any
 * client. See AGENTS.md and docs/ARCHITECTURE.md.
 *
 * ## Token verification — ES256 via the project's JWKS
 *
 * Every input to the verification decision is derived from server-side
 * configuration, never from the request: the JWKS URL, the issuer and the
 * audience all come from `SUPABASE_URL`, and the algorithm list is a
 * compile-time constant. Nothing the client sends — including the token's own
 * `kid`, `alg` or `iss` — can redirect verification at a key or issuer of the
 * caller's choosing; those header/claim values are only ever *matched against*
 * this trusted configuration.
 */
@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);
  private readonly env: ServerEnv;

  /** `https://<project>.supabase.co/auth/v1` — the `iss` Supabase stamps on its tokens. */
  private readonly issuer: string;

  /**
   * Resolves the project's public signing keys, constructed **once** per
   * service instance (itself a Nest singleton), never per request.
   *
   * `createRemoteJWKSet` owns its own fetching, caching, cooldown and
   * rotation handling — a per-request resolver would defeat all of that and
   * put a network round trip on every authenticated call. Deliberately not
   * wrapped in any hand-rolled key cache: jose already does this correctly,
   * and re-implementing it is how key rotation quietly stops working.
   */
  private readonly jwks: JWTVerifyGetKey;

  /** Service-role client — bypasses RLS. Backend only. */
  readonly admin: SupabaseClient;

  constructor() {
    this.env = loadServerEnv();

    const authBaseUrl = `${this.env.supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
    this.issuer = authBaseUrl;
    this.jwks = createRemoteJWKSet(new URL(`${authBaseUrl}/.well-known/jwks.json`));

    this.admin = createClient(this.env.supabaseUrl, this.env.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  onModuleInit(): void {
    this.logger.log(`Supabase client initialised for ${this.env.supabaseUrl}`);
  }

  /**
   * Verifies a Supabase access token: signature, algorithm, issuer, audience
   * and the standard time claims (`exp`/`nbf`, enforced by `jwtVerify`).
   *
   * Returns null on **any** failure — callers treat that as unauthenticated,
   * and `SupabaseAuthGuard` turns it into a 401. Nothing about why it failed
   * reaches the client: a cryptographic error message is an oracle, and the
   * caller only needs to know the token was not accepted.
   */
  async verifyAccessToken(token: string): Promise<SupabaseJwtClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        algorithms: [...ACCEPTED_JWT_ALGORITHMS],
        issuer: this.issuer,
        audience: EXPECTED_JWT_AUDIENCE,
      });

      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        return null;
      }

      return {
        sub: payload.sub,
        role: typeof payload.role === 'string' ? payload.role : undefined,
        phone: typeof payload.phone === 'string' ? payload.phone : undefined,
        email: typeof payload.email === 'string' ? payload.email : undefined,
      };
    } catch (error) {
      // jose's own message only (e.g. "signature verification failed") — it
      // names the failure mode, never the token, its payload or its signature.
      this.logger.debug(`Token verification failed: ${(error as Error).message}`);
      return null;
    }
  }
}
