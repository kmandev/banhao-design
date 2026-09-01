import type { ErrorCode } from './error-code';

/**
 * Standard API envelope shared by every BANHAO client.
 *
 * Keeping one shape across all four apps means error handling is written once
 * in @banhao/api-client rather than four times.
 */

/**
 * A failure, in its canonical machine-readable form.
 *
 * **`code` is the contract.** It is the only field a client may branch on, and
 * the only field a client may derive displayed text from. A client resolves a
 * code to its own copy, so one `OFFER_TAKEN` becomes one Thai sentence in the
 * customer app, a different one in the merchant app, and a different one again
 * for a rider — all from the same response (V1.1 §10, §20).
 *
 * The API therefore never decides presentation language or wording. **No
 * user-facing copy — Thai or otherwise — belongs in any field of this type.**
 */
export interface ApiError {
  /**
   * Stable English technical identifier — e.g. `OFFER_TAKEN`, `INVALID_TRANSITION`.
   *
   * Drawn from the canonical catalogue in `./error-code`, so the set of codes a
   * client must handle is exhaustive and checkable. Never render this to a
   * user; resolve it to client-owned copy first.
   */
  code: ErrorCode;

  /**
   * Structured, machine-readable context for the code — e.g.
   * `{ deliveryId: '…' }`, or field errors for `VALIDATION_FAILED`.
   *
   * Values are data a client may use to build its own message. They are not
   * prose to display verbatim.
   */
  details?: Record<string, unknown>;

  /**
   * Correlation id for the request that failed, so a user can quote it to
   * support and an operator can find the matching log line.
   *
   * Populated by the API from the `X-Request-Id` header — adopted if the client
   * sent a valid one, generated otherwise — and echoed on that same response
   * header (V1.1 §11). Remains optional: a response produced outside the
   * request pipeline has no id to report.
   */
  correlationId?: string;

  /**
   * Developer-facing English default, for logs and debugging only.
   *
   * **Optional by design, and never rendered to a user.** A client that
   * displays this is a bug: it bypasses `code`, hardcodes English into the UI,
   * and couples user-visible copy to a server deploy.
   */
  message?: string;
}

export type ApiResponse<T> = { success: true; data: T } | { success: false; error: ApiError };

/**
 * `GET /health` — the platform liveness probe, extended with a database ping
 * (V1.1 §11).
 *
 * **`degraded` is still HTTP 200.** Cloud Run treats a failing health check as
 * a reason to kill and restart the instance, and restarting an API process
 * fixes nothing about an unreachable database — it just turns an outage into a
 * crash loop while the logs fill with startup lines instead of the real cause.
 * The status the operator needs is in the body; the status code stays the one
 * the platform needs.
 */
export interface HealthResponse {
  /** `degraded` means the service is up but its database ping did not succeed. */
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  timestamp: string;
  database: DatabaseHealth;
}

export interface DatabaseHealth {
  status: 'ok' | 'unreachable';
  /** Round-trip time of the ping. Absent when the ping did not complete. */
  latencyMs?: number;
}
