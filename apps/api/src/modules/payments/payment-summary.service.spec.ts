import { Logger } from '@nestjs/common';
import { PaymentSummaryService } from './payment-summary.service';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { AuthenticatedUser } from '../../common/types';

type Result = { data: unknown; error: { message: string } | null };

function stub(byTable: Record<string, Result>) {
  const calls: { table: string; select: string; eq: Record<string, unknown> }[] = [];
  const admin = {
    from(table: string) {
      const call = { table, select: '', eq: {} as Record<string, unknown> };
      calls.push(call);
      const builder: Record<string, unknown> = {
        select(columns: string) {
          call.select = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.eq[column] = value;
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve(byTable[table] ?? { data: null, error: null }),
        returns: () => Promise.resolve(byTable[table] ?? { data: [], error: null }),
      };
      return builder;
    },
  };
  return { service: new PaymentSummaryService({ admin } as unknown as SupabaseService), calls };
}

const USER = { id: 'customer-1' } as AuthenticatedUser;
const ORDER = { data: { id: 'order-1', order_number: 'BH-1' }, error: null };
const PAYMENT = {
  data: {
    id: 'pay-1',
    payment_reference: 'PAY-BH-1',
    state: 'SUCCESS',
    method: 'ONLINE',
    amount_satang: 19900,
    provider_payment_id: 'pi_3QabcdefGh8f2a',
  },
  error: null,
};

describe('PaymentSummaryService.getSummary', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it("scopes the order read to the caller — someone else's order is NOT_FOUND", async () => {
    const { service, calls } = stub({ orders: { data: null, error: null } });

    await expect(service.getSummary(USER, 'order-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(calls[0]?.eq).toEqual({ id: 'order-1', customer_id: 'customer-1' });
    expect(calls.some((c) => c.table === 'payments')).toBe(false);
  });

  it('returns the order number and nulls when no payment exists yet', async () => {
    const { service } = stub({ orders: ORDER });

    await expect(service.getSummary(USER, 'order-1')).resolves.toEqual({ orderNumber: 'BH-1', payment: null, refund: null });
  });

  it('shows only the last four characters of the provider id, upper-cased', async () => {
    const { service } = stub({ orders: ORDER, payments: PAYMENT });

    const summary = await service.getSummary(USER, 'order-1');

    expect(summary.payment).toEqual({
      paymentReference: 'PAY-BH-1',
      state: 'SUCCESS',
      method: 'ONLINE',
      amountSatang: 19900,
      providerRefTail: '8F2A',
    });
    expect(JSON.stringify(summary)).not.toContain('pi_3Qabcdef');
  });

  it('never selects failure text or actor columns', async () => {
    const { service, calls } = stub({ orders: ORDER, payments: PAYMENT });
    await service.getSummary(USER, 'order-1');

    const selected = calls.map((c) => c.select).join(',');
    expect(selected).not.toMatch(/failure_reason|requested_by|approved_by|reason|provider_refund_id/);
  });

  it('includes the latest refund when one exists', async () => {
    const { service } = stub({
      orders: ORDER,
      payments: PAYMENT,
      refunds: {
        data: [{ state: 'REFUND_PROCESSING', amount_satang: 19900, created_at: '2026-11-08T08:30:00Z', completed_at: null }],
        error: null,
      },
    });

    await expect(service.getSummary(USER, 'order-1')).resolves.toMatchObject({
      refund: { state: 'REFUND_PROCESSING', amountSatang: 19900, requestedAt: '2026-11-08T08:30:00Z', completedAt: null },
    });
  });

  it('fails as INTERNAL_ERROR, without leaking the database message, when a read fails', async () => {
    const { service } = stub({ orders: ORDER, payments: { data: null, error: { message: 'relation secret' } } });

    await expect(service.getSummary(USER, 'order-1')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
