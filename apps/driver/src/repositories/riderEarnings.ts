import type { EarningsResponse } from '@banhao/validation';
import { apiClient } from '../lib/apiClient';

/** DEC-073 — the signed-in rider's own earnings for a week (the API scopes it to the session's rider). */
export function fetchRiderEarnings(weekStart: string): Promise<EarningsResponse> {
  return apiClient.request<EarningsResponse>(`/api/v1/rider/earnings?week=${encodeURIComponent(weekStart)}`);
}
