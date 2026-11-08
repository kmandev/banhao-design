import { Logger } from '@nestjs/common';
import { SettlementService, weekBounds } from './settlement.service';
import type { SupabaseService } from '../../supabase/supabase.service';

type Result = { data: unknown; error: { message: string; code?: string } | null };

/** Table-keyed stub: each table hands out its queued results in call order. */
function stub(byTable: Record<string, Result[]>, rpcResult: Result = { data: 'payout-1', error: null }) {
  const cursors: Record<string, number> = {};
  const rpc = jest.fn().mockResolvedValue(rpcResult);
  const admin = {
    rpc,
    from(table: string) {
      const next = (): Result => {
        const list = byTable[table] ?? [];
        const i = cursors[table] ?? 0;
        cursors[table] = i + 1;
        return list[i] ?? { data: [], error: null };
      };
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'lt', 'gte', 'not', 'in', 'order', 'limit']) builder[m] = () => builder;
      builder.returns = () => Promise.resolve(next());
      return builder;
    },
  };
  return { service: new SettlementService({ admin } as unknown as SupabaseService), rpc };
}

const ORDER = (id: string, deliveredAt: string, food: number, commission: number | null, merchant = 'm-1') => ({
  id,
  order_number: `BH-${id}`,
  subtotal_satang: food,
  delivered_at: deliveredAt,
  restaurants: { merchant_id: merchant, name: 'ร้านส้มตำ' },
  order_commission_snapshots: commission === null ? null : { commission_satang: commission },
});

describe('weekBounds (DEC-073 S3)', () => {
  it('runs Monday 00:00 to the next Monday 00:00, Bangkok time', () => {
    const { startsAt, endsAt, weekEnd } = weekBounds('2026-11-02');
    expect(startsAt.toISOString()).toBe('2026-11-01T17:00:00.000Z');
    expect(endsAt.toISOString()).toBe('2026-11-08T17:00:00.000Z');
    expect(weekEnd).toBe('2026-11-08');
  });
});

describe('SettlementService.report (DEC-073)', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('owes a merchant food − commission per delivered order, and a rider the snapshotted earning', async () => {
    const { service } = stub({
      orders: [
        { data: [ORDER('o1', '2026-11-03T05:00:00Z', 18000, 1800), ORDER('o2', '2026-11-04T05:00:00Z', 5000, 500)], error: null },
        { data: [], error: null }, // DELIVERY_FAILED review
      ],
      deliveries: [
        { data: [{ id: 'd1', rider_id: 'r-1', delivered_at: '2026-11-03T05:30:00Z', rider_earning_satang: 1200, riders: { full_name: 'ไรเดอร์ เอ' }, orders: { order_number: 'BH-o1' } }], error: null },
        { data: [], error: null }, // ABANDONED review
      ],
      payout_items: [{ data: [], error: null }, { data: [], error: null }],
    });

    const report = await service.report('2026-11-02');

    expect(report.merchants).toEqual([
      expect.objectContaining({ merchantId: 'm-1', name: 'ร้านส้มตำ', totalSatang: 16200 + 4500 }),
    ]);
    expect(report.merchants[0]?.lines.map((l) => l.payableSatang)).toEqual([16200, 4500]);
    expect(report.riders).toEqual([expect.objectContaining({ riderId: 'r-1', name: 'ไรเดอร์ เอ', totalSatang: 1200 })]);
  });

  it('leaves out items already paid, and flags items from earlier weeks as carried over', async () => {
    const { service } = stub({
      orders: [
        { data: [ORDER('old', '2026-10-28T05:00:00Z', 10000, 1000), ORDER('paid', '2026-11-03T05:00:00Z', 10000, 1000)], error: null },
        { data: [], error: null },
      ],
      deliveries: [{ data: [], error: null }, { data: [], error: null }],
      payout_items: [{ data: [{ item_id: 'paid' }], error: null }, { data: [], error: null }],
    });

    const report = await service.report('2026-11-02');

    expect(report.merchants[0]?.lines).toEqual([expect.objectContaining({ orderId: 'old', carriedOver: true })]);
  });

  it('sends a legacy order without a commission snapshot to review instead of guessing', async () => {
    const { service } = stub({
      orders: [{ data: [ORDER('legacy', '2026-11-03T05:00:00Z', 10000, null)], error: null }, { data: [], error: null }],
      deliveries: [{ data: [], error: null }, { data: [], error: null }],
      payout_items: [{ data: [], error: null }],
    });

    const report = await service.report('2026-11-02');

    expect(report.merchants).toEqual([]);
    expect(report.needsReview).toEqual([expect.objectContaining({ kind: 'NO_COMMISSION_SNAPSHOT', orderId: 'legacy' })]);
  });

  it('lists failed deliveries and mid-route rider cancellations for staff, never as payable', async () => {
    const { service } = stub({
      orders: [{ data: [], error: null }, { data: [{ id: 'f1', order_number: 'BH-f1' }], error: null }],
      deliveries: [{ data: [], error: null }, { data: [{ order_id: 'a1', orders: { order_number: 'BH-a1' } }], error: null }],
    });

    const report = await service.report('2026-11-02');

    expect(report.needsReview.map((r) => r.kind)).toEqual(['DELIVERY_FAILED', 'RIDER_ABANDONED']);
    expect(report.merchants).toEqual([]);
    expect(report.riders).toEqual([]);
  });
});

describe('SettlementService.record / void', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  const REQUEST = {
    partyType: 'MERCHANT' as const,
    partyId: '11111111-1111-4111-8111-111111111111',
    weekStart: '2026-11-02',
    itemIds: ['22222222-2222-4222-8222-222222222222'],
    paidOn: '2026-11-09',
    bankReference: 'SLIP-001',
  };

  it('passes ids, dates and the slip reference to record_payout — never an amount', async () => {
    const { service, rpc } = stub({});

    await expect(service.record('admin-1', REQUEST)).resolves.toEqual({ payoutId: 'payout-1' });
    expect(rpc).toHaveBeenCalledWith('record_payout', {
      p_party_type: 'MERCHANT',
      p_party_id: REQUEST.partyId,
      p_period_start: '2026-11-02',
      p_period_end: '2026-11-08',
      p_paid_on: '2026-11-09',
      p_bank_reference: 'SLIP-001',
      p_recorded_by: 'admin-1',
      p_item_ids: REQUEST.itemIds,
    });
    expect(JSON.stringify(rpc.mock.calls[0])).not.toMatch(/amount|satang/i);
  });

  it('maps an already-paid item to CONFLICT and an unpayable item to VALIDATION_FAILED', async () => {
    await expect(stub({}, { data: null, error: { message: 'dup', code: '23505' } }).service.record('a', REQUEST)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(stub({}, { data: null, error: { message: 'bad', code: '22023' } }).service.record('a', REQUEST)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('voids with the reason, and maps a missing payout to NOT_FOUND', async () => {
    const ok = stub({}, { data: null, error: null });
    await ok.service.void('admin-1', 'p-1', 'ใส่เลขสลิปผิด');
    expect(ok.rpc).toHaveBeenCalledWith('void_payout', { p_payout_id: 'p-1', p_voided_by: 'admin-1', p_reason: 'ใส่เลขสลิปผิด' });

    await expect(stub({}, { data: null, error: { message: 'x', code: 'P0002' } }).service.void('a', 'p', 'r')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
