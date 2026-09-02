import type { RestaurantProfileResponse } from '@banhao/validation';

/**
 * M-10 Restaurant Profile domain.
 *
 * Thin, matching `restaurantHours.ts`'s own precedent: the wire contract
 * (`RestaurantProfileResponse`, `UpdateRestaurantProfileInput`) lives in
 * `@banhao/validation` because the API and this app must agree on it. What
 * this module adds is the form-only shape and the one client-side check the
 * design proposes but the API does not enforce (M-10 §07 — phone format is
 * "DESIGN PROPOSAL, NOT API-ENFORCED").
 */

/** The form's working copy of a profile — always four strings, never null. */
export interface RestaurantProfileDraft {
  name: string;
  description: string;
  phone: string;
  addressLine: string;
}

/**
 * Either the API's `RestaurantProfileResponse` (camelCase) or the raw
 * Supabase row shape (`snake_case`, from `restaurantProfileQueries.ts`) to
 * the form's draft shape — the two read paths (initial load vs. after save)
 * disagree on casing, and this is the one place that difference is absorbed.
 */
export function toDraft(profile: {
  name: string;
  description: string | null;
  phone: string | null;
  addressLine?: string | null;
  address_line?: string | null;
}): RestaurantProfileDraft {
  return {
    name: profile.name,
    description: profile.description ?? '',
    phone: profile.phone ?? '',
    addressLine: profile.addressLine ?? profile.address_line ?? '',
  };
}

/** The form back to the request the API expects — always strings, never null. */
export function toRequest(draft: RestaurantProfileDraft) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    phone: draft.phone.trim(),
    addressLine: draft.addressLine.trim(),
  };
}

export function fromSaveResponse(response: RestaurantProfileResponse): RestaurantProfileDraft {
  return toDraft(response);
}

/**
 * A loose Thai phone pattern — 9 or 10 digits, optional dashes — matching
 * M-10 §07's own proposal exactly. This is advisory only: the database has no
 * format constraint on `phone` and the API does not enforce this pattern
 * (M10-C02), so this function never blocks a save on its own; the caller
 * decides whether to treat its result as blocking.
 */
const PHONE_PATTERN = /^[0-9]{2,4}(-?[0-9]{2,4}){0,2}$/;

/**
 * `+66` → `0`, the same substitution `apps/customer/src/lib/formatThaiPhone`
 * exists to do in reverse for display — this is the read side of that same
 * local ⟺ E.164 equivalence. Restaurant rows already store `phone` as E.164
 * (`profiles.phone`'s own format, per Supabase Auth), so a live, untouched,
 * valid number like `+66812345678` failed this check purely because it was
 * never normalised — the local `0812345678` it is equivalent to always
 * passed. Only a `+66` prefix is unwrapped; every other value is checked
 * exactly as before.
 */
function normaliseToLocal(phone: string): string {
  return phone.startsWith('+66') ? `0${phone.slice(3)}` : phone;
}

export function isPlausibleThaiPhone(phone: string): boolean {
  const local = normaliseToLocal(phone);
  const digitsOnly = local.replace(/-/g, '');
  return PHONE_PATTERN.test(local) && digitsOnly.length >= 9 && digitsOnly.length <= 10;
}

export interface ProfileValidationIssues {
  /** Blocks save. Empty means the required field is filled. */
  nameRequired: boolean;
  /** Blocks save. Only checked when phone is non-empty (optional field). */
  phoneInvalid: boolean;
  /** Advisory only (M10-Q-02 unresolved) — never blocks save. */
  addressAdvisory: boolean;
}

export function validateProfileDraft(draft: RestaurantProfileDraft): ProfileValidationIssues {
  const trimmedPhone = draft.phone.trim();
  return {
    nameRequired: draft.name.trim().length === 0,
    phoneInvalid: trimmedPhone.length > 0 && !isPlausibleThaiPhone(trimmedPhone),
    addressAdvisory: draft.addressLine.trim().length === 0,
  };
}

/** Whether the draft has an issue that must block save (name, phone — not the advisory address). */
export function hasBlockingIssue(issues: ProfileValidationIssues): boolean {
  return issues.nameRequired || issues.phoneInvalid;
}
