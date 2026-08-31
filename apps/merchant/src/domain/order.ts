import type { Satang } from '@banhao/types';

/**
 * Merchant Order Board domain — the minimal order projection the board reads
 * (M-2.2, M2-DATA-001).
 *
 * `state` is `orders.state`'s own CHECK-constrained vocabulary
 * (`supabase/migrations/20260811000005_order_domain.sql`), listed here
 * directly from that constraint rather than imported from
 * `apps/customer/src/domain/order.ts`'s `OrderState`: apps in this monorepo
 * depend only on `@banhao/*` workspace packages, never on each other's
 * `src`, and M2-TYPE-001 forbids adding a shared `Order` type to
 * `@banhao/types` to bridge that gap. `apps/driver/src/domain/riderOrder.ts`
 * hits the same boundary and resolves it by typing `state` as a bare
 * `string`, because a rider only ever sees a state subset; the Board instead
 * needs to branch on the full lifecycle (accept/prepare/ready/pickup), so
 * this file keeps the precision of a literal union rather than widening to
 * `string` — sourced independently from the same CHECK constraint, the
 * canonical definition, not from another app's type.
 *
 * Fields are exactly the M2-DATA-001 board projection of `orders` —
 * `order_items` / `order_item_options` are deferred to the future order
 * detail panel and have no place here.
 */
export type OrderState =
  | 'CREATED'
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'MERCHANT_ACCEPTED'
  | 'PREPARING'
  | 'READY_FOR_PICKUP'
  | 'PICKED_UP'
  | 'DELIVERING'
  | 'DELIVERED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_EXPIRED'
  | 'MERCHANT_REJECTED'
  | 'CANCELLED'
  | 'DELIVERY_FAILED';

/**
 * One row of the Merchant Order Board, as `public.orders` alone can supply
 * it under `orders_select_merchant` RLS (`is_restaurant_member(restaurant_id)`).
 *
 * Every field maps 1:1 to an `orders` column (M2-DATA-001) — nothing here is
 * joined, aggregated, or derived. Nullability follows the column definitions
 * in `20260811000005_order_domain.sql` exactly:
 * `accepted_at` / `ready_at` / `picked_up_at` have no `not null` and no
 * default, so a `CREATED` or `PAID` order legitimately has not reached them
 * yet — they stay optional here rather than being defaulted or guessed.
 */
export interface MerchantOrderSummary {
  id: string;
  orderNumber: string;
  state: OrderState;
  restaurantId: string;
  recipientNameSnapshot: string;
  recipientPhoneSnapshot: string;
  grandTotalSatang: Satang;
  /** `orders.placed_at` — `not null`, ISO-8601 as PostgREST returns `timestamptz`. */
  placedAt: string;
  /** `orders.accepted_at` — null until `MERCHANT_ACCEPTED`. */
  acceptedAt: string | null;
  /** `orders.ready_at` — null until `READY_FOR_PICKUP`. */
  readyAt: string | null;
  /** `orders.picked_up_at` — null until `PICKED_UP`. */
  pickedUpAt: string | null;
}
