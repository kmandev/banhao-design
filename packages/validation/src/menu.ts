import { z } from 'zod';
import { satangSchema, uuidSchema } from './common';

/**
 * M-11 Menu Management — the merchant catalog write contracts.
 *
 * **Every rule here mirrors a constraint the database already declares, and
 * stops there.** M11-D11 is explicit about this: no invented length limit, no
 * minimum price, no duplicate-name check and no profanity rule, because
 * `20260811000003_catalog_domain.sql` declares none and no document asks for
 * one. Where a field is optional below, it is optional because the column is
 * nullable or carries a default — not because it seemed convenient.
 *
 * Money is integer satang throughout (CON-003). The merchant types baht in the
 * UI and the conversion happens once, at that boundary (M11-D05); nothing on
 * the wire is ever baht.
 */

/** `menu_categories.name` / `menu_items.name` — `text not null`, no length limit declared. */
const nameSchema = z.string().trim().min(1);

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * `POST /api/v1/merchant/restaurants/:restaurantId/menu-categories`.
 *
 * No `restaurantId` field: it comes from the route path, which is also what
 * `@RestaurantScope()` authorizes against. A body field able to redirect the
 * write away from the authorized restaurant is exactly the shape that guard
 * exists to forbid.
 *
 * No `sortOrder` either — a new category appends, and order is changed by
 * dragging (M11-D08).
 */
export const createMenuCategorySchema = z
  .object({
    name: nameSchema,
  })
  .strict();

export type CreateMenuCategoryInput = z.infer<typeof createMenuCategorySchema>;

/**
 * `PATCH /api/v1/merchant/menu-categories/:categoryId`.
 *
 * `name` is the only editable field, because it is the only merchant-facing
 * one on the table: `sort_order` has its own reorder endpoint and
 * `archived_at` its own archive endpoint, both because they are not
 * single-row edits in the same sense (M-11 §07).
 */
export const updateMenuCategorySchema = z
  .object({
    name: nameSchema,
  })
  .strict();

export type UpdateMenuCategoryInput = z.infer<typeof updateMenuCategorySchema>;

/**
 * `POST /api/v1/merchant/restaurants/:restaurantId/menu-categories/reorder`.
 *
 * The **complete** new order, not a delta. `reorder_menu_categories` rejects a
 * partial list, because renumbering half a menu has no well-defined result.
 */
export const reorderMenuCategoriesSchema = z
  .object({
    categoryIds: z.array(uuidSchema),
  })
  .strict();

export type ReorderMenuCategoriesInput = z.infer<typeof reorderMenuCategoriesSchema>;

export interface MenuCategoryResponse {
  id: string;
  restaurantId: string;
  name: string;
  sortOrder: number;
  archivedAt: string | null;
}

// ---------------------------------------------------------------------------
// Menu items
// ---------------------------------------------------------------------------

/**
 * `menu_items.base_price_satang` — `bigint not null check (>= 0)`.
 *
 * Zero is permitted. M11-Q-05 asks whether a ฿0 dish is a legitimate offering
 * or a data-entry accident; until that is answered the schema's own answer
 * stands, per M11-D11, rather than a guess in the other direction.
 */
const basePriceSatangSchema = satangSchema;

/**
 * `POST /api/v1/merchant/restaurants/:restaurantId/menu-items`.
 *
 * `imageUrl` is absent deliberately: both image endpoints are keyed by
 * `menuItemId`, so no key exists before the dish is saved and create cannot
 * carry one (M11-D09). `sortOrder` is absent for the same reason as on a
 * category — a new dish appends.
 */
export const createMenuItemSchema = z
  .object({
    /** Must be an active category of the same restaurant — checked server-side. */
    categoryId: uuidSchema,
    name: nameSchema,
    /** `description` is nullable; an empty string is normalised to null server-side. */
    description: z.string().trim().optional(),
    basePriceSatang: basePriceSatangSchema,
    /** `is_available` defaults to `true` in the schema, and the create form presets it on. */
    isAvailable: z.boolean().optional(),
  })
  .strict();

export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>;

/**
 * `PATCH /api/v1/merchant/menu-items/:menuItemId`.
 *
 * Every field optional — this is a patch, and the drawer submits only what the
 * merchant changed. `.strict()` still rejects an unknown key, so a client
 * cannot smuggle `restaurantId`, `archivedAt` or `sortOrder` through it.
 *
 * `categoryId` is present because M11-Q-02 confirms a dish may move between
 * categories: the database permits it and order history is unaffected, since
 * `order_items` snapshots the name and price.
 */
export const updateMenuItemSchema = z
  .object({
    categoryId: uuidSchema.optional(),
    name: nameSchema.optional(),
    /** `null` clears the description; omitting the key leaves it unchanged. */
    description: z.string().trim().nullable().optional(),
    basePriceSatang: basePriceSatangSchema.optional(),
    isAvailable: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be supplied',
  });

export type UpdateMenuItemInput = z.infer<typeof updateMenuItemSchema>;

/**
 * `PATCH /api/v1/merchant/menu-items/:menuItemId/availability`.
 *
 * Its own single-field endpoint rather than a use of the patch above, for the
 * reason M11-C05 gives: this is the most frequent merchant action after
 * accepting an order, and routing it through a full item-update payload would
 * make the fast path the heaviest request on the screen.
 */
export const setMenuItemAvailabilitySchema = z
  .object({
    isAvailable: z.boolean(),
  })
  .strict();

export type SetMenuItemAvailabilityInput = z.infer<typeof setMenuItemAvailabilitySchema>;

/**
 * `POST /api/v1/merchant/restaurants/:restaurantId/menu-items/reorder`.
 *
 * Scoped to one category, because `sort_order` orders dishes within their
 * section and the overview renders section by section.
 */
export const reorderMenuItemsSchema = z
  .object({
    categoryId: uuidSchema,
    menuItemIds: z.array(uuidSchema),
  })
  .strict();

export type ReorderMenuItemsInput = z.infer<typeof reorderMenuItemsSchema>;

export interface MenuItemResponse {
  id: string;
  restaurantId: string;
  categoryId: string;
  name: string;
  description: string | null;
  basePriceSatang: number;
  imageUrl: string | null;
  isAvailable: boolean;
  sortOrder: number;
  archivedAt: string | null;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Option groups
// ---------------------------------------------------------------------------

/**
 * One option within a group — `menu_options`.
 *
 * `priceDeltaSatang` is a plain integer, **not** `satangSchema`: the column is
 * `bigint not null default 0` with no non-negative CHECK, and the migration
 * says so deliberately ("may be negative only if a future business rule
 * requires it"). Imposing non-negativity here would be this package inventing
 * a constraint the database declined to make.
 */
export const menuOptionSchema = z
  .object({
    label: nameSchema,
    priceDeltaSatang: z.number().int(),
    isAvailable: z.boolean(),
  })
  .strict();

export type MenuOptionInput = z.infer<typeof menuOptionSchema>;

/**
 * One option group — `menu_option_groups`.
 *
 * `minSelect` / `maxSelect` are stored numbers, not a preset name. The three
 * presets the editor offers (M11-D07) are a UI vocabulary that writes these
 * pairs underneath; encoding the presets in the wire contract would put a
 * screen's vocabulary into the API and make a fourth shape unrepresentable.
 *
 * The `max >= min` rule mirrors `menu_option_groups_select_range_check`. The
 * "at least one option" rule is the one addition, and it comes from the design
 * rather than the schema: M-11 §05 lists it as a validation rule with the
 * source recorded as "no CHECK on emptiness" — a group with no options cannot
 * be answered by a customer, so it is refused rather than stored.
 */
export const menuOptionGroupSchema = z
  .object({
    title: nameSchema,
    minSelect: z.number().int().nonnegative(),
    maxSelect: z.number().int().nonnegative(),
    options: z.array(menuOptionSchema).min(1),
  })
  .strict()
  .refine((group) => group.maxSelect >= group.minSelect, {
    message: 'maxSelect must be greater than or equal to minSelect',
    path: ['maxSelect'],
  });

export type MenuOptionGroupInput = z.infer<typeof menuOptionGroupSchema>;

/**
 * `PUT /api/v1/merchant/menu-items/:menuItemId/option-groups`.
 *
 * A replacement, matching `replace_menu_item_option_groups`. An empty array is
 * a legitimate edit meaning "this dish has no options".
 */
export const replaceMenuOptionGroupsSchema = z
  .object({
    groups: z.array(menuOptionGroupSchema),
  })
  .strict();

export type ReplaceMenuOptionGroupsInput = z.infer<typeof replaceMenuOptionGroupsSchema>;

export interface MenuOptionGroupsResponse {
  menuItemId: string;
  groupCount: number;
}

/** What the archive endpoints return — the row, now archived. */
export interface ArchiveResponse {
  id: string;
  archivedAt: string;
}

/** What a reorder returns: how many rows it renumbered. */
export interface ReorderResponse {
  reordered: number;
}
