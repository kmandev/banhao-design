/**
 * The four BANHAO client surfaces, per docs/ARCHITECTURE.md.
 *
 * @deprecated for authorization. **UI vocabulary only.**
 *
 * DEC-033 / DEC-APP-004: this mirrors the legacy `profiles.role` column, which
 * is no longer authoritative. It cannot express what authorization actually
 * asks — a merchant belongs to *specific restaurants*, and one person is
 * routinely both a rider and a customer. The API resolves capabilities from
 * domain membership (`restaurant_members`, `riders`, `platform_staff`); see
 * `apps/api/src/common/types.ts` `Capability`.
 *
 * Retained because clients still render from it. Authorization is ALWAYS
 * enforced on the backend, and a role value present on the client is for UI
 * affordances only — never for access control decisions.
 */
export const ROLES = ['CUSTOMER', 'MERCHANT', 'DRIVER', 'ADMIN'] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
