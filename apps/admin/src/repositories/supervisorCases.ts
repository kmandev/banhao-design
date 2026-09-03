import type {
  ResolveSupervisorCaseRequest,
  ResolveSupervisorCaseResponse,
  SupervisorCaseDetailResponse,
  SupervisorCaseListResponse,
  SupervisorIdentityResponse,
} from '@banhao/validation';
import { apiClient } from '../lib/apiClient';

/**
 * The Human Supervisor console's data path — every call a named endpoint under
 * `/api/v1/admin/supervisor`.
 *
 * There is no Supabase read here and no generic mutation helper, deliberately:
 * DEC-APP-008 keeps the admin app off the database, and the Admin design
 * package's DO NOT BUILD list names a direct Supabase read as one of the four
 * things this app must never acquire. The whole surface is four calls, and
 * exactly one of them writes.
 */
export interface SupervisorCaseRepository {
  identity(): Promise<SupervisorIdentityResponse>;
  list(limit?: number): Promise<SupervisorCaseListResponse>;
  detail(caseId: string): Promise<SupervisorCaseDetailResponse>;
  resolve(
    caseId: string,
    request: ResolveSupervisorCaseRequest,
  ): Promise<ResolveSupervisorCaseResponse>;
}

const BASE = '/api/v1/admin/supervisor';

export const supervisorCaseRepository: SupervisorCaseRepository = {
  identity() {
    return apiClient.request<SupervisorIdentityResponse>(`${BASE}/me`);
  },

  list(limit) {
    const query = limit === undefined ? '' : `?limit=${encodeURIComponent(String(limit))}`;
    return apiClient.request<SupervisorCaseListResponse>(`${BASE}/cases${query}`);
  },

  detail(caseId) {
    return apiClient.request<SupervisorCaseDetailResponse>(
      `${BASE}/cases/${encodeURIComponent(caseId)}`,
    );
  },

  resolve(caseId, request) {
    return apiClient.request<ResolveSupervisorCaseResponse>(
      `${BASE}/cases/${encodeURIComponent(caseId)}/resolve`,
      { method: 'POST', body: JSON.stringify(request) },
    );
  },
};
