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

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, string[]>;

  constructor(status: number, error: ApiError) {
    super(error.message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = error.code;
    this.details = error.details;
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
