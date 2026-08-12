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
    this.fetchImpl = options.fetch ?? globalThis.fetch;
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
