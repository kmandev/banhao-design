import { RefundService } from './refund.service';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { AuthenticatedUser } from '../../common/types';
import type { PaymentProvider, RefundResult } from '../payments/payment-provider.interface';
import { COMMAND_CATALOG } from '../ai-ops/command-catalog';

/**
 * Q-020 Slice 1 — `RefundService.initiateRefund` (DEC-057 mechanism,
 * DEC-058 authority, DEC-059 accounting boundary — the boundary this slice
 * must NOT cross, tested explicitly below).
 *
 * Same fake-Supabase shape as `payments.service.spec.ts`: a stub recording
 * every table/op/filter/payload a statement was built with, so a guard or a
 * boundary (e.g. "no ledger table is ever touched") can be asserted from the
 * call log, not merely from the returned value.
 */

type Result = { data: unknown; error: { message: string; code?: string } | null };

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update';
  eq: Record<string, unknown>;
  neq: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

function supabaseStub(results: Result[]) {
  const calls: Recorded[] = [];
  let index = 0;
  const nextResult = (): Result => results[index++] ?? { data: null, error: null };

  const admin = {
    from(table: string) {
      const call: Recorded = { table, op: 'select', eq: {}, neq: {} };
      calls.push(call);

      const builder: Record<string, unknown> = {
        select: () => builder,
        insert(payload: Record<string, unknown>) {
          call.op = 'insert';
          call.payload = payload;
          return builder;
        },
        update(payload: Record<string, unknown>) {
          call.op = 'update';
          call.payload = payload;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.eq[column] = value;
          return builder;
        },
        neq(column: string, value: unknown) {
          call.neq[column] = value;
          return builder;
        },
        maybeSingle: () => Promise.resolve(nextResult()),
        then: (resolve: (r: Result) => unknown) => Promise.resolve(nextResult()).then(resolve),
      };

      return builder;
    },
  };

  return { supabase: { admin } as unknown as SupabaseService, calls };
}

function buildService(results: Result[], providerOverrides?: Partial<PaymentProvider>) {
  const { supabase, calls } = supabaseStub(results);
  const refund = jest.fn<Promise<RefundResult>, Parameters<PaymentProvider['refund']>>();
  const provider: PaymentProvider = {
    name: 'stripe',
    createPayment: jest.fn(),
    refund,
    verifyWebhookSignature: jest.fn(),
    ...providerOverrides,
  };
  const subject = new RefundService(supabase, provider);
  return { subject, calls, refund, provider };
}

const ORDER_ID = 'order-1';
const OPERATOR_ID = 'operator-1';

function operatorUser(id = OPERATOR_ID): AuthenticatedUser {
  return {
    id,
    phone: null,
    capabilities: { customer: false, merchant: [], rider: null, platformStaff: { staffRole: 'OPERATOR' } },
  };
}

const CANCELLED_ORDER = { id: ORDER_ID, state: 'CANCELLED', cause_code: null };
const DELIVERY_FAILED_PLATFORM_CAUSED = { id: ORDER_ID, state: 'DELIVERY_FAILED', cause_code: 'PLATFORM_CAUSED' };
const DELIVERY_FAILED_CUSTOMER_UNREACHABLE = {
  id: ORDER_ID,
  state: 'DELIVERY_FAILED',
  cause_code: 'CUSTOMER_UNREACHABLE',
};
const PAID_ORDER = { id: ORDER_ID, state: 'PAID', cause_code: null };

const SUCCESS_PAYMENT = {
  id: 'payment-1',
  payment_reference: 'PAY-BH20260908-0001',
  state: 'SUCCESS',
  amount_satang: 7500,
  provider_payment_id: 'pi_fixed',
};

const FRESH_REFUND_ROW = {
  id: 'refund-1',
  payment_id: 'payment-1',
  state: 'REFUND_REQUESTED',
  amount_satang: 7500,
  provider_refund_id: null,
};

const PROVIDER_RESULT: RefundResult = { providerRefundId: 're_fixed' };

describe('RefundService.initiateRefund — eligibility (DEC-050/DEC-053)', () => {
  it('rejects an order that does not exist', async () => {
    const { subject } = buildService([{ data: null, error: null }]);

    await expect(subject.initiateRefund(operatorUser(), ORDER_ID, { reason: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('accepts a CANCELLED order (DEC-050 — every permitted cancellation is a full refund)', async () => {
    const { subject, refund } = buildService([
      { data: CANCELLED_ORDER, error: null },
      { data: SUCCESS_PAYMENT, error: null },
      { data: FRESH_REFUND_ROW, error: null },
      { data: { ...FRESH_REFUND_ROW, state: 'REFUND_PENDING', provider_refund_id: 're_fixed' }, error: null },
    ]);
    refund.mockResolvedValue(PROVIDER_RESULT);

    await expect(subject.initiateRefund(operatorUser(), ORDER_ID, { reason: 'x' })).resolves.toMatchObject({
      state: 'REFUND_PENDING',
    });
  });

  it('accepts DELIVERY_FAILED with a non-customer cause (DEC-053)', async () => {
    const { subject, refund } = buildService([
      { data: DELIVERY_FAILED_PLATFORM_CAUSED, error: null },
      { data: SUCCESS_PAYMENT, error: null },
      { data: FRESH_REFUND_ROW, error: null },
      { data: { ...FRESH_REFUND_ROW, state: 'REFUND_PENDING', provider_refund_id: 're_fixed' }, error: null },
    ]);
    refund.mockResolvedValue(PROVIDER_RESULT);

    await expect(subject.initiateRefund(operatorUser(), ORDER_ID, { reason: 'x' })).resolves.toMatchObject({
      state: 'REFUND_PENDING',
    });
  });

  it('rejects DELIVERY_FAILED with CUSTOMER_UNREACHABLE — DEC-053 table: no refund of any kind', async () => {
    const { subject, refund } = buildService([{ data: DELIVERY_FAILED_CUSTOMER_UNREACHABLE, error: null }]);

    await expect(subject.initiateRefund(operatorUser(), ORDER_ID, { reason: 'x' })).rejects.toMatchObject({
      code: 'ORDER_NOT_REFUND_ELIGIBLE',
    });
    expect(refund).not.toHaveBeenCalled();
  });

  it('rejects DELIVERY_FAILED with CUSTOMER_REFUSED — the other DEC-053 no-refund cause', async () => {
    const { subject } = buildService([
      { data: { id: ORDER_ID, state: 'DELIVERY_FAILED', cause_code: 'CUSTOMER_REFUSED' }, error: null },
    ]);

    await expect(subject.initiateRefund(operatorUser(), ORDER_ID, { reason: 'x' })).rejects.toMatchObject({
      code: 'ORDER_NOT_REFUND_ELIGIBLE',
    });
  });

  it('rejects an order in an ordinary, non-terminal state (e.g. PAID) — not every order is refund-eligible', async () => {
    const { subject } = buildService([{ data: PAID_ORDER, error: null }]);

    await expect(subject.initiateRefund(operatorUser(), ORDER_ID, { reason: 'x' })).rejects.toMatchObject({
      code: 'ORDER_NOT_REFUND_ELIGIBLE',
    });
  });

  it('rejects when the order has no payment at all', async () => {
    const { subject } = buildService([
      { data: CANCELLED_ORDER, error: null },
      { data: null, error: null },
    ]);

    await expect(subject.initiateRefund(operatorUser(), ORDER_ID, { reason: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects a payment that is not SUCCESS — nothing settled to refund', async () => {
    const { subject } = buildService([
      { data: CANCELLED_ORDER, error: null },
      { data: { ...SUCCESS_PAYMENT, state: 'PENDING' }, error: null },
    ]);

    await expect(subject.initiateRefund(operatorUser(), ORDER_ID, { reason: 'x' })).rejects.toMatchObject({
      code: 'PAYMENT_NOT_REFUNDABLE',
    });
  });
});

describe('RefundService.initiateRefund — scope (DEC-057 § 1, full refund only)', () => {
  it('calls the provider with exactly payments.amount_satang — never any other amount, and the request accepts no amount field at all', async () => {
    const { subject, refund } = buildService([
      { data: CANCELLED_ORDER, error: null },
      { data: SUCCESS_PAYMENT, error: null },
      { data: FRESH_REFUND_ROW, error: null },
      { data: { ...FRESH_REFUND_ROW, provider_refund_id: 're_fixed' }, error: null },
    ]);
    refund.mockResolvedValue(PROVIDER_RESULT);

    // Note: InitiateRefundRequest has no `amount` property — TypeScript itself
    // refuses a caller-supplied amount at the type level; this test asserts
    // the *runtime* consequence, that the service's own determination
    // (payment.amount_satang) is what actually reaches the provider.
    await subject.initiateRefund(operatorUser(), ORDER_ID, { reason: 'x' });

    expect(refund).toHaveBeenCalledWith(
      expect.objectContaining({ amount: { amount: 7500, currency: 'THB' } }),
    );
  });

  it('derives providerPaymentId from the payment, not from any caller input', async () => {
    const { subject, refund } = buildService([
      { data: CANCELLED_ORDER, error: null },
      { data: SUCCESS_PAYMENT, error: null },
      { data: FRESH_REFUND_ROW, error: null },
      { data: { ...FRESH_REFUND_ROW, provider_refund_id: 're_fixed' }, error: null },
    ]);
    refund.mockResolvedValue(PROVIDER_RESULT);

    await subject.initiateRefund(operatorUser(), ORDER_ID, { reason: 'x' });

    expect(refund).toHaveBeenCalledWith(expect.objectContaining({ providerPaymentId: 'pi_fixed' }));
  });
});

describe('RefundService.initiateRefund — duplicate protection (no unique(payment_id) column, § schema recon)', () => {
  it('a duplicate insert (23505 on refund_reference) reads back the winner instead of erroring', async () => {
    const { subject, calls, refund } = buildService([
      { data: CANCELLED_ORDER, error: null },
      { data: SUCCESS_PAYMENT, error: null },
      { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } },
      { data: FRESH_REFUND_ROW, error: null }, // read-back by refund_reference
      { data: { ...FRESH_REFUND_ROW, provider_refund_id: 're_fixed' }, error: null },
    ]);
    refund.mockResolvedValue(PROVIDER_RESULT);

    await subject.initiateRefund(operatorUser(), ORDER_ID, { reason: 'x' });

    const insertAttempt = calls.find((c) => c.table === 'refunds' && c.op === 'insert');
    expect(insertAttempt?.payload).toMatchObject({ refund_reference: `REFUND-${SUCCESS_PAYMENT.payment_reference}` });
    // Exactly one provider call — the race did not double-refund.
    expect(refund).toHaveBeenCalledTimes(1);
  });

  it('rejects outright when the existing refund is already REFUNDED — no second refund in Phase 1', async () => {
    const { subject, refund } = buildService([
      { data: CANCELLED_ORDER, error: null },
      { data: SUCCESS_PAYMENT, error: null },
      { data: { ...FRESH_REFUND_ROW, state: 'REFUNDED', provider_refund_id: 're_old' }, error: null },
    ]);

    await expect(subject.initiateRefund(operatorUser(), ORDER_ID, { reason: 'x' })).rejects.toMatchObject({
      code: 'REFUND_ALREADY_EXISTS',
    });
    expect(refund).not.toHaveBeenCalled();
  });

  it('an already-acknowledged in-flight refund (provider_refund_id already set) is returned as-is — never a second Stripe call', async () => {
    const inFlight = { ...FRESH_REFUND_ROW, state: 'REFUND_PENDING', provider_refund_id: 're_already' };
    const { subject, refund } = buildService([
      { data: CANCELLED_ORDER, error: null },
      { data: SUCCESS_PAYMENT, error: null },
      { data: inFlight, error: null },
    ]);

    const result = await subject.initiateRefund(operatorUser(), ORDER_ID, { reason: 'x' });

    expect(result).toMatchObject({ state: 'REFUND_PENDING', providerRefundId: 're_already' });
    expect(refund).not.toHaveBeenCalled();
  });
});

describe('RefundService.initiateRefund — idempotency (DEC-057 § 7)', () => {
  it('uses the local refund identity (refunds.id) as the Stripe idempotency key', async () => {
    const { subject, refund } = buildService([
      { data: CANCELLED_ORDER, error: null },
      { data: SUCCESS_PAYMENT, error: null },
      { data: FRESH_REFUND_ROW, error: null },
      { data: { ...FRESH_REFUND_ROW, provider_refund_id: 're_fixed' }, error: null },
    ]);
    refund.mockResolvedValue(PROVIDER_RESULT);

    await subject.initiateRefund(operatorUser(), ORDER_ID, { reason: 'x' });

    expect(refund).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'refund-1' }));
  });

  it('a retry of the SAME logical refund (row already exists, no provider id yet) reuses the identical idempotency key', async () => {
    const failedBefore = { ...FRESH_REFUND_ROW, state: 'REFUND_FAILED', provider_refund_id: null };
    const { subject, refund } = buildService([
      { data: CANCELLED_ORDER, error: null },
      { data: SUCCESS_PAYMENT, error: null },
      { data: null, error: { message: 'duplicate key', code: '23505' } },
      { data: failedBefore, error: null },
      { data: { ...failedBefore, state: 'REFUND_PENDING', provider_refund_id: 're_retry' }, error: null },
    ]);
    refund.mockResolvedValue({ providerRefundId: 're_retry' });

    await subject.initiateRefund(operatorUser(), ORDER_ID, { reason: 'x' });

    expect(refund).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'refund-1' }));
  });

  it('a different order/payment/refund gets a different idempotency key', async () => {
    const otherRefund = { ...FRESH_REFUND_ROW, id: 'refund-2', payment_id: 'payment-2' };
    const otherPayment = { ...SUCCESS_PAYMENT, id: 'payment-2', payment_reference: 'PAY-BH20260908-0002' };
    const { subject, refund } = buildService([
      { data: CANCELLED_ORDER, error: null },
      { data: otherPayment, error: null },
      { data: otherRefund, error: null },
      { data: { ...otherRefund, provider_refund_id: 're_other' }, error: null },
    ]);
    refund.mockResolvedValue({ providerRefundId: 're_other' });

    await subject.initiateRefund(operatorUser(), ORDER_ID, { reason: 'x' });

    expect(refund).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'refund-2' }));
  });
});

describe('RefundService.initiateRefund — provider failure', () => {
  it('transitions the local refund to REFUND_FAILED and raises PROVIDER_UNAVAILABLE, never a silent success-looking state', async () => {
    const { subject, calls, refund } = buildService([
      { data: CANCELLED_ORDER, error: null },
      { data: SUCCESS_PAYMENT, error: null },
      { data: FRESH_REFUND_ROW, error: null },
      { data: null, error: null }, // REFUND_FAILED update
    ]);
    refund.mockRejectedValue(new Error('Stripe network error'));

    await expect(subject.initiateRefund(operatorUser(), ORDER_ID, { reason: 'x' })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });

    const failedUpdate = calls.find((c) => c.table === 'refunds' && c.op === 'update');
    expect(failedUpdate?.payload).toEqual({ state: 'REFUND_FAILED' });
    expect(failedUpdate?.neq).toMatchObject({ state: 'REFUNDED' });
  });

  it('handles a malformed/empty provider response by treating it as a failure, never as a success', async () => {
    const { subject } = buildService([
      { data: CANCELLED_ORDER, error: null },
      { data: SUCCESS_PAYMENT, error: null },
      { data: FRESH_REFUND_ROW, error: null },
      { data: null, error: null },
    ], { refund: jest.fn().mockRejectedValue(new Error('malformed response')) });

    await expect(subject.initiateRefund(operatorUser(), ORDER_ID, { reason: 'x' })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
  });
});

describe('RefundService.initiateRefund — DEC-057 § 2/§ 8: synchronous success is never REFUNDED', () => {
  it('a successful provider call moves the local state to REFUND_PENDING, never REFUNDED', async () => {
    const { subject, refund } = buildService([
      { data: CANCELLED_ORDER, error: null },
      { data: SUCCESS_PAYMENT, error: null },
      { data: FRESH_REFUND_ROW, error: null },
      { data: { ...FRESH_REFUND_ROW, state: 'REFUND_PENDING', provider_refund_id: 're_fixed' }, error: null },
    ]);
    refund.mockResolvedValue(PROVIDER_RESULT);

    const result = await subject.initiateRefund(operatorUser(), ORDER_ID, { reason: 'x' });

    expect(result.state).not.toBe('REFUNDED');
    expect(result.state).toBe('REFUND_PENDING');
    expect(result.providerRefundId).toBe('re_fixed');
  });

  it('the guarded update to REFUND_PENDING never overwrites an already-REFUNDED row', async () => {
    const { subject, calls, refund } = buildService([
      { data: CANCELLED_ORDER, error: null },
      { data: SUCCESS_PAYMENT, error: null },
      { data: FRESH_REFUND_ROW, error: null },
      { data: { ...FRESH_REFUND_ROW, state: 'REFUND_PENDING', provider_refund_id: 're_fixed' }, error: null },
    ]);
    refund.mockResolvedValue(PROVIDER_RESULT);

    await subject.initiateRefund(operatorUser(), ORDER_ID, { reason: 'x' });

    const pendingUpdate = calls.find((c) => c.table === 'refunds' && c.op === 'update');
    expect(pendingUpdate?.neq).toMatchObject({ state: 'REFUNDED' });
  });

  it('never inserts, updates, or reads any ledger table — DEC-049 reversal is Slice 2, not this slice', async () => {
    const { subject, calls, refund } = buildService([
      { data: CANCELLED_ORDER, error: null },
      { data: SUCCESS_PAYMENT, error: null },
      { data: FRESH_REFUND_ROW, error: null },
      { data: { ...FRESH_REFUND_ROW, provider_refund_id: 're_fixed' }, error: null },
    ]);
    refund.mockResolvedValue(PROVIDER_RESULT);

    await subject.initiateRefund(operatorUser(), ORDER_ID, { reason: 'x' });

    const ledgerTouched = calls.some((c) =>
      ['ledger_entry_groups', 'ledger_entries', 'payment_transactions'].includes(c.table),
    );
    expect(ledgerTouched).toBe(false);
  });

  it('never writes to orders or payments — only reads them; the guard against mutating order/payment state', async () => {
    const { subject, calls, refund } = buildService([
      { data: CANCELLED_ORDER, error: null },
      { data: SUCCESS_PAYMENT, error: null },
      { data: FRESH_REFUND_ROW, error: null },
      { data: { ...FRESH_REFUND_ROW, provider_refund_id: 're_fixed' }, error: null },
    ]);
    refund.mockResolvedValue(PROVIDER_RESULT);

    await subject.initiateRefund(operatorUser(), ORDER_ID, { reason: 'x' });

    const ordersOrPaymentsWrites = calls.filter(
      (c) => (c.table === 'orders' || c.table === 'payments') && c.op !== 'select',
    );
    expect(ordersOrPaymentsWrites).toEqual([]);
  });
});

describe('DEC-058 — AI has no refund authority', () => {
  it('the AI Operations command catalog contains no refund-related command', () => {
    const commandNames = Object.keys(COMMAND_CATALOG);
    const refundLike = commandNames.filter((name) => name.toLowerCase().includes('refund'));
    expect(refundLike).toEqual([]);
  });
});
