import { SetMetadata } from '@nestjs/common';

export const RESTAURANT_SCOPE_KEY = 'restaurantScope';

/** Where in the request the restaurant id is read from. */
export interface RestaurantScopeOptions {
  /** Route parameter holding the restaurant id. Defaults to `restaurantId`. */
  param?: string;
}

/**
 * Marks a route as acting on **one specific restaurant**, enforced by
 * `RestaurantScopeGuard`.
 *
 * `@Roles('MERCHANT')` asserts only that the caller is a merchant *somewhere* —
 * on its own it would let any merchant reach any restaurant. This decorator is
 * what binds the request to a restaurant the caller is actually a member of
 * (DEC-033: `restaurant_members` is the grant, and a capability grants nothing
 * by itself).
 *
 * The id is read from the **route parameter** only — never the body or query.
 * The path names the resource being acted on; a body field is client-supplied
 * data that must not be able to redirect an authorization check.
 *
 * ```ts
 * @Patch('restaurants/:restaurantId/menu-items/:itemId')
 * @Roles('MERCHANT')
 * @RestaurantScope()
 * updateItem(...) {}
 * ```
 */
export const RestaurantScope = (options: RestaurantScopeOptions = {}) =>
  SetMetadata(RESTAURANT_SCOPE_KEY, { param: options.param ?? 'restaurantId' });
