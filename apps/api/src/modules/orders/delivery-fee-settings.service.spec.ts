import { Logger } from '@nestjs/common';
import { DeliveryFeeSettingsService } from './delivery-fee-settings.service';
import type { SupabaseService } from '../../supabase/supabase.service';

type Result = { data: unknown; error: { message: string } | null };

function stub(results: Result[]) {
  const calls: { table: string; op: string; payload?: unknown }[] = [];
  let i = 0;
  const next = () => results[i++] ?? { data: null, error: null };
  const admin = {
    from(table: string) {
      const call = { table, op: 'select', payload: undefined as unknown };
      calls.push(call);
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert(payload: unknown) {
          call.op = 'insert';
          call.payload = payload;
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve(next()),
        returns: () => Promise.resolve(next()),
        then: (resolve: (r: Result) => unknown) => Promise.resolve(next()).then(resolve),
      };
      return builder;
    },
  };
  return { service: new DeliveryFeeSettingsService({ admin } as unknown as SupabaseService), calls };
}

const FIXED_ROW = {
  id: 'set-1',
  mode: 'FIXED',
  fixed_satang: 1500,
  percent_basis_points: null,
  min_satang: null,
  max_satang: null,
  reason: 'initial',
  created_by: null,
  created_at: '2026-11-08T00:00:00Z',
};
const PERCENT_ROW = {
  ...FIXED_ROW,
  id: 'set-2',
  mode: 'PERCENT',
  fixed_satang: null,
  percent_basis_points: 800,
  min_satang: 2000,
  max_satang: 3000,
  reason: 'pilot 8%',
  created_by: 'admin-1',
};

describe('DeliveryFeeSettingsService (DEC-071)', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('current() returns the newest row as a typed setting', async () => {
    const { service } = stub([{ data: [PERCENT_ROW], error: null }]);

    await expect(service.current()).resolves.toEqual({
      mode: 'PERCENT',
      percentBasisPoints: 800,
      minSatang: 2000,
      maxSatang: 3000,
    });
  });

  it('current() fails closed with no row — no order is priced on a guess', async () => {
    const { service } = stub([{ data: [], error: null }]);

    await expect(service.current()).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('current() fails closed on a read error', async () => {
    const { service } = stub([{ data: null, error: { message: 'boom' } }]);

    await expect(service.current()).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('overview() gives history and a ฿50/฿100/฿300 preview with rider earning and BANHAO margin', async () => {
    const { service } = stub([{ data: [FIXED_ROW], error: null }]);

    const overview = await service.overview();

    expect(overview.current).toMatchObject({ mode: 'FIXED', fixedSatang: 1500, id: 'set-1' });
    expect(overview.preview).toEqual([
      { foodSubtotalSatang: 5000, deliveryFeeSatang: 1500, riderEarningSatang: 1200, banhaoDeliveryMarginSatang: 300 },
      { foodSubtotalSatang: 10000, deliveryFeeSatang: 1500, riderEarningSatang: 1200, banhaoDeliveryMarginSatang: 300 },
      { foodSubtotalSatang: 30000, deliveryFeeSatang: 1500, riderEarningSatang: 1200, banhaoDeliveryMarginSatang: 300 },
    ]);
    expect(overview.bounds).toEqual({ minSatang: 1500, maxSatang: 3500, riderShareBasisPoints: 8000, riderFloorSatang: 1200 });
  });

  it('change() appends a new row and an OPERATOR audit row with the reason, before and after', async () => {
    const { service, calls } = stub([
      { data: [FIXED_ROW], error: null }, // current (before)
      { data: PERCENT_ROW, error: null }, // insert
      { data: null, error: null }, // audit
      { data: [PERCENT_ROW, FIXED_ROW], error: null }, // overview
    ]);

    await service.change('admin-1', { mode: 'PERCENT', percentBasisPoints: 800, minSatang: 2000, maxSatang: 3000, reason: 'pilot 8%' });

    const insert = calls.find((c) => c.table === 'delivery_fee_settings' && c.op === 'insert');
    expect(insert?.payload).toEqual({
      mode: 'PERCENT',
      percent_basis_points: 800,
      min_satang: 2000,
      max_satang: 3000,
      reason: 'pilot 8%',
      created_by: 'admin-1',
    });
    const audit = calls.find((c) => c.table === 'audit_logs');
    expect(audit?.payload).toMatchObject({
      actor_type: 'OPERATOR',
      actor_id: 'admin-1',
      action: 'DeliveryFeeSettingChanged',
      entity_id: 'set-2',
      before: { mode: 'FIXED', fixedSatang: 1500 },
      after: { mode: 'PERCENT', percentBasisPoints: 800 },
      reason: 'pilot 8%',
      source: 'api',
    });
  });

  it('change() never updates or deletes an existing row', async () => {
    const { service, calls } = stub([
      { data: [FIXED_ROW], error: null },
      { data: { ...FIXED_ROW, id: 'set-3', fixed_satang: 2000 }, error: null },
      { data: null, error: null },
      { data: [FIXED_ROW], error: null },
    ]);

    await service.change('admin-1', { mode: 'FIXED', fixedSatang: 2000, reason: 'r' });

    expect(calls.every((c) => c.op === 'select' || c.op === 'insert')).toBe(true);
  });
});
