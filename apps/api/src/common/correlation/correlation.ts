import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Correlation identity for one HTTP request (V1.1 §11).
 *
 * **This module is the single definition of the convention.** The header name,
 * the validity rules, and the generator all live here so nothing else in the
 * codebase invents a second one.
 *
 * A correlation id is an *identifier*, never a credential and never a carrier
 * of user data: it is quoted by a user to support, printed in logs, echoed in a
 * response header, and — from Phase E onward — written to the
 * `correlation_id` columns that already exist on `order_status_history`,
 * `delivery_status_history` and `ledger_entry_groups`.
 */

/** The header BANHAO accepts and echoes. Named exactly by V1.1 §11. */
export const CORRELATION_ID_HEADER = 'X-Request-Id';

/** Node lowercases incoming header names; this is the lookup key. */
export const CORRELATION_ID_HEADER_LOWER = CORRELATION_ID_HEADER.toLowerCase();

/**
 * Upper bound on an accepted inbound id.
 *
 * Generous enough for a UUID or a upstream trace id, short enough that a log
 * line cannot be flooded by a hostile client.
 */
export const MAX_CORRELATION_ID_LENGTH = 128;

/**
 * The only shape an inbound id may take: ASCII letters, digits, `-` and `_`.
 *
 * Deliberately narrow. This value is written into log lines and into a response
 * header, so anything that could break either — CR, LF, NUL, control
 * characters, quotes, or a comma from repeated headers that Express has joined
 * — must never survive validation.
 */
const SAFE_CORRELATION_ID = new RegExp(`^[A-Za-z0-9_-]{1,${MAX_CORRELATION_ID_LENGTH}}$`);

/** True when a client-supplied value is safe to adopt verbatim. */
export function isValidCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_CORRELATION_ID.test(value);
}

/**
 * A fresh identifier.
 *
 * UUID v4 from the platform: no dependency, no PII, no ordering to leak request
 * volume, and it already satisfies {@link isValidCorrelationId}.
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * The effective correlation id for a request.
 *
 * Adopts a valid inbound id so a trace survives across a client retry or an
 * upstream hop; otherwise generates one. A malformed or oversized inbound value
 * is silently replaced rather than rejected — a bad debugging header must never
 * be the reason a legitimate order fails.
 */
export function resolveCorrelationId(incoming: unknown): string {
  return isValidCorrelationId(incoming) ? incoming : generateCorrelationId();
}

/**
 * Ambient access to the current request's correlation id.
 *
 * `AsyncLocalStorage` keeps every provider a singleton. The alternative —
 * request-scoped providers — would re-instantiate a provider graph per request
 * for what is one string, and threading the id through every service signature
 * would put an observability concern into domain APIs.
 */
const storage = new AsyncLocalStorage<string>();

/** Runs `fn` (and everything it awaits) with `correlationId` in context. */
export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return storage.run(correlationId, fn);
}

/**
 * The correlation id of the in-flight request, or `undefined` outside one
 * (a worker tick, a unit test, application bootstrap).
 */
export function getCorrelationId(): string | undefined {
  return storage.getStore();
}

/**
 * An Express request carrying its resolved correlation id.
 *
 * Set by {@link CorrelationMiddleware}. The exception filter reads the id from
 * here rather than from the async store, because the request object is the one
 * thing it is always handed.
 */
export interface CorrelatedRequest {
  correlationId?: string;
}
