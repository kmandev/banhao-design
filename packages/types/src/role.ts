/**
 * The four BANHAO client surfaces, per docs/ARCHITECTURE.md.
 *
 * Authorization is ALWAYS enforced on the backend. A role value present on the
 * client is for UI affordances only — never for access control decisions.
 */
export const ROLES = ['CUSTOMER', 'MERCHANT', 'DRIVER', 'ADMIN'] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
