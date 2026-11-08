import { Injectable, Logger } from '@nestjs/common';
import type { EarningsLine, EarningsResponse } from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';
import { weekBounds } from '../admin/settlement.service';

const READ_LIMIT = 2000;

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * DEC-073 / DEC-070 Q5 — a restaurant's and a rider's own earnings, read-only.
 *
 * The same facts the payout report uses (merchant: food − commission snapshot
 * per DELIVERED order; rider: snapshotted earning per DELIVERED delivery), seen
 * from the earner's side: this week's items and whether each has been paid,
 * everything still unpaid, and recent transfers. Scoping is by the route —
 * the restaurant the caller is a member of, or the caller's own rider row.
 */
@Injectable()
export class EarningsService {
  private readonly logger = new Logger(EarningsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async forRestaurant(restaurantId: string, weekStart: string): Promise<EarningsResponse> {
    const { startsAt, endsAt, weekEnd } = weekBounds(weekStart);
    const now = new Date().toISOString();

    const { data: restaurant, error: rError } = await this.supabase.admin
      .from('restaurants')
      .select('merchant_id')
      .eq('id', restaurantId)
      .maybeSingle<{ merchant_id: string }>();
    if (rError || !restaurant) this.fail('restaurant read', rError?.message ?? 'not found');

    const { data, error } = await this.supabase.admin
      .from('orders')
      .select('id, order_number, subtotal_satang, delivered_at, order_commission_snapshots(commission_satang)')
      .eq('restaurant_id', restaurantId)
      .eq('state', 'DELIVERED')
      .lt('delivered_at', now)
      .order('delivered_at', { ascending: false })
      .limit(READ_LIMIT)
      .returns<
        {
          id: string;
          order_number: string;
          subtotal_satang: number;
          delivered_at: string;
          order_commission_snapshots: { commission_satang: number } | { commission_satang: number }[] | null;
        }[]
      >();
    if (error) this.fail('orders read', error.message);

    const rows = (data ?? [])
      .map((o) => {
        const snapshot = one(o.order_commission_snapshots);
        if (!snapshot) return null;
        return {
          id: o.id,
          orderNumber: o.order_number,
          deliveredAt: o.delivered_at,
          foodSatang: o.subtotal_satang,
          commissionSatang: snapshot.commission_satang,
          amountSatang: o.subtotal_satang - snapshot.commission_satang,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null && row.amountSatang > 0);

    const paid = await this.paidSet('ORDER', rows.map((r) => r.id));
    const payouts = await this.payouts('MERCHANT', (restaurant as { merchant_id: string }).merchant_id);
    return this.assemble(rows, paid, payouts, startsAt, endsAt, weekStart, weekEnd);
  }

  async forRider(riderId: string, weekStart: string): Promise<EarningsResponse> {
    const { startsAt, endsAt, weekEnd } = weekBounds(weekStart);
    const { data, error } = await this.supabase.admin
      .from('deliveries')
      .select('id, delivered_at, rider_earning_satang, orders(order_number)')
      .eq('rider_id', riderId)
      .eq('state', 'DELIVERED')
      .not('rider_earning_satang', 'is', null)
      .order('delivered_at', { ascending: false })
      .limit(READ_LIMIT)
      .returns<
        {
          id: string;
          delivered_at: string;
          rider_earning_satang: number;
          orders: { order_number: string } | { order_number: string }[] | null;
        }[]
      >();
    if (error) this.fail('deliveries read', error.message);

    const rows = (data ?? []).map((d) => ({
      id: d.id,
      orderNumber: one(d.orders)?.order_number ?? null,
      deliveredAt: d.delivered_at,
      foodSatang: null,
      commissionSatang: null,
      amountSatang: d.rider_earning_satang,
    }));
    const paid = await this.paidSet('DELIVERY', rows.map((r) => r.id));
    const payouts = await this.payouts('RIDER', riderId);
    return this.assemble(rows, paid, payouts, startsAt, endsAt, weekStart, weekEnd);
  }

  private assemble(
    rows: Omit<EarningsLine, 'paid'>[],
    paid: Set<string>,
    payouts: EarningsResponse['payouts'],
    startsAt: Date,
    endsAt: Date,
    weekStart: string,
    weekEnd: string,
  ): EarningsResponse {
    const lines: EarningsLine[] = rows
      .filter((r) => {
        const t = new Date(r.deliveredAt);
        return t >= startsAt && t < endsAt;
      })
      .map((r) => ({ ...r, paid: paid.has(r.id) }));
    return {
      period: { weekStart, weekEnd },
      lines,
      weekTotalSatang: lines.reduce((sum, l) => sum + l.amountSatang, 0),
      weekPaidSatang: lines.filter((l) => l.paid).reduce((sum, l) => sum + l.amountSatang, 0),
      outstandingSatang: rows.filter((r) => !paid.has(r.id)).reduce((sum, r) => sum + r.amountSatang, 0),
      payouts,
    };
  }

  private async paidSet(itemType: 'ORDER' | 'DELIVERY', ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const { data, error } = await this.supabase.admin
      .from('payout_items')
      .select('item_id')
      .eq('item_type', itemType)
      .eq('voided', false)
      .in('item_id', ids)
      .returns<{ item_id: string }[]>();
    if (error) this.fail('payout items read', error.message);
    return new Set((data ?? []).map((r) => r.item_id));
  }

  private async payouts(partyType: 'MERCHANT' | 'RIDER', partyId: string): Promise<EarningsResponse['payouts']> {
    const { data, error } = await this.supabase.admin
      .from('payouts')
      .select('paid_on, total_satang, bank_reference, payout_items(id)')
      .eq('party_type', partyType)
      .eq('party_id', partyId)
      .is('voided_at', null)
      .order('paid_on', { ascending: false })
      .limit(10)
      .returns<{ paid_on: string; total_satang: number; bank_reference: string; payout_items: { id: string }[] | null }[]>();
    if (error) this.fail('payouts read', error.message);
    return (data ?? []).map((p) => ({
      paidOn: p.paid_on,
      totalSatang: p.total_satang,
      bankReference: p.bank_reference,
      items: p.payout_items?.length ?? 0,
    }));
  }

  private fail(operation: string, message: string): never {
    this.logger.error(`Earnings ${operation} failed: ${message}`);
    throw new DomainError('INTERNAL_ERROR', { message: 'Earnings unavailable' });
  }
}
