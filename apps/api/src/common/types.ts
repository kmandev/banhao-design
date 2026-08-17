/**
 * The authenticated principal and its resolved capabilities.
 *
 * DEC-033 / DEC-APP-004: authorization is resolved from **domain membership**
 * read out of the database on every request — never from `profiles.role`, never
 * from a JWT claim, and never from anything the client sends. `profiles.role`
 * is a deprecated legacy column; nothing in this file consults it.
 *
 * Membership is *scoped*: a merchant belongs to specific restaurants. That
 * scope is carried here so resource-level authorization (a later Phase B task)
 * can answer "may this actor act on restaurant X?" — a bare capability never
 * answers that on its own.
 */

/** Merchant seat, as granted by `restaurant_members`. */
export type MerchantMemberRole = 'OWNER' | 'MANAGER' | 'STAFF';

/** Operator/admin grant, as carried by `platform_staff`. */
export type PlatformStaffRole = 'OPERATOR' | 'ADMIN';

/**
 * What a route may require via `@Roles(...)`.
 *
 * Deliberately distinct from `@banhao/types`' `Role`, which is the legacy
 * UI-only vocabulary tied to `profiles.role`. `RIDER` (not `DRIVER`) and the
 * `OPERATOR`/`ADMIN` split match the database's own domain tables.
 */
export type Capability = 'CUSTOMER' | 'MERCHANT' | 'RIDER' | 'OPERATOR' | 'ADMIN';

/** One active, non-revoked `restaurant_members` row. */
export interface MerchantMembership {
  restaurantId: string;
  memberRole: MerchantMemberRole;
}

/**
 * An active rider. Only `status = 'APPROVED'` ever reaches this type —
 * SUSPENDED, DEACTIVATED and every pre-approval status resolve to `null`.
 */
export interface RiderIdentity {
  riderId: string;
}

/** An active, non-revoked `platform_staff` grant. */
export interface PlatformStaffIdentity {
  staffRole: PlatformStaffRole;
}

/**
 * Everything this actor is authorised to be, as of this request.
 *
 * `customer` is implicit (DEC-033): every authenticated profile may order, with
 * no membership row. The other three are grants and default to absent.
 */
export interface ActorCapabilities {
  customer: boolean;
  merchant: MerchantMembership[];
  rider: RiderIdentity | null;
  platformStaff: PlatformStaffIdentity | null;
}

/**
 * The authenticated principal, derived server-side from a verified Supabase JWT
 * plus database membership. Never populated from client-supplied data.
 */
export interface AuthenticatedUser {
  id: string;
  phone: string | null;
  capabilities: ActorCapabilities;
}

/** No capabilities at all — the fail-closed default. Not even customer. */
export const NO_CAPABILITIES: ActorCapabilities = {
  customer: false,
  merchant: [],
  rider: null,
  platformStaff: null,
};

/** Does this actor hold `capability` at all, ignoring scope? */
export function hasCapability(
  capabilities: ActorCapabilities,
  capability: Capability,
): boolean {
  switch (capability) {
    case 'CUSTOMER':
      return capabilities.customer;
    case 'MERCHANT':
      return capabilities.merchant.length > 0;
    case 'RIDER':
      return capabilities.rider !== null;
    case 'OPERATOR':
      // ADMIN is strictly broader than OPERATOR — an admin may do operator work.
      return capabilities.platformStaff !== null;
    case 'ADMIN':
      return capabilities.platformStaff?.staffRole === 'ADMIN';
  }
}

/**
 * Scoped merchant check: may this actor act on *this* restaurant?
 *
 * Provided here so resource-level authorization has one correct implementation
 * to call. Deliberately NOT wired into `RolesGuard` — per-resource ownership is
 * a separate Phase B task, and a capability guard that silently did resource
 * checks would hide where authorization actually happens.
 */
export function hasMerchantAccess(
  capabilities: ActorCapabilities,
  restaurantId: string,
): boolean {
  return capabilities.merchant.some((m) => m.restaurantId === restaurantId);
}
