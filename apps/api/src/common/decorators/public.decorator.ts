import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as reachable without authentication.
 *
 * Auth is enforced globally by SupabaseAuthGuard, so routes are protected by
 * default and must opt out explicitly. That way forgetting a decorator fails
 * closed (route stays protected) rather than open.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
