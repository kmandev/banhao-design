import type { PayoutHistoryRow, RecordPayoutRequest, SettlementReportResponse } from '@banhao/validation';
import { apiClient } from '../lib/apiClient';

/** DEC-073 — pilot settlement. Reads for any staff; recording and voiding are ADMIN-only (the API enforces it). */
const BASE = '/api/v1/admin/supervisor/settlement';

export const settlementRepository = {
  report(weekStart: string) {
    return apiClient.request<SettlementReportResponse>(`${BASE}/report?week=${encodeURIComponent(weekStart)}`);
  },
  history() {
    return apiClient.request<PayoutHistoryRow[]>(`${BASE}/payouts`);
  },
  record(request: RecordPayoutRequest) {
    return apiClient.request<{ payoutId: string }>(`${BASE}/payouts`, { method: 'POST', body: JSON.stringify(request) });
  },
  void(payoutId: string, reason: string) {
    return apiClient.request<{ voided: true }>(`${BASE}/payouts/${encodeURIComponent(payoutId)}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },
};
