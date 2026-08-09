import { SetMetadata } from '@nestjs/common';
import type { Role } from '@banhao/types';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to the listed roles. Enforced by RolesGuard on the server —
 * the client's own claim about its role is never trusted for access control.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
