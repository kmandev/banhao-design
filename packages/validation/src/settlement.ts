import { z } from 'zod';
import { uuidSchema } from './common';

/**
 * DEC-073 — pilot settlement. A week is identified by its Monday (Asia/Bangkok),
 * `YYYY-MM-DD`. Amounts are always computed by the server from frozen order
 * facts; no request carries an amount.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/** True when `YYYY-MM-DD` is a Monday. */
export function isMonday(date: string): boolean {
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.getUTCDay() === 1;
}

export const weekStartSchema = isoDate.refine(isMonday, 'the week must start on a Monday');

/** `POST /api/v1/admin/supervisor/settlement/payouts` — ADMIN records a transfer. */
export const recordPayoutSchema = z
  .object({
    partyType: z.enum(['MERCHANT', 'RIDER']),
    partyId: uuidSchema,
    weekStart: weekStartSchema,
    itemIds: z.array(uuidSchema).min(1).max(500),
    paidOn: isoDate,
    bankReference: z.string().trim().min(1).max(120),
  })
  .strict();

export type RecordPayoutRequest = z.infer<typeof recordPayoutSchema>;

/** `POST /api/v1/admin/supervisor/settlement/payouts/:id/void` — a reason is required. */
export const voidPayoutSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

export type VoidPayoutRequest = z.infer<typeof voidPayoutSchema>;

export interface SettlementMerchantLine {
  orderId: string;
  orderNumber: string;
  deliveredAt: string;
  foodSatang: number;
  commissionSatang: number;
  payableSatang: number;
  /** Delivered before this week and still unpaid. */
  carriedOver: boolean;
}

export interface SettlementRiderLine {
  deliveryId: string;
  orderNumber: string | null;
  deliveredAt: string;
  earningSatang: number;
  carriedOver: boolean;
}

export interface SettlementReportResponse {
  period: { weekStart: string; weekEnd: string; startsAt: string; endsAt: string };
  merchants: { merchantId: string; name: string; totalSatang: number; lines: SettlementMerchantLine[] }[];
  riders: { riderId: string; name: string; totalSatang: number; lines: SettlementRiderLine[] }[];
  /** DEC-073 S2 — never paid automatically; staff decide. */
  needsReview: { kind: 'DELIVERY_FAILED' | 'RIDER_ABANDONED' | 'NO_COMMISSION_SNAPSHOT'; orderId: string; orderNumber: string | null; note: string }[];
}

export interface PayoutHistoryRow {
  id: string;
  partyType: 'MERCHANT' | 'RIDER';
  partyId: string;
  partyName: string;
  periodStart: string;
  periodEnd: string;
  totalSatang: number;
  items: number;
  paidOn: string;
  bankReference: string;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}
