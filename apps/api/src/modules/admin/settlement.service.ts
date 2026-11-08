import { Injectable, Logger } from '@nestjs/common';
import type {
  PayoutHistoryRow,
  RecordPayoutRequest,
  SettlementMerchantLine,
  SettlementReportResponse,
  SettlementRiderLine,
} from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A bound on one report's reads, generous for a pilot. Not a policy value. */
const READ_LIMIT = 2000;

interface OrderRow {
  id: string;
  order_number: string;
  subtotal_satang: number;
  delivered_at: string;
  restaurants: { merchant_id: string; name: string } | { merchant_id: string; name: string }[] | null;
  order_commission_snapshots: { commission_satang: number } | { commission_satang: number }[] | null;
}

interface DeliveryRow {
  id: string;
  rider_id: string;
  delivered_at: string;
  rider_earning_satang: number;
  riders: { full_name: string } | { full_name: string }[] | null;
  orders: { order_number: string } | { order_number: string }[] | null;
}

function one<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

/** Monday 00:00 Asia/Bangkok (UTC+7, no DST) for `weekStart`, and the following Monday. */
export function weekBounds(weekStart: string): { startsAt: Date; endsAt: Date; weekEnd: string } {
  const startsAt = new Date(`${weekStart}T00:00:00+07:00`);
  const endsAt = new Date(startsAt.getTime() + 7 * DAY_MS);
  const weekEnd = new Date(startsAt.getTime() + 6 * DAY_MS + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { startsAt, endsAt, weekEnd };
}

/**
 * DEC-073 — pilot settlement: what is owed this week, recording a transfer,
 * voiding a mistaken record, and the history.
 *
 * The report reads frozen order facts only: merchant = food − commission
 * snapshot for each DELIVERED order; rider = the snapshotted earning for each
 * DELIVERED delivery. Anything delivered before the week ends and not yet in a
 * non-voided payout is listed, so a missed item carries forward. Recording goes
 * through `record_payout()`, which recomputes every amount itself and refuses
 * an item already paid — the report's numbers are a display, never an input.
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async report(weekStart: string): Promise<SettlementReportResponse> {
    const { startsAt, endsAt, weekEnd } = weekBounds(weekStart);
    const end = endsAt.toISOString();

    const [orders, deliveries] = await Promise.all([this.deliveredOrders(end), this.deliveredDeliveries(end)]);
    const [paidOrders, paidDeliveries] = await Promise.all([
      this.paidItems('ORDER', orders.map((o) => o.id)),
      this.paidItems('DELIVERY', deliveries.map((d) => d.id)),
    ]);

    const needsReview: SettlementReportResponse['needsReview'] = [];
    const merchants = new Map<string, { merchantId: string; name: string; totalSatang: number; lines: SettlementMerchantLine[] }>();

    for (const order of orders) {
      if (paidOrders.has(order.id)) continue;
      const restaurant = one(order.restaurants);
      const snapshot = one(order.order_commission_snapshots);
      if (!restaurant) continue;
      if (!snapshot) {
        needsReview.push({
          kind: 'NO_COMMISSION_SNAPSHOT',
          orderId: order.id,
          orderNumber: order.order_number,
          note: 'ออเดอร์เก่าที่ไม่มีค่าคอมมิชชั่นบันทึกไว้ — คำนวณยอดเอง',
        });
        continue;
      }
      const payable = order.subtotal_satang - snapshot.commission_satang;
      if (payable <= 0) continue;
      const group = merchants.get(restaurant.merchant_id) ?? {
        merchantId: restaurant.merchant_id,
        name: restaurant.name,
        totalSatang: 0,
        lines: [],
      };
      group.lines.push({
        orderId: order.id,
        orderNumber: order.order_number,
        deliveredAt: order.delivered_at,
        foodSatang: order.subtotal_satang,
        commissionSatang: snapshot.commission_satang,
        payableSatang: payable,
        carriedOver: new Date(order.delivered_at) < startsAt,
      });
      group.totalSatang += payable;
      merchants.set(restaurant.merchant_id, group);
    }

    const riders = new Map<string, { riderId: string; name: string; totalSatang: number; lines: SettlementRiderLine[] }>();
    for (const delivery of deliveries) {
      if (paidDeliveries.has(delivery.id)) continue;
      const group = riders.get(delivery.rider_id) ?? {
        riderId: delivery.rider_id,
        name: one(delivery.riders)?.full_name ?? 'ไรเดอร์',
        totalSatang: 0,
        lines: [],
      };
      group.lines.push({
        deliveryId: delivery.id,
        orderNumber: one(delivery.orders)?.order_number ?? null,
        deliveredAt: delivery.delivered_at,
        earningSatang: delivery.rider_earning_satang,
        carriedOver: new Date(delivery.delivered_at) < startsAt,
      });
      group.totalSatang += delivery.rider_earning_satang;
      riders.set(delivery.rider_id, group);
    }

    needsReview.push(...(await this.reviewItems(startsAt.toISOString(), end)));

    return {
      period: { weekStart, weekEnd, startsAt: startsAt.toISOString(), endsAt: end },
      merchants: [...merchants.values()].sort((a, b) => a.name.localeCompare(b.name, 'th')),
      riders: [...riders.values()].sort((a, b) => a.name.localeCompare(b.name, 'th')),
      needsReview,
    };
  }

  async record(staffUserId: string, request: RecordPayoutRequest): Promise<{ payoutId: string }> {
    const { weekEnd } = weekBounds(request.weekStart);
    const { data, error } = await this.supabase.admin.rpc('record_payout', {
      p_party_type: request.partyType,
      p_party_id: request.partyId,
      p_period_start: request.weekStart,
      p_period_end: weekEnd,
      p_paid_on: request.paidOn,
      p_bank_reference: request.bankReference,
      p_recorded_by: staffUserId,
      p_item_ids: request.itemIds,
    });
    if (error) {
      if (error.code === '23505') {
        throw new DomainError('CONFLICT', { message: 'One or more items are already paid' });
      }
      if (error.code === '22023') {
        throw new DomainError('VALIDATION_FAILED', { message: 'Some items are not payable to this recipient' });
      }
      this.logger.error(`record_payout failed: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Recording the payout failed' });
    }
    return { payoutId: data as string };
  }

  async void(staffUserId: string, payoutId: string, reason: string): Promise<void> {
    const { error } = await this.supabase.admin.rpc('void_payout', {
      p_payout_id: payoutId,
      p_voided_by: staffUserId,
      p_reason: reason,
    });
    if (error) {
      if (error.code === 'P0002') throw new DomainError('NOT_FOUND', { message: 'No such active payout' });
      if (error.code === '22023') throw new DomainError('VALIDATION_FAILED', { message: 'A reason is required' });
      this.logger.error(`void_payout failed: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Voiding the payout failed' });
    }
  }

  async history(limit = 50): Promise<PayoutHistoryRow[]> {
    const { data, error } = await this.supabase.admin
      .from('payouts')
      .select('id, party_type, party_id, period_start, period_end, total_satang, paid_on, bank_reference, created_at, voided_at, void_reason, payout_items(id)')
      .order('created_at', { ascending: false })
      .limit(limit)
      .returns<
        {
          id: string;
          party_type: 'MERCHANT' | 'RIDER';
          party_id: string;
          period_start: string;
          period_end: string;
          total_satang: number;
          paid_on: string;
          bank_reference: string;
          created_at: string;
          voided_at: string | null;
          void_reason: string | null;
          payout_items: { id: string }[] | null;
        }[]
      >();
    if (error) {
      this.logger.error(`payouts read failed: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Payout history unavailable' });
    }
    const rows = data ?? [];
    const names = await this.partyNames(rows);
    return rows.map((row) => ({
      id: row.id,
      partyType: row.party_type,
      partyId: row.party_id,
      partyName: names.get(row.party_id) ?? row.party_id,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      totalSatang: row.total_satang,
      items: row.payout_items?.length ?? 0,
      paidOn: row.paid_on,
      bankReference: row.bank_reference,
      createdAt: row.created_at,
      voidedAt: row.voided_at,
      voidReason: row.void_reason,
    }));
  }

  private async deliveredOrders(before: string): Promise<OrderRow[]> {
    const { data, error } = await this.supabase.admin
      .from('orders')
      .select('id, order_number, subtotal_satang, delivered_at, restaurants!inner(merchant_id, name), order_commission_snapshots(commission_satang)')
      .eq('state', 'DELIVERED')
      .lt('delivered_at', before)
      .order('delivered_at', { ascending: true })
      .limit(READ_LIMIT)
      .returns<OrderRow[]>();
    if (error) this.fail('delivered orders read', error.message);
    return data ?? [];
  }

  private async deliveredDeliveries(before: string): Promise<DeliveryRow[]> {
    const { data, error } = await this.supabase.admin
      .from('deliveries')
      .select('id, rider_id, delivered_at, rider_earning_satang, riders(full_name), orders(order_number)')
      .eq('state', 'DELIVERED')
      .not('rider_id', 'is', null)
      .not('rider_earning_satang', 'is', null)
      .lt('delivered_at', before)
      .order('delivered_at', { ascending: true })
      .limit(READ_LIMIT)
      .returns<DeliveryRow[]>();
    if (error) this.fail('delivered deliveries read', error.message);
    return data ?? [];
  }

  private async paidItems(itemType: 'ORDER' | 'DELIVERY', ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const { data, error } = await this.supabase.admin
      .from('payout_items')
      .select('item_id')
      .eq('item_type', itemType)
      .eq('voided', false)
      .in('item_id', ids)
      .returns<{ item_id: string }[]>();
    if (error) this.fail('payout items read', error.message);
    return new Set((data ?? []).map((row) => row.item_id));
  }

  /** DEC-073 S2 — this week's failed deliveries and mid-route rider cancellations, for staff to decide. */
  private async reviewItems(from: string, to: string): Promise<SettlementReportResponse['needsReview']> {
    const [failed, abandoned] = await Promise.all([
      this.supabase.admin
        .from('orders')
        .select('id, order_number')
        .eq('state', 'DELIVERY_FAILED')
        .gte('updated_at', from)
        .lt('updated_at', to)
        .limit(200)
        .returns<{ id: string; order_number: string }[]>(),
      this.supabase.admin
        .from('deliveries')
        .select('order_id, orders(order_number)')
        .eq('state', 'ABANDONED')
        .not('rider_id', 'is', null)
        .gte('updated_at', from)
        .lt('updated_at', to)
        .limit(200)
        .returns<{ order_id: string; orders: { order_number: string } | { order_number: string }[] | null }[]>(),
    ]);
    if (failed.error) this.fail('failed orders read', failed.error.message);
    if (abandoned.error) this.fail('abandoned deliveries read', abandoned.error.message);
    return [
      ...(failed.data ?? []).map((row) => ({
        kind: 'DELIVERY_FAILED' as const,
        orderId: row.id,
        orderNumber: row.order_number,
        note: 'ส่งไม่สำเร็จ — ทีมงานตัดสินว่าร้าน/ไรเดอร์ได้เท่าไร (DEC-053, BQ-024)',
      })),
      ...(abandoned.data ?? []).map((row) => ({
        kind: 'RIDER_ABANDONED' as const,
        orderId: row.order_id,
        orderNumber: one(row.orders)?.order_number ?? null,
        note: 'ไรเดอร์รับงานแล้วแต่ออเดอร์ถูกยกเลิก — ค่าชดเชยยังไม่ตัดสิน (BQ-024)',
      })),
    ];
  }

  private async partyNames(rows: { party_type: string; party_id: string }[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const merchantIds = [...new Set(rows.filter((r) => r.party_type === 'MERCHANT').map((r) => r.party_id))];
    const riderIds = [...new Set(rows.filter((r) => r.party_type === 'RIDER').map((r) => r.party_id))];
    if (merchantIds.length > 0) {
      const { data } = await this.supabase.admin
        .from('restaurants')
        .select('merchant_id, name')
        .in('merchant_id', merchantIds)
        .returns<{ merchant_id: string; name: string }[]>();
      for (const row of data ?? []) if (!names.has(row.merchant_id)) names.set(row.merchant_id, row.name);
    }
    if (riderIds.length > 0) {
      const { data } = await this.supabase.admin
        .from('riders')
        .select('id, full_name')
        .in('id', riderIds)
        .returns<{ id: string; full_name: string }[]>();
      for (const row of data ?? []) names.set(row.id, row.full_name);
    }
    return names;
  }

  private fail(operation: string, message: string): never {
    this.logger.error(`Settlement ${operation} failed: ${message}`);
    throw new DomainError('INTERNAL_ERROR', { message: 'Settlement report unavailable' });
  }
}
