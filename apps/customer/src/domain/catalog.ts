/**
 * Customer App catalog domain — the production contract.
 *
 * These types describe what the **deployed schema actually holds**
 * (`supabase/migrations/20260811000002_merchant_domain.sql` and
 * `…000003_catalog_domain.sql`), not what the mock fixtures happened to carry.
 * They replace the catalog half of `src/mocks/types.ts` (Phase C / C-1): no
 * production screen may import catalog types from `src/mocks/` any more.
 *
 * Money is integer satang throughout (CON-003) — never a float, never Baht.
 *
 * ## Fields deliberately ABSENT — PC-Q-002, unresolved
 *
 * The mock `Shop` carried `distanceKm`, `etaMinutes`, `deliveryFeeSatang` and
 * `badge`. **None has an authoritative source**, and none is reintroduced here:
 *
 * - `distanceKm` — the geo domain (`zones`, `service_areas`) is deferred. PostGIS
 *   could compute a distance, but no approved decision authorises putting one in
 *   the catalog contract.
 * - `deliveryFeeSatang` — flat and resolved server-side (DEC-035), not a
 *   per-catalog-item or per-restaurant value; `delivery_fee_bands` remains
 *   deferred. V1.1 rule #10: money is never invented by the client.
 * - `etaMinutes` — `restaurants.avg_prep_minutes` exists, but preparation time is
 *   not a delivery ETA and mapping one to the other would be a fabrication.
 * - `badge` — no promotion source exists; promotions are deferred.
 *
 * Adding any of them back requires the PC-Q-002 decision first. A placeholder
 * value here would be indistinguishable from real data downstream.
 */

import type { Satang } from '@banhao/types';

/** One opening window, from `restaurant_hours`. */
export interface OpeningWindow {
  /** 0 = Sunday … 6 = Saturday, matching `restaurant_hours.day_of_week`. */
  dayOfWeek: number;
  /** `HH:MM:SS` local wall-clock, as stored by Postgres `time`. */
  opensAt: string;
  closesAt: string;
}

/**
 * Merchant storefront, in Food-phase naming (`restaurants`).
 *
 * `isOpen` and `todayHours` are **derived**, not columns — see
 * `src/lib/openingHours.ts`. Everything else maps 1:1 from the table.
 */
export interface Shop {
  id: string;
  name: string;
  description: string | null;
  cuisine: string | null;
  imageUrl: string | null;
  phone: string | null;
  addressLine: string | null;
  lat: number | null;
  lng: number | null;
  minOrderSatang: Satang | null;
  avgPrepMinutes: number | null;
  /** `restaurants.rating_avg` — null until the restaurant has been rated. */
  ratingAvg: number | null;
  ratingCount: number;
  /** ISO timestamp; a temporary closure that may be past, current or future. */
  temporarilyClosedUntil: string | null;
  hours: OpeningWindow[];

  // --- derived, not stored -------------------------------------------------
  /** Whether the shop is taking orders *right now* (Asia/Bangkok). */
  isOpen: boolean;
  /** Today's window formatted for display, or null when closed all day. */
  todayHours: string | null;
}

/** A menu section within one restaurant (`menu_categories`). */
export interface MenuCategory {
  id: string;
  shopId: string;
  name: string;
  sortOrder: number;
}

/** A single choice inside a group (`menu_options`). */
export interface MenuOption {
  id: string;
  label: string;
  priceDeltaSatang: Satang;
  /**
   * Preserved from the database even though unavailable-option rendering is
   * deferred (PC-Q-001). Note that RLS currently filters unavailable options
   * out of the customer read path, so in practice this is `true` today — the
   * field exists so the domain does not have to change when PC-Q-001 resolves.
   */
  isAvailable: boolean;
  sortOrder: number;
}

/**
 * An option group (`menu_option_groups`).
 *
 * `minSelect`/`maxSelect` are kept as the database stores them rather than
 * being collapsed to a single `required` boolean. BQ-009 deliberately encodes
 * single-vs-multi-select as *data*, and flattening it here would discard the
 * only thing that distinguishes "pick one" from "pick up to three".
 */
export interface MenuOptionGroup {
  id: string;
  menuItemId: string;
  title: string;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  options: MenuOption[];
}

/** Product, in Food-phase naming (`menu_items`). */
export interface MenuItem {
  id: string;
  shopId: string;
  categoryId: string;
  /** Denormalised from `menu_categories.name` for section grouping in the UI. */
  categoryName: string;
  name: string;
  description: string | null;
  priceSatang: Satang;
  imageUrl: string | null;
  /** Preserved from the database. Rendering is deferred — see PC-Q-001. */
  isAvailable: boolean;
  sortOrder: number;
  /** Present only when the item was fetched individually (C-08). */
  optionGroups?: MenuOptionGroup[];
}

/**
 * Whether a group forces a choice.
 *
 * Derived rather than stored so `minSelect` stays the single source of truth.
 */
export function isRequiredGroup(group: MenuOptionGroup): boolean {
  return group.minSelect >= 1;
}

/** Whether a group accepts more than one selection (BQ-009). */
export function isMultiSelectGroup(group: MenuOptionGroup): boolean {
  return group.maxSelect > 1;
}
