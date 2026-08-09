/**
 * Standard API envelope shared by every BANHAO client.
 *
 * Keeping one shape across all four apps means error handling is written once
 * in @banhao/api-client rather than four times.
 */
export interface ApiError {
  code: string;
  message: string;
  /** Field-level detail, when the failure is a validation error. */
  details?: Record<string, string[]>;
}

export type ApiResponse<T> = { success: true; data: T } | { success: false; error: ApiError };

export interface HealthResponse {
  status: 'ok';
  service: string;
  version: string;
  timestamp: string;
}
