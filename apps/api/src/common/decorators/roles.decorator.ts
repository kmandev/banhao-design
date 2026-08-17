import { SetMetadata } from '@nestjs/common';
import type { Capability } from '../types';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to actors holding at least one of the listed capabilities.
 *
 * Enforced by RolesGuard on the server against database-resolved domain
 * membership (DEC-033 / DEC-APP-004) — the client's own claim about what it is
 * is never trusted for access control.
 *
 * The name is kept for continuity; the semantics are capabilities, not the
 * legacy `profiles.role` vocabulary. Note that `@Roles('MERCHANT')` asserts only
 * that the actor is a merchant *somewhere* — per-restaurant scope is a
 * resource-level check, not this decorator's job.
 */
export const Roles = (...capabilities: Capability[]) => SetMetadata(ROLES_KEY, capabilities);
