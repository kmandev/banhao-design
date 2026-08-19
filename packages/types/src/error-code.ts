/**
 * The canonical BANHAO API error catalogue (Application Architecture V1.1 §10).
 *
 * **This is the contract between the API and every client.** A client branches
 * on a code and resolves it to its own copy — the same `OFFER_TAKEN` becomes one
 * Thai sentence in the customer app, a different one in the merchant app, and a
 * different one again for a rider. The API never decides wording or language.
 *
 * Codes are therefore stable, English, machine-readable, and describe a
 * *domain or API condition* — never a presentation string.
 *
 * ## Adding a code
 *
 * Add it here first. This union is the single source of truth: `ApiError.code`
 * is typed to it, and the API's status map is keyed by it, so a new code will
 * not compile until it has been given an HTTP status too.
 *
 * Codes for endpoints that do not exist yet are deliberately **not** listed.
 * V1.1 §6 documents per-operation codes (`CART_EMPTY`, `PRICE_CHANGED`,
 * `ORDER_NOT_PAYABLE`, …); each arrives with the phase that builds its endpoint.
 */
export const ERROR_CODES = [
  // --- Authentication · 401 -------------------------------------------------
  // Client behaviour: clear the session and return to login.
  'UNAUTHORIZED',
  'TOKEN_EXPIRED',
  'PROFILE_NOT_FOUND',

  // --- Authorization · 403 --------------------------------------------------
  // Client behaviour: show a message. Do NOT log out — a rider hitting a
  // merchant endpoint is a bug, not a session problem.
  'FORBIDDEN',
  'NOT_RESTAURANT_MEMBER',
  'NOT_ASSIGNED_RIDER',

  // --- Validation · 400 -----------------------------------------------------
  // Client behaviour: inline field errors, read from `details`.
  'VALIDATION_FAILED',

  // --- Business rule · 409 --------------------------------------------------
  // Client behaviour: explain, and offer the next action.
  'INVALID_TRANSITION',
  'RESTAURANT_CLOSED',
  'ITEM_UNAVAILABLE',
  'ACCEPT_WINDOW_EXPIRED',
  // Cart revalidation (Phase D). Both are raised by `POST /cart/validate`,
  // which lands at D-6; the codes are added here first because this union is
  // what the status map and both clients are typed against.
  //
  // `PRICE_CHANGED` — a cart line's live catalog price no longer matches what
  // the customer was shown. UX-SPEC § 13 renders it as a per-line old → new
  // diff (`ราคามีการเปลี่ยนแปลง`), never a silent re-price: the customer
  // acknowledges the new number before it can become an order.
  //
  // `MIXED_RESTAURANT` — DEC-017, one cart = one restaurant. The composite
  // foreign keys on `cart_items` already make a mixed cart impossible to
  // *store*; this code exists so the customer gets the C-09 dialog
  // (`ตะกร้ามีอาหารจากร้านอื่นอยู่`) instead of a raw constraint violation.
  // The database is the enforcement; this code is the explanation.
  'PRICE_CHANGED',
  'MIXED_RESTAURANT',

  // --- Concurrency · 409 ----------------------------------------------------
  // Client behaviour: refresh and re-render. A normal outcome of a race, not an
  // error state to alarm anyone with.
  'OFFER_TAKEN',
  'NOT_RELEASABLE',

  // --- Payment · 402 / 409 --------------------------------------------------
  // Client behaviour: retry or escalate. Never assume success.
  'PAYMENT_ALREADY_SUCCEEDED',
  'PROVIDER_UNAVAILABLE',
  'MECHANISM_UNAVAILABLE',

  // --- Transport-level fallbacks --------------------------------------------
  // Used when an exception carries no semantic code of its own. A domain
  // condition must NOT settle for these: `CONFLICT` in particular exists only
  // so a bare 409 is still well-formed, and any real conflict should name
  // itself (`OFFER_TAKEN`, `INVALID_TRANSITION`, …).
  'NOT_FOUND',
  'CONFLICT',
  'NOT_IMPLEMENTED',

  // --- Unexpected · 500 -----------------------------------------------------
  // Generic to the client, logged in full on the server.
  'INTERNAL_ERROR',

  // --- Client-generated -----------------------------------------------------
  // Produced by @banhao/api-client, never sent by the API: the response could
  // not be parsed as the shared envelope at all.
  'INVALID_RESPONSE',
] as const;

/** A code from the canonical catalogue above. */
export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Narrows an unknown value to a catalogue code.
 *
 * Useful at a trust boundary — a client decoding a response from an API version
 * newer than itself may legitimately see a code it does not know.
 */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}
