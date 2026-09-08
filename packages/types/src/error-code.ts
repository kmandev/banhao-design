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
  // Order creation (Phase E-2). `POST /orders`' own failure list (V1.1 §6):
  // the caller has no cart, or the cart resolves to zero lines. Distinct from
  // `ITEM_UNAVAILABLE` — this is "there is nothing to order", not "something
  // in the order can't be had".
  'CART_EMPTY',
  // Payment creation (Phase F-1). `POST /orders/:id/payment`'s own failure
  // list (V1.1 §6): the order is not in a state that can start a payment —
  // any state other than `CREATED` (starting one) or `PENDING_PAYMENT` (an
  // idempotent retry of one already started, DEC-028).
  'ORDER_NOT_PAYABLE',

  // --- Concurrency · 409 ----------------------------------------------------
  // Client behaviour: refresh and re-render. A normal outcome of a race, not an
  // error state to alarm anyone with.
  'OFFER_TAKEN',
  'NOT_RELEASABLE',
  // Rider dispatch (Phase G-2). Both are named by V1.1 §6's own failure list
  // for `POST /rider/offers/:id/accept`, and both are ordinary outcomes of a
  // broadcast under DEC-020 rather than faults:
  //
  // `OFFER_EXPIRED` — the offer's 60-second accept window (DEC-037, BQ-020)
  // closed before this rider tapped. The delivery is still searching; the
  // next round will offer it again.
  //
  // `RIDER_HAS_ACTIVE_DELIVERY` — DEC-037 (BQ-021) limits a rider to one
  // active delivery in Phase 1. Raised only by the guarded write that
  // enforces it, never by a pre-check that could be raced past.
  'OFFER_EXPIRED',
  'RIDER_HAS_ACTIVE_DELIVERY',

  // --- Payment · 402 / 409 --------------------------------------------------
  // Client behaviour: retry or escalate. Never assume success.
  'PAYMENT_ALREADY_SUCCEEDED',
  'PROVIDER_UNAVAILABLE',
  'MECHANISM_UNAVAILABLE',
  // Payment creation (Phase F-1, DEC-056). BANHAO has no authoritative
  // customer email yet — a real, valid one is required to confirm a Stripe
  // PromptPay payment. Same category as `ORDER_NOT_PAYABLE`: the caller did
  // nothing wrong on this request, but a precondition this specific customer
  // hasn't met is blocking it. Never raised in place of a substituted value —
  // DEC-056 forbids a synthetic or client-supplied fallback.
  'CUSTOMER_EMAIL_REQUIRED',
  // Refund initiation (Q-020 Slice 1, DEC-057/058/059). All three are 409:
  // the caller (an operator) did nothing wrong, but the order/payment/refund
  // is not in a state this endpoint can act on.
  //
  // `ORDER_NOT_REFUND_ELIGIBLE` — the order's current state is not one
  // DEC-050 (cancellation) or DEC-053 (post-pickup failure, non-customer-
  // caused) makes eligible for a full refund.
  //
  // `PAYMENT_NOT_REFUNDABLE` — the order's payment does not exist, or exists
  // but is not `SUCCESS` — there is no settled money to refund.
  //
  // `REFUND_ALREADY_EXISTS` — this payment already has a `refunds` row whose
  // state is `REFUNDED` (DEC-057 §1, full-refund-only: a second refund
  // against an already-refunded payment is never legitimate in Phase 1).
  'ORDER_NOT_REFUND_ELIGIBLE',
  'PAYMENT_NOT_REFUNDABLE',
  'REFUND_ALREADY_EXISTS',

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
