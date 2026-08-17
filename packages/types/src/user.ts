import type { Role } from './role';

/**
 * A BANHAO user profile.
 *
 * Identity itself lives in Supabase Auth (`auth.users`); this is the
 * application-owned profile row that carries role and display data.
 * See supabase/migrations for the schema.
 */
export interface UserProfile {
  id: string;
  /** @deprecated Legacy `profiles.role`; UI vocabulary only — see {@link Role}. */
  role: Role;
  phone: string | null;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Shape returned by `GET /api/v1/me`. */
export interface MeResponse {
  id: string;
  /**
   * @deprecated Legacy `profiles.role`; UI vocabulary only — see {@link Role}.
   * Retained so the existing client contract does not break. Authorization
   * capabilities are resolved server-side per request and are deliberately not
   * exposed here (DEC-APP-004 does not require it).
   */
  role: Role;
  phone: string | null;
  displayName: string | null;
}
