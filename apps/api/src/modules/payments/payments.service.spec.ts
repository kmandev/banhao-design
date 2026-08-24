import { PaymentsService } from './payments.service';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { AuthenticatedUser } from '../../common/types';
import type { PaymentProvider, CreatePaymentResult } from './payment-provider.interface';

/**
 * Phase F-1 — `PaymentsService.createPayment`.
 *
 * Same stub shape as `orders.service.spec.ts`'s transition tests: a fake
 * `supabase.admin.from()` that records every filter/payload a statement was
 * built with, so a test can assert the guard — ownership, expected state — is
 * actually in the query, not merely checked afterward in application code.
 */

type Result = { data: unknown; error: { message: string; code?: string } | null };

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update';
  eq: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

function supabaseStub(results: Result[]) {
  const calls: Recorded[] = [];
  let index = 0;

  const nextResult = (): Result => results[index++] ?? { data: null, error: null };

  const admin = {
    from(table: string) {
      const call: Recorded = { table, op: 'select', eq: {} };
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
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve(nextResult()),
        then: (resolve: (r: Result) => unknown) => Promise.resolve(nextResult()).then(resolve),
      };

      return builder;
    },
  };

  return { supabase: { admin } as unknown as SupabaseService, calls };
}

const PROVIDER_RESULT: CreatePaymentResult = {
  providerPaymentId: 'NULL-fixed-id',
  presentation: { type: 'QR_STRING', value: 'NULL-QR:order-1:NULL-fixed-id', expiresAt: '2026-08-24T05:00:00.000Z' },
};

function buildService(
  results: Result[],
  options?: { provider?: Partial<PaymentProvider> },
) {
  const { supabase, calls } = supabaseStub(results);
  const createPayment = jest.fn().mockResolvedValue(PROVIDER_RESULT);
  const provider: PaymentProvider = {
    name: 'null',
    createPayment,
    refund: jest.fn(),
    verifyWebhookSignature: jest.fn(),
    ...options?.provider,
  };
  const subject = new PaymentsService(supabase, provider);
  return { subject, calls, createPayment, provider };
}

const ORDER_ID = 'order-1';
const CUSTOMER_ID = 'customer-1';

function customerUser(id = CUSTOMER_ID): AuthenticatedUser {
  return { id, phone: null, capabilities: { customer: true, merchant: [], rider: null, platformStaff: null } };
}

/** The transitioned-order row a successful guarded UPDATE `.select()`s back. */
const TRANSITIONED_ORDER = { id: ORDER_ID, order_number: 'BH-20260824-0002', grand_total_satang: 7500 };

const INSERTED_PAYMENT = {
  id: 'payment-1',
  payment_reference: 'PAY-BH20260824-0002',
  state: 'PENDING',
  amount_satang: 7500,
  currency: 'THB',
};

describe('PaymentsService.createPayment — first initialization', () => {
  it('transitions CREATED -> PENDING_PAYMENT with the correct guarded UPDATE filters', async () => {
    const { subject, calls } = buildService([
      { data: TRANSITIONED_ORDER, error: null }, // guarded UPDATE on orders
      { data: null, error: null }, // order_status_history insert
      { data: INSERTED_PAYMENT, error: null }, // payments insert
      { data: null, error: null }, // payment_attempts insert
    ]);

    await subject.createPayment(customerUser(), ORDER_ID);

    const orderUpdate = calls.find((c) => c.table === 'orders' && c.op === 'update');
    expect(orderUpdate?.payload).toEqual({ state: 'PENDING_PAYMENT' });
    expect(orderUpdate?.eq).toMatchObject({ id: ORDER_ID, customer_id: CUSTOMER_ID, state: 'CREATED' });
  });

  it('writes order_status_history CREATED -> PENDING_PAYMENT, actor CUSTOMER', async () => {
    const { subject, calls } = buildService([
      { data: TRANSITIONED_ORDER, error: null },
      { data: null, error: null },
      { data: INSERTED_PAYMENT, error: null },
      { data: null, error: null },
    ]);

    await subject.createPayment(customerUser(), ORDER_ID);

    const historyCall = calls.find((c) => c.table === 'order_status_history');
    expect(historyCall?.payload).toMatchObject({
      order_id: ORDER_ID,
      from_state: 'CREATED',
      to_state: 'PENDING_PAYMENT',
      actor_type: 'CUSTOMER',
      actor_id: CUSTOMER_ID,
    });
  });

  it('calls the provider with the amount from grand_total_satang, not any client value', async () => {
    const { subject, createPayment } = buildService([
      { data: TRANSITIONED_ORDER, error: null },
      { data: null, error: null },
      { data: INSERTED_PAYMENT, error: null },
      { data: null, error: null },
    ]);

    await subject.createPayment(customerUser(), ORDER_ID);

    expect(createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: ORDER_ID,
        amount: { amount: TRANSITIONED_ORDER.grand_total_satang, currency: 'THB' },
      }),
    );
  });

  it('inserts payments with amount_satang from the persisted order, method ONLINE, state PENDING', async () => {
    const { subject, calls } = buildService([
      { data: TRANSITIONED_ORDER, error: null },
      { data: null, error: null },
      { data: INSERTED_PAYMENT, error: null },
      { data: null, error: null },
    ]);

    await subject.createPayment(customerUser(), ORDER_ID);

    const paymentInsert = calls.find((c) => c.table === 'payments' && c.op === 'insert');
    expect(paymentInsert?.payload).toMatchObject({
      order_id: ORDER_ID,
      amount_satang: TRANSITIONED_ORDER.grand_total_satang,
      method: 'ONLINE',
      state: 'PENDING',
      currency: 'THB',
      provider: 'null',
      provider_payment_id: PROVIDER_RESULT.providerPaymentId,
    });
  });

  it('inserts payment_attempts attempt_no 1 with the provider QR and expiry', async () => {
    const { subject, calls } = buildService([
      { data: TRANSITIONED_ORDER, error: null },
      { data: null, error: null },
      { data: INSERTED_PAYMENT, error: null },
      { data: null, error: null },
    ]);

    await subject.createPayment(customerUser(), ORDER_ID);

    const attemptInsert = calls.find((c) => c.table === 'payment_attempts');
    expect(attemptInsert?.payload).toMatchObject({
      payment_id: INSERTED_PAYMENT.id,
      attempt_no: 1,
      state: 'PENDING',
      qr_payload: PROVIDER_RESULT.presentation!.value,
      expires_at: PROVIDER_RESULT.presentation!.expiresAt,
    });
  });

  it('returns the payment id, reference, state, amount, currency and QR', async () => {
    const { subject } = buildService([
      { data: TRANSITIONED_ORDER, error: null },
      { data: null, error: null },
      { data: INSERTED_PAYMENT, error: null },
      { data: null, error: null },
    ]);

    const result = await subject.createPayment(customerUser(), ORDER_ID);

    expect(result).toEqual({
      paymentId: INSERTED_PAYMENT.id,
      paymentReference: INSERTED_PAYMENT.payment_reference,
      state: 'PENDING',
      amountSatang: TRANSITIONED_ORDER.grand_total_satang,
      currency: 'THB',
      qr: { value: PROVIDER_RESULT.presentation!.value, expiresAt: PROVIDER_RESULT.presentation!.expiresAt },
    });
  });

  it('never touches orders money columns — only state is in the UPDATE payload', async () => {
    const { subject, calls } = buildService([
      { data: TRANSITIONED_ORDER, error: null },
      { data: null, error: null },
      { data: INSERTED_PAYMENT, error: null },
      { data: null, error: null },
    ]);

    await subject.createPayment(customerUser(), ORDER_ID);

    const orderUpdate = calls.find((c) => c.table === 'orders' && c.op === 'update');
    expect(Object.keys(orderUpdate?.payload ?? {})).toEqual(['state']);
  });

  it('maps a provider failure to PROVIDER_UNAVAILABLE, after the order transition already succeeded', async () => {
    const { subject } = buildService(
      [
        { data: TRANSITIONED_ORDER, error: null },
        { data: null, error: null },
      ],
      { provider: { createPayment: jest.fn().mockRejectedValue(new Error('network down')) } },
    );

    await expect(subject.createPayment(customerUser(), ORDER_ID)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
  });
});

describe('PaymentsService.createPayment — authorization and eligibility', () => {
  it('rejects with NOT_FOUND when the order does not exist', async () => {
    const { subject } = buildService([
      { data: null, error: null }, // guarded UPDATE finds nothing
      { data: null, error: null }, // diagnostic read finds nothing
    ]);

    await expect(subject.createPayment(customerUser(), ORDER_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects with NOT_FOUND (never a different code) for another customer\'s order — no existence leak', async () => {
    const { subject } = buildService([
      { data: null, error: null },
      { data: { ...TRANSITIONED_ORDER, customer_id: 'someone-else', state: 'CREATED' }, error: null },
    ]);

    await expect(
      subject.createPayment(customerUser('not-the-owner'), ORDER_ID),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each(['PAID', 'MERCHANT_ACCEPTED', 'DELIVERED', 'CANCELLED'])(
    'rejects with ORDER_NOT_PAYABLE when the order is already %s',
    async (state) => {
      const { subject } = buildService([
        { data: null, error: null },
        { data: { ...TRANSITIONED_ORDER, customer_id: CUSTOMER_ID, state }, error: null },
      ]);

      await expect(subject.createPayment(customerUser(), ORDER_ID)).rejects.toMatchObject({
        code: 'ORDER_NOT_PAYABLE',
        details: { currentState: state },
      });
    },
  );
});

describe('PaymentsService.createPayment — idempotent retry (DEC-028)', () => {
  it('an order already PENDING_PAYMENT with an existing payment returns that payment, without inserting anything new', async () => {
    const { subject, calls } = buildService([
      { data: null, error: null }, // guarded UPDATE: 0 rows, already PENDING_PAYMENT
      { data: { ...TRANSITIONED_ORDER, customer_id: CUSTOMER_ID, state: 'PENDING_PAYMENT' }, error: null },
      { data: INSERTED_PAYMENT, error: null }, // readExistingPayment: payments select
      {
        data: { qr_payload: PROVIDER_RESULT.presentation!.value, expires_at: PROVIDER_RESULT.presentation!.expiresAt },
        error: null,
      }, // readExistingPayment: payment_attempts select
    ]);

    const result = await subject.createPayment(customerUser(), ORDER_ID);

    expect(result.paymentId).toBe(INSERTED_PAYMENT.id);
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  it('self-heals when the order is PENDING_PAYMENT but no payment row exists yet (crash-recovery gap)', async () => {
    const { subject, calls } = buildService([
      { data: null, error: null }, // guarded UPDATE: already PENDING_PAYMENT
      { data: { ...TRANSITIONED_ORDER, customer_id: CUSTOMER_ID, state: 'PENDING_PAYMENT' }, error: null },
      { data: null, error: null }, // readExistingPayment: no payment row yet
      { data: INSERTED_PAYMENT, error: null }, // payments insert (self-heal)
      { data: null, error: null }, // payment_attempts insert
    ]);

    const result = await subject.createPayment(customerUser(), ORDER_ID);

    expect(result.paymentId).toBe(INSERTED_PAYMENT.id);
    const paymentInsert = calls.find((c) => c.table === 'payments' && c.op === 'insert');
    expect(paymentInsert).toBeDefined();
    // No order_status_history insert on this path — CREATED -> PENDING_PAYMENT
    // was already recorded by whichever call actually made that transition.
    expect(calls.find((c) => c.table === 'order_status_history')).toBeUndefined();
  });

  it('a genuine concurrent race on the payments insert (23505) reads back the winner, never errors', async () => {
    const { subject, calls } = buildService([
      { data: TRANSITIONED_ORDER, error: null }, // this request wins the order transition
      { data: null, error: null }, // history insert
      { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } }, // payments insert loses the race
      { data: INSERTED_PAYMENT, error: null }, // read-back: payments select
      {
        data: { qr_payload: PROVIDER_RESULT.presentation!.value, expires_at: PROVIDER_RESULT.presentation!.expiresAt },
        error: null,
      }, // read-back: payment_attempts select
    ]);

    const result = await subject.createPayment(customerUser(), ORDER_ID);

    expect(result.paymentId).toBe(INSERTED_PAYMENT.id);
    const attemptInserts = calls.filter((c) => c.table === 'payment_attempts' && c.op === 'insert');
    expect(attemptInserts).toHaveLength(0);
  });
});

describe('PaymentsService.createPayment — failure surfaces', () => {
  it('maps a database error on the guarded UPDATE itself to INTERNAL_ERROR', async () => {
    const { subject } = buildService([{ data: null, error: { message: 'connection reset' } }]);

    await expect(subject.createPayment(customerUser(), ORDER_ID)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });

  it('maps a database error on the payments insert (not a unique violation) to INTERNAL_ERROR', async () => {
    const { subject } = buildService([
      { data: TRANSITIONED_ORDER, error: null },
      { data: null, error: null },
      { data: null, error: { message: 'connection reset' } },
    ]);

    await expect(subject.createPayment(customerUser(), ORDER_ID)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });
});
