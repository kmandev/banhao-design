import { Logger } from '@nestjs/common';
import { EarningsService } from './earnings.service';
import type { SupabaseService } from '../../supabase/supabase.service';

type Result = { data: unknown; error: { message: string } | null };

function stub(byTable: Record<string, Result[]>) {
  const cursors: Record<string, number> = {};
  const calls: { table: string; eq: Record<string, unknown> }[] = [];
  const admin = {
    from(table: string) {
      const call = { table, eq: {} as Record<string, unknown> };
      calls.push(call);
      const next = (): Result => {
        const list = byTable[table] ?? [];
        const i = cursors[table] ?? 0;
        cursors[table] = i + 1;
        return list[i] ?? { data: [], error: null };
      };
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'lt', 'not', 'in', 'is', 'order', 'limit']) builder[m] = () => builder;
      builder.eq = (column: string, value: unknown) => {
        call.eq[column] = value;
        return builder;
      };
      builder.returns = () => Promise.resolve(next());
      builder.maybeSingle = () => Promise.resolve(next());
      return builder;
    },
  };
  return { service: new EarningsService({ admin } as unknown as SupabaseService), calls };
}

describe('EarningsService (DEC-073)', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('a restaurant sees each delivered order of the week, food − commission, and which are paid', async () => {
    const { service, calls } = stub({
      restaurants: [{ data: { merchant_id: 'm-1' }, error: null }],
      orders: [
        {
          data: [
            { id: 'o1', order_number: 'BH-1', subtotal_satang: 18000, delivered_at: '2026-11-03T05:00:00Z', order_commission_snapshots: { commission_satang: 1800 } },
            { id: 'o2', order_number: 'BH-2', subtotal_satang: 5000, delivered_at: '2026-11-04T05:00:00Z', order_commission_snapshots: { commission_satang: 500 } },
            { id: 'old', order_number: 'BH-0', subtotal_satang: 10000, delivered_at: '2026-10-28T05:00:00Z', order_commission_snapshots: { commission_satang: 1000 } },
          ],
          error: null,
        },
      ],
      payout_items: [{ data: [{ item_id: 'o1' }], error: null }],
      payouts: [{ data: [{ paid_on: '2026-11-09', total_satang: 16200, bank_reference: 'SLIP-1', payout_items: [{ id: 'x' }] }], error: null }],
    });

    const result = await service.forRestaurant('rest-1', '2026-11-02');

    expect(calls.find((c) => c.table === 'orders')?.eq).toMatchObject({ restaurant_id: 'rest-1', state: 'DELIVERED' });
    expect(result.lines.map((l) => [l.id, l.amountSatang, l.paid])).toEqual([
      ['o1', 16200, true],
      ['o2', 4500, false],
    ]);
    expect(result.weekTotalSatang).toBe(20700);
    expect(result.weekPaidSatang).toBe(16200);
    expect(result.outstandingSatang).toBe(4500 + 9000); // o2 + the unpaid older order
    expect(result.payouts).toEqual([{ paidOn: '2026-11-09', totalSatang: 16200, bankReference: 'SLIP-1', items: 1 }]);
    expect(calls.find((c) => c.table === 'payouts')?.eq).toEqual({ party_type: 'MERCHANT', party_id: 'm-1' });
  });

  it('a rider sees only their own deliveries and earnings', async () => {
    const { service, calls } = stub({
      deliveries: [
        { data: [{ id: 'd1', delivered_at: '2026-11-03T05:30:00Z', rider_earning_satang: 1200, orders: { order_number: 'BH-1' } }], error: null },
      ],
      payout_items: [{ data: [], error: null }],
      payouts: [{ data: [], error: null }],
    });

    const result = await service.forRider('rider-7', '2026-11-02');

    expect(calls.find((c) => c.table === 'deliveries')?.eq).toMatchObject({ rider_id: 'rider-7', state: 'DELIVERED' });
    expect(result.lines).toEqual([
      expect.objectContaining({ id: 'd1', orderNumber: 'BH-1', amountSatang: 1200, paid: false, foodSatang: null }),
    ]);
    expect(result.outstandingSatang).toBe(1200);
  });

  it('fails as INTERNAL_ERROR on a read error', async () => {
    const { service } = stub({ deliveries: [{ data: null, error: { message: 'boom' } }] });
    await expect(service.forRider('r', '2026-11-02')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
