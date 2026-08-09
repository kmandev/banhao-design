import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { jwtVerify } from 'jose';
import { loadServerEnv, type ServerEnv } from '@banhao/config';

export interface SupabaseJwtClaims {
  sub: string;
  role?: string;
  phone?: string;
  email?: string;
}

/**
 * Owns the two Supabase clients and JWT verification.
 *
 * SECURITY: `admin` uses the service role key and bypasses Row Level Security.
 * It exists only here, in backend context, and must never be exposed to any
 * client. See AGENTS.md and docs/ARCHITECTURE.md.
 */
@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);
  private readonly env: ServerEnv;
  private readonly jwtSecret: Uint8Array;

  /** Service-role client — bypasses RLS. Backend only. */
  readonly admin: SupabaseClient;

  constructor() {
    this.env = loadServerEnv();
    this.jwtSecret = new TextEncoder().encode(this.env.supabaseJwtSecret);

    this.admin = createClient(this.env.supabaseUrl, this.env.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  onModuleInit(): void {
    this.logger.log(`Supabase client initialised for ${this.env.supabaseUrl}`);
  }

  /**
   * Verifies a Supabase access token's signature and expiry.
   * Returns null on any failure — callers treat that as unauthenticated.
   */
  async verifyAccessToken(token: string): Promise<SupabaseJwtClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.jwtSecret);

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
      this.logger.debug(`Token verification failed: ${(error as Error).message}`);
      return null;
    }
  }
}
