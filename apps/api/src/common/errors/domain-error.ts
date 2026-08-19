import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@banhao/types';

/**
 * The HTTP status each catalogue code is reported with.
 *
 * Typed as a total `Record<ErrorCode, …>` deliberately: adding a code to
 * `@banhao/types` without deciding its status is a compile error, not a runtime
 * surprise. This map is the *only* place the two concepts meet — HTTP status is
 * transport classification and lives here in the API; `ErrorCode` is the
 * semantic contract and lives in the shared package, because clients care about
 * the code and not the status.
 */
const STATUS_BY_CODE: Record<ErrorCode, HttpStatus> = {
  // Authentication
  UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
  TOKEN_EXPIRED: HttpStatus.UNAUTHORIZED,
  PROFILE_NOT_FOUND: HttpStatus.UNAUTHORIZED,

  // Authorization — distinct from authentication, and never downgraded to 401.
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_RESTAURANT_MEMBER: HttpStatus.FORBIDDEN,
  NOT_ASSIGNED_RIDER: HttpStatus.FORBIDDEN,

  // Validation
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,

  // Business rule — all 409, all semantically distinct.
  INVALID_TRANSITION: HttpStatus.CONFLICT,
  RESTAURANT_CLOSED: HttpStatus.CONFLICT,
  ITEM_UNAVAILABLE: HttpStatus.CONFLICT,
  ACCEPT_WINDOW_EXPIRED: HttpStatus.CONFLICT,
  // Cart revalidation (Phase D). Both are business-rule conflicts, not
  // validation failures: the request was well-formed and the customer did
  // nothing wrong — the world moved underneath the cart.
  PRICE_CHANGED: HttpStatus.CONFLICT,
  MIXED_RESTAURANT: HttpStatus.CONFLICT,
  // Order creation (Phase E-2) — same reasoning as the cart pair above: a
  // well-formed request from a customer who did nothing wrong.
  CART_EMPTY: HttpStatus.CONFLICT,

  // Concurrency — also 409, and the reason status alone cannot carry meaning.
  OFFER_TAKEN: HttpStatus.CONFLICT,
  NOT_RELEASABLE: HttpStatus.CONFLICT,

  // Payment
  PAYMENT_ALREADY_SUCCEEDED: HttpStatus.CONFLICT,
  PROVIDER_UNAVAILABLE: HttpStatus.PAYMENT_REQUIRED,
  MECHANISM_UNAVAILABLE: HttpStatus.PAYMENT_REQUIRED,

  // Transport-level fallbacks
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  NOT_IMPLEMENTED: HttpStatus.NOT_IMPLEMENTED,

  // Unexpected
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,

  // Client-generated only — @banhao/api-client raises this when a response
  // cannot be parsed. The API never throws it; the entry exists so the map
  // stays total over the catalogue.
  INVALID_RESPONSE: HttpStatus.BAD_GATEWAY,
};

export interface DomainErrorOptions {
  /** Structured machine-readable context, e.g. `{ deliveryId }`. Not prose. */
  details?: Record<string, unknown>;
  /** Developer-facing English for logs. Never rendered to a user. */
  message?: string;
  /** Override the catalogue status. Rare — prefer the default. */
  status?: HttpStatus;
}

/**
 * A domain condition, carrying its own semantic error code.
 *
 * Extends `HttpException` rather than competing with it, so Nest's existing
 * exception handling (status resolution, `@Catch`, testing utilities) keeps
 * working unchanged — `HttpExceptionFilter` simply reads `.code` when present.
 *
 * This is the typed mechanism that replaces inferring meaning from an HTTP
 * status. Two conditions that share a status stay distinguishable:
 *
 * ```ts
 * throw new DomainError('OFFER_TAKEN', { details: { deliveryId } });      // 409
 * throw new DomainError('INVALID_TRANSITION', { details: { from, to } }); // 409
 * ```
 *
 * Never match on `message` to recover meaning — that is what `code` is for.
 */
export class DomainError extends HttpException {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, options: DomainErrorOptions = {}) {
    // The developer-facing default is the code itself: honest in a log, and
    // useless as UI copy, which is exactly the intent.
    super(options.message ?? code, options.status ?? STATUS_BY_CODE[code]);
    this.name = 'DomainError';
    this.code = code;
    this.details = options.details;
  }
}

/** The status a code is reported with. Exported for tests and documentation. */
export function statusForErrorCode(code: ErrorCode): HttpStatus {
  return STATUS_BY_CODE[code];
}
