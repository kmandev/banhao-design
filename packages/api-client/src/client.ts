import type { ApiResponse, ApiError, MeResponse, HealthResponse } from '@banhao/types';

/**
 * One HTTP client shared by all four BANHAO apps (customer, merchant, driver,
 * admin) so fetch/auth/error handling is written once rather than four times.
 *
 * The access token is supplied by a callback rather than stored here, because
 * each app holds its Supabase session differently (SecureStore on mobile,
 * cookies on web) and the client shouldn't care which.
 */

export interface ApiClientOptions {
  baseUrl: string;
  /** Returns the current Supabase access token, or null when signed out. */
  getAccessToken?: () => string | null | Promise<string | null>;
  /** Injectable for tests; defaults to global fetch. */
  fetch?: typeof fetch;
}

/**
 * A failed API call, surfaced as an Error.
 *
 * Callers branch on `code` — never on `message`. `Error.message` here is a
 * developer-facing string for stack traces and logs; it falls back to `code`
 * precisely because the server is not required to send one, and must never be
 * relied on for anything a user sees. Resolve `code` to client-owned copy.
 */
export class ApiClientError extends Error {
  readonly status: number;
  /** The canonical machine-readable contract. Branch on this. */
  readonly code: string;
  /** Structured context for `code` — not prose to display. */
  readonly details?: Record<string, unknown>;
  /** Set once the API populates it (Phase A / A-4); quotable to support. */
  readonly correlationId?: string;

  constructor(status: number, error: ApiError) {
    // `message` is optional in the contract, so fall back to the code rather
    // than producing an Error with an empty message.
    super(error.message ?? error.code);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = error.code;
    this.details = error.details;
    this.correlationId = error.correlationId;
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly getAccessToken?: () => string | null | Promise<string | null>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.getAccessToken = options.getAccessToken;
    // Binding the global is load-bearing, not defensive style. A browser's
    // `fetch` is a method of `Window` and throws
    // `TypeError: Illegal invocation` when invoked with any other receiver —
    // and `this.fetchImpl(...)` below calls it with the ApiClient instance as
    // the receiver. Without the bind, every browser call through this client
    // fails before a request is ever sent.
    //
    // This went unnoticed until the Merchant app (M-2.7) became the first
    // consumer to actually call a write endpoint from a browser: the Customer
    // and Driver apps are React Native, whose `fetch` polyfill is a plain
    // function with no receiver check, and tests inject their own
    // `options.fetch`, which is likewise unbound. An injected fetch is left
    // exactly as given — binding is only ever applied to the global.
    //
    // The `typeof` guard matters: this class is constructed at module scope by
    // every app's `lib/apiClient.ts`, including under jsdom, where
    // `globalThis.fetch` is undefined. Binding unconditionally would throw
    // there at import time and take down suites that never make a request.
    // When there is no global fetch, the original behaviour is kept exactly:
    // store the undefined and let the failure surface at call time.
    const globalFetch = globalThis.fetch;
    this.fetchImpl =
      options.fetch ?? (typeof globalFetch === 'function' ? globalFetch.bind(globalThis) : globalFetch);
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json');

    const token = await this.getAccessToken?.();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });

    let body: ApiResponse<T>;
    try {
      body = (await response.json()) as ApiResponse<T>;
    } catch {
      throw new ApiClientError(response.status, {
        code: 'INVALID_RESPONSE',
        // The path is structured context, not something to read out of prose.
        details: { path },
        message: `Expected JSON from ${path} but could not parse the response body`,
      });
    }

    if (!body.success) {
      throw new ApiClientError(response.status, body.error);
    }

    return body.data;
  }

  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/health');
  }

  me(): Promise<MeResponse> {
    return this.request<MeResponse>('/api/v1/me');
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  return new ApiClient(options);
}
