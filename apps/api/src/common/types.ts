import type { Role } from '@banhao/types';

/**
 * The authenticated principal, derived server-side from a verified Supabase JWT
 * plus the user's profile row. Never populated from client-supplied data.
 */
export interface AuthenticatedUser {
  id: string;
  role: Role;
  phone: string | null;
}
