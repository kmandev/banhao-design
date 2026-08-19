import { Injectable, Logger } from '@nestjs/common';
import type { CartValidateRequest } from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';

/**
 * `POST /api/v1/cart/validate` (Phase D / D-6).
 *
 * V1.1 §6: *"Re-price against live catalog, no writes."* The cart is untrusted
 * draft input — nothing the client sent is ever the subtotal. This service
 * reads `carts`/`cart_items`/`cart_item_options` scoped to the caller, re-reads
 * every item and option from the live catalog on the **service-role client**
 * (RLS bypassed — this is backend context, same as `AddressesService`), and
 * computes the subtotal fresh from what it read.
 *
 * Failure cases, exactly as listed in V1.1 §6's `POST /cart/validate` row:
 * `ITEM_UNAVAILABLE`, `PRICE_CHANGED`, `MIXED_RESTAURANT`. No other domain
 * error is raised here — an empty cart or no cart at all is a valid, zero
 * result, because `CART_EMPTY` belongs to `POST /orders`'s failure list, not
 * this endpoint's.
 */

interface CartRow {
  id: string;
  restaurant_id: string;
}

interface CartItemRow {
  id: string;
  menu_item_id: string;
  restaurant_id: string;
  quantity: number;
}

interface CartItemOptionRow {
  id: string;
  cart_item_id: string;
  menu_option_id: string;
}

interface MenuItemRow {
  id: string;
  restaurant_id: string;
  base_price_satang: number;
  is_available: boolean;
  archived_at: string | null;
}

interface RestaurantRow {
  id: string;
  status: string;
}

interface MenuOptionGroupRow {
  id: string;
  menu_item_id: string;
}

interface MenuOptionRow {
  id: string;
  group_id: string;
  price_delta_satang: number;
  is_available: boolean;
}

export interface CartValidationLine {
  cartItemId: string;
  menuItemId: string;
  quantity: number;
  /** Base price + available option deltas, before quantity. Integer satang. */
  unitPriceSatang: number;
  /** `unitPriceSatang × quantity`. Integer satang. */
  lineSubtotalSatang: number;
}

/**
 * The validated result.
 *
 * Deliberately carries no `deliveryFeeSatang`, `serviceFeeSatang`,
 * `discountSatang` or grand total (DEC-D-01) — those numbers are still OPEN
 * (BQ-026, BQ-027, BQ-030) and Phase D does not compute them.
 */
export interface CartValidationResult {
  /** Null when the caller has no open cart at all — a valid, empty result. */
  cartId: string | null;
  restaurantId: string | null;
  /** Sum of every line's `lineSubtotalSatang`. Integer satang, never a float. */
  subtotalSatang: number;
  lines: CartValidationLine[];
}

const EMPTY_RESULT: CartValidationResult = {
  cartId: null,
  restaurantId: null,
  subtotalSatang: 0,
  lines: [],
};

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Validates the caller's own open cart against the live catalog.
   *
   * `userId` must be the server-verified JWT subject — never a client-supplied
   * value. There is no cart id in the request at all: "the caller's cart" is
   * looked up by `user_id`, the same one-cart-per-user model `carts_user_id_key`
   * already enforces, so there is no id a client could supply to reach anyone
   * else's cart even by mistake.
   */
  async validate(userId: string, request: CartValidateRequest): Promise<CartValidationResult> {
    const cart = await this.fetchCart(userId);
    if (!cart) return EMPTY_RESULT;

    const items = await this.fetchCartItems(cart.id);
    if (items.length === 0) {
      return { cartId: cart.id, restaurantId: cart.restaurant_id, subtotalSatang: 0, lines: [] };
    }

    // Defence in depth only — DEC-017's composite foreign keys are the actual
    // enforcement and make this structurally impossible to reach. If it is
    // ever reached anyway (a bug, a manual DB edit), this must fail loudly
    // with a named code rather than silently mis-price a mixed cart.
    const foreign = items.find((item) => item.restaurant_id !== cart.restaurant_id);
    if (foreign) {
      this.logger.error(
        `Cart ${cart.id} has cart_item ${foreign.id} with restaurant_id ${foreign.restaurant_id}, ` +
          `but the cart belongs to restaurant ${cart.restaurant_id}. The DEC-017 composite foreign ` +
          `keys should make this impossible; investigate as a data integrity issue.`,
      );
      throw new DomainError('MIXED_RESTAURANT', {
        details: { cartId: cart.id, cartRestaurantId: cart.restaurant_id },
      });
    }

    const menuItemIds = [...new Set(items.map((item) => item.menu_item_id))];
    const [restaurant, menuItems] = await Promise.all([
      this.fetchRestaurant(cart.restaurant_id),
      this.fetchMenuItems(menuItemIds),
    ]);

    const itemsById = new Map(menuItems.map((row) => [row.id, row]));
    const restaurantIsActive = restaurant?.status === 'ACTIVE';

    const unavailable = items.filter((item) => {
      const menuItem = itemsById.get(item.menu_item_id);
      return (
        !restaurantIsActive ||
        !menuItem ||
        menuItem.archived_at !== null ||
        !menuItem.is_available
      );
    });

    if (unavailable.length > 0) {
      throw new DomainError('ITEM_UNAVAILABLE', {
        details: {
          items: unavailable.map((item) => ({
            cartItemId: item.id,
            menuItemId: item.menu_item_id,
          })),
        },
      });
    }

    const optionRows = await this.fetchCartItemOptions(items.map((item) => item.id));
    const optionIds = [...new Set(optionRows.map((row) => row.menu_option_id))];
    const options = await this.fetchMenuOptions(optionIds);
    const groups = await this.fetchOptionGroups([...new Set(options.map((row) => row.group_id))]);

    const optionsById = new Map(options.map((row) => [row.id, row]));
    const groupsById = new Map(groups.map((row) => [row.id, row]));
    const optionsByCartItem = groupOptionsByCartItem(optionRows);

    const lines: CartValidationLine[] = items.map((item) => {
      const menuItem = itemsById.get(item.menu_item_id);
      if (!menuItem) {
        // Already excluded via `unavailable` above; narrows the type below.
        throw new DomainError('ITEM_UNAVAILABLE', { details: { cartItemId: item.id } });
      }

      const selectedOptionRows = optionsByCartItem.get(item.id) ?? [];
      let optionsDeltaSatang = 0;

      for (const selection of selectedOptionRows) {
        const option = optionsById.get(selection.menu_option_id);
        const group = option ? groupsById.get(option.group_id) : undefined;

        // An option whose parent group no longer belongs to this cart item is
        // an integrity fault (its owning item was likely archived and its
        // options cascade-orphaned in the same transaction) — never priced.
        const belongsToThisItem = group?.menu_item_id === item.menu_item_id;

        if (!option || !belongsToThisItem) {
          this.logger.error(
            `cart_item_options row ${selection.id} references menu_option ` +
              `${selection.menu_option_id}, which does not resolve to a group under ` +
              `menu_item ${item.menu_item_id}. Excluding it from the subtotal.`,
          );
          continue;
        }

        // PC-Q-001 parity: an unavailable option stays selectable-in-history
        // but contributes nothing. No separate error code exists for this in
        // the catalogue, and none is invented here — see the D-6 report.
        if (!option.is_available) continue;

        optionsDeltaSatang += option.price_delta_satang;
      }

      const unitPriceSatang = menuItem.base_price_satang + optionsDeltaSatang;

      return {
        cartItemId: item.id,
        menuItemId: item.menu_item_id,
        quantity: item.quantity,
        unitPriceSatang,
        lineSubtotalSatang: unitPriceSatang * item.quantity,
      };
    });

    this.checkPriceChanges(request, lines);

    const subtotalSatang = lines.reduce((sum, line) => sum + line.lineSubtotalSatang, 0);

    return { cartId: cart.id, restaurantId: cart.restaurant_id, subtotalSatang, lines };
  }

  /**
   * Compares each `expectedLines` entry against the freshly computed unit
   * price. Nothing here feeds the subtotal — `expectedUnitPriceSatang` is used
   * for this comparison only, never as a source of money.
   */
  private checkPriceChanges(request: CartValidateRequest, lines: CartValidationLine[]): void {
    if (!request.expectedLines || request.expectedLines.length === 0) return;

    const currentByCartItem = new Map(lines.map((line) => [line.cartItemId, line]));
    const changed: { cartItemId: string; expectedSatang: number; currentSatang: number }[] = [];

    for (const expected of request.expectedLines) {
      const current = currentByCartItem.get(expected.cartItemId);
      // A cartItemId that does not resolve within the caller's own cart is
      // silently ignored rather than acted on — the only rows ever compared
      // are the ones just loaded for this cart, so a stale or foreign id from
      // the client cannot influence anything.
      if (!current) continue;

      if (current.unitPriceSatang !== expected.expectedUnitPriceSatang) {
        changed.push({
          cartItemId: expected.cartItemId,
          expectedSatang: expected.expectedUnitPriceSatang,
          currentSatang: current.unitPriceSatang,
        });
      }
    }

    if (changed.length > 0) {
      throw new DomainError('PRICE_CHANGED', { details: { lines: changed } });
    }
  }

  private async fetchCart(userId: string): Promise<CartRow | null> {
    const { data, error } = await this.supabase.admin
      .from('carts')
      .select('id, restaurant_id')
      .eq('user_id', userId)
      .maybeSingle<CartRow>();

    if (error) this.fail('cart lookup', userId, error.message);
    return data ?? null;
  }

  private async fetchCartItems(cartId: string): Promise<CartItemRow[]> {
    const { data, error } = await this.supabase.admin
      .from('cart_items')
      .select('id, menu_item_id, restaurant_id, quantity')
      .eq('cart_id', cartId)
      .returns<CartItemRow[]>();

    if (error) this.fail('cart item list', cartId, error.message);
    return data ?? [];
  }

  private async fetchCartItemOptions(cartItemIds: string[]): Promise<CartItemOptionRow[]> {
    if (cartItemIds.length === 0) return [];

    const { data, error } = await this.supabase.admin
      .from('cart_item_options')
      .select('id, cart_item_id, menu_option_id')
      .in('cart_item_id', cartItemIds)
      .returns<CartItemOptionRow[]>();

    if (error) this.fail('cart item option list', cartItemIds.join(','), error.message);
    return data ?? [];
  }

  /**
   * Reads directly from `menu_items` on the service-role client, which is not
   * subject to `menu_items_select_active` — an archived row or one under a
   * SUSPENDED restaurant is genuinely visible here, unlike the client-side
   * catalog read path, and that is exactly what lets `archived_at` be checked
   * explicitly instead of inferred from a row's absence.
   */
  private async fetchMenuItems(menuItemIds: string[]): Promise<MenuItemRow[]> {
    if (menuItemIds.length === 0) return [];

    const { data, error } = await this.supabase.admin
      .from('menu_items')
      .select('id, restaurant_id, base_price_satang, is_available, archived_at')
      .in('id', menuItemIds)
      .returns<MenuItemRow[]>();

    if (error) this.fail('menu item lookup', menuItemIds.join(','), error.message);
    return data ?? [];
  }

  private async fetchRestaurant(restaurantId: string): Promise<RestaurantRow | null> {
    const { data, error } = await this.supabase.admin
      .from('restaurants')
      .select('id, status')
      .eq('id', restaurantId)
      .maybeSingle<RestaurantRow>();

    if (error) this.fail('restaurant lookup', restaurantId, error.message);
    return data ?? null;
  }

  private async fetchMenuOptions(optionIds: string[]): Promise<MenuOptionRow[]> {
    if (optionIds.length === 0) return [];

    const { data, error } = await this.supabase.admin
      .from('menu_options')
      .select('id, group_id, price_delta_satang, is_available')
      .in('id', optionIds)
      .returns<MenuOptionRow[]>();

    if (error) this.fail('menu option lookup', optionIds.join(','), error.message);
    return data ?? [];
  }

  /**
   * The groups owning the options actually selected — not every group under
   * the item. The join back to `menu_item_id` is what proves "this option
   * belongs to this item's own configuration".
   */
  private async fetchOptionGroups(groupIds: string[]): Promise<MenuOptionGroupRow[]> {
    if (groupIds.length === 0) return [];

    const { data, error } = await this.supabase.admin
      .from('menu_option_groups')
      .select('id, menu_item_id')
      .in('id', groupIds)
      .returns<MenuOptionGroupRow[]>();

    if (error) this.fail('option group lookup', groupIds.join(','), error.message);
    return data ?? [];
  }

  private fail(operation: string, context: string, message: string): never {
    this.logger.error(`Cart ${operation} failed for ${context}: ${message}`);
    throw new DomainError('INTERNAL_ERROR', { message: `Cart ${operation} failed` });
  }
}

function groupOptionsByCartItem(rows: CartItemOptionRow[]): Map<string, CartItemOptionRow[]> {
  const byCartItem = new Map<string, CartItemOptionRow[]>();

  for (const row of rows) {
    const existing = byCartItem.get(row.cart_item_id);
    if (existing) existing.push(row);
    else byCartItem.set(row.cart_item_id, [row]);
  }

  return byCartItem;
}
