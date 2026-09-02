import { z } from 'zod';

/**
 * M-10 Restaurant Profile — the descriptive-field write contract.
 *
 * `docs/design/BANHAO M-10 Restaurant Profile.dc.html` §04/§07 is the source
 * for exactly these four fields and exactly this validation. No length limit,
 * phone format, or required-address rule is confirmed anywhere in the
 * database or API today (M10-Q-04, M10-C02) — this schema enforces only what
 * the design itself states as a settled rule: `name` is required and
 * non-empty. Nothing else is a blocking rule here, matching §07's own
 * distinction between "REQUIRED" and every other row it marks a proposal or
 * an open product decision.
 *
 * `cuisine` is deliberately absent — M10-Q-01 (should cuisine be merchant-
 * editable at all) is unresolved in the design itself, so this contract does
 * not expose a write path for it. `status`, `lat`, `lng`, `location`,
 * `zone_id`, `temporarily_closed_until`, `temporary_close_reason`,
 * `merchant_id` and the numeric/rating columns are none of this screen's
 * concern (§00 — "the descriptive half of the storefront, not its
 * lifecycle") and are not represented in this schema at all, so a client
 * cannot smuggle a write to any of them through this endpoint.
 *
 * Optional fields accept an empty string, meaning "clear this field" — the
 * service maps `''` to `null` on write, since the underlying columns are
 * nullable text with no format constraint.
 */
export const updateRestaurantProfileSchema = z
  .object({
    name: z.string().trim().min(1, 'Restaurant name is required'),
    description: z.string().trim(),
    phone: z.string().trim(),
    addressLine: z.string().trim(),
  })
  .strict();

export type UpdateRestaurantProfileInput = z.infer<typeof updateRestaurantProfileSchema>;

/**
 * The saved profile, re-read from the database rather than echoed from the
 * request — the same "the saved state is what the server re-read" posture
 * `RestaurantHoursResponse` already established for M-12.
 */
export interface RestaurantProfileResponse {
  restaurantId: string;
  name: string;
  description: string | null;
  phone: string | null;
  addressLine: string | null;
  updatedAt: string;
}
