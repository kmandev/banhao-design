/**
 * Presentation-only phone formatting.
 *
 * The canonical value is the E.164 identity Supabase Auth holds (`+66812345678`)
 * and `profiles.phone` mirrors it. Neither is touched here — a client cannot
 * write `profiles.phone` at all (column privileges + trigger, see
 * supabase/migrations/20260809000003_harden_profiles_rls.sql), and a phone
 * change must go through Auth's own OTP-verified flow.
 *
 * The Customer design writes Thai mobile numbers in national form with
 * space-separated groups — `081 234 5678` — so that is what the UI shows.
 */

/**
 * Formats a Thai mobile number for display.
 *
 * Returns the input unchanged when it is not a recognisable Thai mobile number,
 * because inventing a format for an unexpected value would be worse than
 * showing the raw one.
 */
export function formatThaiPhone(phone: string | null | undefined): string {
  if (!phone) return '';

  const digits = phone.replace(/\D/g, '');

  // Accept both the stored E.164 form and the same digits without the `+`.
  const national =
    digits.length === 11 && digits.startsWith('66') ? `0${digits.slice(2)}` : digits;

  if (!/^0\d{9}$/.test(national)) return phone;

  return `${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
}
