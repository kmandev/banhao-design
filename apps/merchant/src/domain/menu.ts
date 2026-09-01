import type { Satang } from '@banhao/types';

/**
 * M-11 Menu Management domain — the merchant's own view of the catalog.
 *
 * Sourced directly from `20260811000003_catalog_domain.sql`, not from
 * `apps/customer/src/domain/catalog.ts`: apps in this monorepo depend only on
 * `@banhao/*` workspace packages, never on each other's `src`. The same
 * boundary `domain/order.ts` documents, resolved the same way.
 *
 * The merchant shape differs from the customer one in what it must carry:
 * `archivedAt` and `sortOrder` are editing concerns a customer never sees, and
 * `isAvailable` is a control here rather than a filter.
 *
 * Money is integer satang (CON-003). Baht appears only in the UI, at the
 * boundary where the merchant types it (M11-D05).
 */

export interface MenuCategory {
  id: string;
  name: string;
  sortOrder: number;
  /** Non-null means retired. The overview reads only active categories. */
  archivedAt: string | null;
}

export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  /** Nullable — the customer app renders no second line when absent. */
  description: string | null;
  basePriceSatang: Satang;
  /** An object key, not a URL. Resolved for display by the storage public base. */
  imageUrl: string | null;
  /** `ปิดขายวันนี้` is `false`. There is no second availability model. */
  isAvailable: boolean;
  sortOrder: number;
  archivedAt: string | null;
  updatedAt: string;
  /** How many option groups the dish has — the row badge, not the groups themselves. */
  optionGroupCount: number;
}

export interface MenuOption {
  id: string;
  label: string;
  /** May be negative: no CHECK forbids it, and the migration says so deliberately. */
  priceDeltaSatang: number;
  isAvailable: boolean;
  sortOrder: number;
}

export interface MenuOptionGroup {
  id: string;
  title: string;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  options: MenuOption[];
}

/** The whole overview: categories in `sort_order`, each with its dishes. */
export interface MenuSection {
  category: MenuCategory;
  items: MenuItem[];
}

/**
 * The three shapes a `min_select` / `max_select` pair can take, as the editor
 * offers them (M11-D07).
 *
 * The presets are a UI vocabulary over two stored numbers, not a stored value:
 * `min_select`/`max_select` exist precisely so BQ-009 stays data rather than
 * schema, and asking a merchant to enter the pair would leak that decision
 * into the shop.
 */
export type OptionSelectPreset = 'REQUIRED_ONE' | 'OPTIONAL_ONE' | 'MULTIPLE';

/** The pair a preset writes. `MULTIPLE` keeps the merchant's own maximum. */
export function presetToRange(
  preset: OptionSelectPreset,
  maxForMultiple: number,
): { minSelect: number; maxSelect: number } {
  switch (preset) {
    case 'REQUIRED_ONE':
      return { minSelect: 1, maxSelect: 1 };
    case 'OPTIONAL_ONE':
      return { minSelect: 0, maxSelect: 1 };
    case 'MULTIPLE':
      return { minSelect: 0, maxSelect: Math.max(1, maxForMultiple) };
  }
}

/**
 * Reads a stored pair back as the preset that produced it.
 *
 * A pair no preset produces — `min 2 / max 3`, say, which the schema permits —
 * reads as `MULTIPLE`, because that is the only preset whose maximum the
 * merchant controls and so the only one that can round-trip the number. The
 * editor shows the stored pair in mono beside the rule for exactly this case
 * (M-11 §06), so an operator can always read what was actually stored.
 */
export function rangeToPreset(minSelect: number, maxSelect: number): OptionSelectPreset {
  if (minSelect === 1 && maxSelect === 1) return 'REQUIRED_ONE';
  if (minSelect === 0 && maxSelect === 1) return 'OPTIONAL_ONE';
  return 'MULTIPLE';
}
