import { z } from 'zod';

/**
 * M-13 Merchant Availability (Normal / Busy / Paused) — the mode-change write
 * contract.
 *
 * `docs/design/BANHAO MERCHANT - NORMAL BUSY PAUSE - AVAILABILITY FLOW.dc.html`
 * is the source design; the AV-Q04/AV-Q03/AV-Q01/BQ-013 decision lock is what
 * turned it into an approved, buildable model. This is the merchant-facing
 * write half — `restaurants.availability_mode` / `busy_prep_minutes`
 * (`20260904000001_restaurant_availability_mode.sql`) is the storage.
 *
 * ## Why a discriminated union, not one flat object
 *
 * `busyPrepMinutes` is required for BUSY and forbidden for NORMAL/PAUSED —
 * the database CHECK (`restaurants_availability_mode_pairing_check`) already
 * enforces this pairing, and a flat `{ mode, busyPrepMinutes? }` shape would
 * let a client send a value the server discards silently or an omission the
 * server has to reject with a generic message. The union makes the invalid
 * shapes (`BUSY` with no minutes, `PAUSED` with minutes) unrepresentable at
 * the type level, matching the CHECK below it rather than merely hoping to.
 *
 * ## The five values, not `positive()`
 *
 * Unlike `orders.prep_minutes` (`packages/validation/src/order.ts`), where
 * M05-Q-01 deliberately leaves the five UI presets open to become
 * per-restaurant configuration and the schema constrains only `> 0`, this
 * decision lock's Product Owner approval is explicit: the busy set is fixed
 * at 10/20/30/45/60 and must be enforced by a database CHECK, not
 * application validation alone
 * (`restaurants_busy_prep_minutes_values_check`). This schema enforces the
 * same five values at the contract boundary so a malformed request is
 * rejected before it reaches the database, not merely by it.
 */
export const BUSY_PREP_MINUTE_VALUES = [10, 20, 30, 45, 60] as const;

export const setRestaurantAvailabilitySchema = z
  .discriminatedUnion('mode', [
    z.object({ mode: z.literal('NORMAL') }).strict(),
    z
      .object({
        mode: z.literal('BUSY'),
        busyPrepMinutes: z.union([
          z.literal(10),
          z.literal(20),
          z.literal(30),
          z.literal(45),
          z.literal(60),
        ]),
      })
      .strict(),
    z.object({ mode: z.literal('PAUSED') }).strict(),
  ])
  .describe('M-13 availability mode change. BUSY requires busyPrepMinutes; NORMAL and PAUSED accept none.');

/**
 * DEC-068 C3 — the same mode change, made by BANHAO staff (`ADMIN` or
 * `OPERATOR`) on a restaurant's behalf. Identical in every rule to
 * {@link setRestaurantAvailabilitySchema} plus a required `reason`: a staff
 * change is a manual operator action (DEC-032), and
 * `audit_logs_operator_reason_check` makes an audit row without one
 * impossible, so it must not be possible to send the request without one.
 */
const staffReason = z.string().trim().min(1).max(2000);

export const staffSetRestaurantAvailabilitySchema = z
  .discriminatedUnion('mode', [
    z.object({ mode: z.literal('NORMAL'), reason: staffReason }).strict(),
    z
      .object({
        mode: z.literal('BUSY'),
        busyPrepMinutes: z.union([
          z.literal(10),
          z.literal(20),
          z.literal(30),
          z.literal(45),
          z.literal(60),
        ]),
        reason: staffReason,
      })
      .strict(),
    z.object({ mode: z.literal('PAUSED'), reason: staffReason }).strict(),
  ])
  .describe('Staff availability mode change (DEC-068 C3). Same rules as the merchant change, plus a required reason.');

export type StaffSetRestaurantAvailabilityInput = z.infer<typeof staffSetRestaurantAvailabilitySchema>;

export type SetRestaurantAvailabilityInput = z.infer<typeof setRestaurantAvailabilitySchema>;

export type RestaurantAvailabilityMode = 'NORMAL' | 'BUSY' | 'PAUSED';

/**
 * The saved availability, re-read from the database rather than echoed from
 * the request — the same posture `RestaurantHoursResponse` and
 * `RestaurantProfileResponse` already establish for M-12/M-10.
 */
export interface RestaurantAvailabilityResponse {
  restaurantId: string;
  availabilityMode: RestaurantAvailabilityMode;
  busyPrepMinutes: number | null;
  updatedAt: string;
}
