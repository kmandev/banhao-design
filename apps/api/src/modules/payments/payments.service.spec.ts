import { PaymentsService, PAYMENT_ATTEMPT_TTL_MS } from './payments.service';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { AuthenticatedUser } from '../../common/types';
import type { PaymentProvider, CreatePaymentResult } from './payment-provider.interface';
import type { CustomerEmailSource } from './customer-email-source';

/**
 * Asserts `actualIso` is a real, freshly-computed BANHAO expiry — never a
 * literal echoed from the provider (DEC-055 Addendum A:
 * `CreatePaymentResult.presentation` carries no expiry field at all, so any
 * value here came from `PaymentsService`'s own clock). A tolerant range,
 * mirroring the pattern `NullPaymentProvider`'s own test used before expiry
 * ownership moved here.
 */
function expectFreshExpiry(actualIso: string | undefined, beforeMs: number, afterMs: number): void {
  expect(actualIso).toBeDefined();
  const actualMs = new Date(actualIso as string).getTime();
  expect(actualMs).toBeGreaterThanOrEqual(beforeMs + PAYMENT_ATTEMPT_TTL_MS);
  expect(actualMs).toBeLessThanOrEqual(afterMs + PAYMENT_ATTEMPT_TTL_MS);
}

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
  in: Record<string, unknown[]>;
  payload?: Record<string, unknown>;
}

function supabaseStub(results: Result[]) {
  const calls: Recorded[] = [];
  let index = 0;

  const nextResult = (): Result => results[index++] ?? { data: null, error: null };

  const admin = {
    from(table: string) {
      const call: Recorded = { table, op: 'select', eq: {}, in: {} };
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
        in(column: string, values: unknown[]) {
          call.in[column] = values;
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
  // No expiresAt — DEC-055 Addendum A: the provider contract carries none.
  presentation: { type: 'QR_CODE', imageUrl: 'https://null-provider.local/qr/order-1/NULL-fixed-id.png' },
};

/**
 * A `payment_attempts` row already durably stored, as `fetchPaymentWithAttempt`
 * or `resumePayment`'s live-attempt branch would read it back — a plain DB
 * read, decoupled from `PROVIDER_RESULT` (which no longer carries an expiry to
 * derive one from) and from real time (the row was written at some past
 * moment, not "just now"). Reused across every fixture representing "what is
 * already in the database", never a fresh provider call.
 */
const STORED_ATTEMPT_QR_PAYLOAD = 'https://null-provider.local/qr/order-1/NULL-fixed-id.png';
const STORED_ATTEMPT_EXPIRES_AT = '2026-08-24T05:00:00.000Z';

/**
 * The authoritative email every test gets by default (DEC-056) — a clearly
 * labelled test address, never `@banhao.local`/`@banhao.invalid`, which
 * DEC-056 clause 9 reserves for dev/test *provider* fixtures, not for
 * standing in as a real customer's address in tests that exercise the real
 * payment-lifecycle behaviour these tests are about.
 */
const VALID_CUSTOMER_EMAIL = 'customer@example.com';

function fakeEmailSource(email: string | null = VALID_CUSTOMER_EMAIL): { source: CustomerEmailSource; resolve: jest.Mock } {
  const resolve = jest.fn().mockResolvedValue(email);
  return { source: { resolve }, resolve };
}

function buildService(
  results: Result[],
  options?: { provider?: Partial<PaymentProvider>; emailSource?: CustomerEmailSource },
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
  const emailSource = options?.emailSource ?? fakeEmailSource().source;
  const subject = new PaymentsService(supabase, provider, emailSource);
  return { subject, calls, createPayment, provider, emailSource };
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

  it('inserts payment_attempts attempt_no 1 with the provider image URL and a BANHAO-computed expiry', async () => {
    const { subject, calls } = buildService([
      { data: TRANSITIONED_ORDER, error: null },
      { data: null, error: null },
      { data: INSERTED_PAYMENT, error: null },
      { data: null, error: null },
    ]);

    const before = Date.now();
    await subject.createPayment(customerUser(), ORDER_ID);
    const after = Date.now();

    const attemptInsert = calls.find((c) => c.table === 'payment_attempts');
    expect(attemptInsert?.payload).toMatchObject({
      payment_id: INSERTED_PAYMENT.id,
      attempt_no: 1,
      state: 'PENDING',
      qr_payload: PROVIDER_RESULT.presentation!.imageUrl,
    });
    expectFreshExpiry(attemptInsert?.payload?.expires_at as string | undefined, before, after);
  });

  it('returns the payment id, reference, state, amount, currency and QR', async () => {
    const { subject } = buildService([
      { data: TRANSITIONED_ORDER, error: null },
      { data: null, error: null },
      { data: INSERTED_PAYMENT, error: null },
      { data: null, error: null },
    ]);

    const before = Date.now();
    const result = await subject.createPayment(customerUser(), ORDER_ID);
    const after = Date.now();

    expect(result).toMatchObject({
      paymentId: INSERTED_PAYMENT.id,
      paymentReference: INSERTED_PAYMENT.payment_reference,
      state: 'PENDING',
      amountSatang: TRANSITIONED_ORDER.grand_total_satang,
      currency: 'THB',
    });
    expect(result.qr).toMatchObject({ type: 'QR_CODE', imageUrl: PROVIDER_RESULT.presentation!.imageUrl });
    // PROVIDER_RESULT has no hostedInstructionsUrl — must not appear on the wire.
    expect(result.qr).not.toHaveProperty('hostedInstructionsUrl');
    expectFreshExpiry(result.qr?.expiresAt, before, after);
  });

  it('preserves hostedInstructionsUrl in the response when the provider supplies one', async () => {
    const resultWithHosted: CreatePaymentResult = {
      providerPaymentId: 'NULL-with-hosted',
      presentation: {
        type: 'QR_CODE',
        imageUrl: 'https://null-provider.local/qr/order-1/NULL-with-hosted.png',
        hostedInstructionsUrl: 'https://null-provider.local/instructions/order-1',
      },
    };
    const { subject } = buildService(
      [
        { data: TRANSITIONED_ORDER, error: null },
        { data: null, error: null },
        { data: INSERTED_PAYMENT, error: null },
        { data: null, error: null },
      ],
      { provider: { createPayment: jest.fn().mockResolvedValue(resultWithHosted) } },
    );

    const result = await subject.createPayment(customerUser(), ORDER_ID);

    expect(result.qr).toMatchObject({
      hostedInstructionsUrl: resultWithHosted.presentation!.hostedInstructionsUrl,
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

/**
 * DEC-056 — the customer-email fail-closed contract. `resolveAuthoritativeEmail`
 * runs before anything else in `createPayment`, so every case below supplies
 * only the guarded-UPDATE `Result` stub — no order/payment/attempt mutation
 * is ever reached, and asserting `calls` is empty proves it.
 */
describe('PaymentsService.createPayment — customer email fail-closed (DEC-056)', () => {
  it('rejects with CUSTOMER_EMAIL_REQUIRED when the authoritative source has no email at all', async () => {
    const { source, resolve } = fakeEmailSource(null);
    const { subject, calls, createPayment } = buildService([], { emailSource: source });

    await expect(subject.createPayment(customerUser(), ORDER_ID)).rejects.toMatchObject({
      code: 'CUSTOMER_EMAIL_REQUIRED',
    });
    expect(resolve).toHaveBeenCalledWith(CUSTOMER_ID);
    expect(createPayment).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0); // not even the guarded orders UPDATE ran
  });

  it('rejects with CUSTOMER_EMAIL_REQUIRED when the authoritative source returns an empty string', async () => {
    const { source } = fakeEmailSource('');
    const { subject, calls, createPayment } = buildService([], { emailSource: source });

    await expect(subject.createPayment(customerUser(), ORDER_ID)).rejects.toMatchObject({
      code: 'CUSTOMER_EMAIL_REQUIRED',
    });
    expect(createPayment).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it.each(['not-an-email', 'missing-at-sign.example.com', '@no-local-part.com', 'trailing-dot@example.com.'])(
    'rejects with CUSTOMER_EMAIL_REQUIRED for the malformed address %s',
    async (malformed) => {
      const { source } = fakeEmailSource(malformed);
      const { subject, calls, createPayment } = buildService([], { emailSource: source });

      await expect(subject.createPayment(customerUser(), ORDER_ID)).rejects.toMatchObject({
        code: 'CUSTOMER_EMAIL_REQUIRED',
      });
      expect(createPayment).not.toHaveBeenCalled();
      expect(calls).toHaveLength(0);
    },
  );

  it('never substitutes the customer id, phone, or any synthetic value for a missing email', async () => {
    const { source } = fakeEmailSource(null);
    const { subject, createPayment } = buildService([], { emailSource: source });

    await expect(subject.createPayment(customerUser(), ORDER_ID)).rejects.toMatchObject({
      code: 'CUSTOMER_EMAIL_REQUIRED',
    });
    // The rejection itself is the proof there is no fallback path to assert
    // against — createPayment (and therefore any email value) was never
    // reached at all.
    expect(createPayment).not.toHaveBeenCalled();
  });

  it('a valid email proceeds through the existing flow and reaches the provider unchanged', async () => {
    const { source, resolve } = fakeEmailSource('real.customer@example.com');
    const { subject, createPayment } = buildService(
      [
        { data: TRANSITIONED_ORDER, error: null },
        { data: null, error: null },
        { data: INSERTED_PAYMENT, error: null },
        { data: null, error: null },
      ],
      { emailSource: source },
    );

    const result = await subject.createPayment(customerUser(), ORDER_ID);

    expect(resolve).toHaveBeenCalledWith(CUSTOMER_ID);
    expect(createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'real.customer@example.com' }),
    );
    expect(result.paymentId).toBe(INSERTED_PAYMENT.id);
  });

  it('trims whitespace around an otherwise-valid email before it reaches the provider', async () => {
    const { source } = fakeEmailSource('  spaced@example.com  ');
    const { subject, createPayment } = buildService(
      [
        { data: TRANSITIONED_ORDER, error: null },
        { data: null, error: null },
        { data: INSERTED_PAYMENT, error: null },
        { data: null, error: null },
      ],
      { emailSource: source },
    );

    await subject.createPayment(customerUser(), ORDER_ID);

    expect(createPayment).toHaveBeenCalledWith(expect.objectContaining({ email: 'spaced@example.com' }));
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
        data: { qr_payload: STORED_ATTEMPT_QR_PAYLOAD, expires_at: STORED_ATTEMPT_EXPIRES_AT },
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
        data: { qr_payload: STORED_ATTEMPT_QR_PAYLOAD, expires_at: STORED_ATTEMPT_EXPIRES_AT },
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

/**
 * Payment QR regeneration + PAYMENT_ALREADY_SUCCEEDED guard — completes the
 * contract `docs/BANHAO-APP-ARCHITECTURE-V1.md` § 6 already documents for a
 * repeat call to this same endpoint. `createPayment`'s first guarded UPDATE
 * always matches 0 rows in every scenario below (the order is already
 * PENDING_PAYMENT from a prior call), so every sequence starts with that
 * `null`, then the diagnostic `orders` select, then `fetchPaymentWithAttempt`'s
 * two selects (`payments`, `payment_attempts`) — exactly the call order
 * `recoverOrRejectInitiation` / `resumePayment` produce.
 */

const PENDING_PAYMENT_ORDER = { ...TRANSITIONED_ORDER, customer_id: CUSTOMER_ID, state: 'PENDING_PAYMENT' };

const REGENERATED_PROVIDER_RESULT: CreatePaymentResult = {
  providerPaymentId: 'NULL-regenerated-id',
  // No expiresAt — DEC-055 Addendum A: the provider contract carries none.
  presentation: {
    type: 'QR_CODE',
    imageUrl: 'https://null-provider.local/qr/order-1/NULL-regenerated-id.png',
  },
};

/** What a regenerated attempt's DB read-back carries — a plain stored row, decoupled from real time. */
const REGENERATED_ATTEMPT_STORED_EXPIRES_AT = '2026-08-24T05:20:00.000Z';

function attemptRow(overrides: { attempt_no?: number; state?: string } = {}) {
  return {
    id: 'attempt-1',
    attempt_no: overrides.attempt_no ?? 1,
    state: overrides.state ?? 'PENDING',
    qr_payload: STORED_ATTEMPT_QR_PAYLOAD,
    expires_at: STORED_ATTEMPT_EXPIRES_AT,
  };
}

function paymentRowWithState(state: string) {
  return { ...INSERTED_PAYMENT, state };
}

function buildRegenServiceForNoRewrite(
  paymentState: string,
  attemptState: string,
  results?: Result[],
): { subject: PaymentsService; calls: Recorded[]; createPayment: jest.Mock } {
  const { subject, calls, createPayment } = buildService(
    results ?? [
      { data: null, error: null }, // orders guarded UPDATE -> 0 rows
      { data: PENDING_PAYMENT_ORDER, error: null }, // orders diagnostic select
      { data: paymentRowWithState(paymentState), error: null }, // payments select
      { data: attemptRow({ state: attemptState }), error: null }, // payment_attempts select
    ],
  );
  return { subject, calls, createPayment };
}

describe('PaymentsService.createPayment — resumption: live attempt (A)', () => {
  it('1. PENDING payment with a live attempt returns the same attempt/QR, creates nothing, never calls the provider', async () => {
    const { subject, calls, createPayment } = buildRegenServiceForNoRewrite('PENDING', 'PENDING');

    const result = await subject.createPayment(customerUser(), ORDER_ID);

    expect(result).toEqual({
      paymentId: INSERTED_PAYMENT.id,
      paymentReference: INSERTED_PAYMENT.payment_reference,
      state: 'PENDING',
      amountSatang: INSERTED_PAYMENT.amount_satang,
      currency: 'THB',
      qr: { type: 'QR_CODE', imageUrl: STORED_ATTEMPT_QR_PAYLOAD, expiresAt: STORED_ATTEMPT_EXPIRES_AT },
    });
    expect(createPayment).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.table !== 'orders' && (c.op === 'insert' || c.op === 'update'))).toHaveLength(0);
  });

  it('2. PROCESSING payment with a live attempt returns the same attempt, no regeneration', async () => {
    const { subject, calls, createPayment } = buildRegenServiceForNoRewrite('PROCESSING', 'PENDING');

    const result = await subject.createPayment(customerUser(), ORDER_ID);

    expect(result.state).toBe('PROCESSING');
    expect(result.qr).toEqual({
      type: 'QR_CODE',
      imageUrl: STORED_ATTEMPT_QR_PAYLOAD,
      expiresAt: STORED_ATTEMPT_EXPIRES_AT,
    });
    expect(createPayment).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.table !== 'orders' && (c.op === 'insert' || c.op === 'update'))).toHaveLength(0);
  });
});

describe('PaymentsService.createPayment — resumption: regeneration (B, C)', () => {
  it('3. an EXPIRED payment regenerates: provider called, new attempt attempt_no = max+1, payment -> PENDING, new QR returned', async () => {
    const regeneratedCreatePayment = jest.fn().mockResolvedValue(REGENERATED_PROVIDER_RESULT);
    const { subject, calls } = buildService(
      [
        { data: null, error: null },
        { data: PENDING_PAYMENT_ORDER, error: null },
        { data: paymentRowWithState('EXPIRED'), error: null },
        { data: attemptRow({ attempt_no: 1, state: 'EXPIRED' }), error: null },
        {
          data: {
            id: 'attempt-2',
            attempt_no: 2,
            state: 'PENDING',
            qr_payload: REGENERATED_PROVIDER_RESULT.presentation!.imageUrl,
            expires_at: REGENERATED_ATTEMPT_STORED_EXPIRES_AT,
          },
          error: null,
        }, // payment_attempts insert
        { data: paymentRowWithState('PENDING'), error: null }, // payments guarded UPDATE
      ],
      { provider: { createPayment: regeneratedCreatePayment } },
    );

    const before = Date.now();
    const result = await subject.createPayment(customerUser(), ORDER_ID);
    const after = Date.now();

    expect(regeneratedCreatePayment).toHaveBeenCalledTimes(1);

    const attemptInsert = calls.find((c) => c.table === 'payment_attempts' && c.op === 'insert');
    expect(attemptInsert?.payload).toMatchObject({
      payment_id: INSERTED_PAYMENT.id,
      attempt_no: 2,
      state: 'PENDING',
      qr_payload: REGENERATED_PROVIDER_RESULT.presentation!.imageUrl,
    });
    // The INSERT payload's expiry is computed fresh by PaymentsService itself
    // (never echoed from the provider) — asserted against real elapsed time,
    // distinct from the DB read-back literal above (which represents
    // whatever Postgres actually returns, decoupled from this in-process call).
    expectFreshExpiry(attemptInsert?.payload?.expires_at as string | undefined, before, after);

    const paymentUpdate = calls.find((c) => c.table === 'payments' && c.op === 'update');
    expect(paymentUpdate?.payload).toEqual({
      state: 'PENDING',
      provider_payment_id: REGENERATED_PROVIDER_RESULT.providerPaymentId,
    });
    expect(paymentUpdate?.eq).toMatchObject({ id: INSERTED_PAYMENT.id });
    expect(paymentUpdate?.in).toEqual({ state: ['EXPIRED', 'FAILED'] });

    expect(result.state).toBe('PENDING');
    expect(result.qr).toEqual({
      type: 'QR_CODE',
      imageUrl: REGENERATED_PROVIDER_RESULT.presentation!.imageUrl,
      expiresAt: REGENERATED_ATTEMPT_STORED_EXPIRES_AT,
    });
  });

  it('4. a FAILED payment regenerates identically to EXPIRED', async () => {
    const regeneratedCreatePayment = jest.fn().mockResolvedValue(REGENERATED_PROVIDER_RESULT);
    const { subject, calls } = buildService(
      [
        { data: null, error: null },
        { data: PENDING_PAYMENT_ORDER, error: null },
        { data: paymentRowWithState('FAILED'), error: null },
        { data: attemptRow({ attempt_no: 1, state: 'FAILED' }), error: null },
        {
          data: {
            id: 'attempt-2',
            attempt_no: 2,
            state: 'PENDING',
            qr_payload: REGENERATED_PROVIDER_RESULT.presentation!.imageUrl,
            expires_at: REGENERATED_ATTEMPT_STORED_EXPIRES_AT,
          },
          error: null,
        },
        { data: paymentRowWithState('PENDING'), error: null },
      ],
      { provider: { createPayment: regeneratedCreatePayment } },
    );

    const result = await subject.createPayment(customerUser(), ORDER_ID);

    expect(regeneratedCreatePayment).toHaveBeenCalledTimes(1);
    const attemptInsert = calls.find((c) => c.table === 'payment_attempts' && c.op === 'insert');
    expect(attemptInsert?.payload).toMatchObject({ attempt_no: 2 });
    const paymentUpdate = calls.find((c) => c.table === 'payments' && c.op === 'update');
    expect(paymentUpdate?.in).toEqual({ state: ['EXPIRED', 'FAILED'] });
    expect(result.state).toBe('PENDING');
  });

  it('11. regeneration never writes orders or order_status_history — only the initial no-op guarded UPDATE touches orders', async () => {
    const { subject, calls } = buildService(
      [
        { data: null, error: null },
        { data: PENDING_PAYMENT_ORDER, error: null },
        { data: paymentRowWithState('EXPIRED'), error: null },
        { data: attemptRow({ attempt_no: 1, state: 'EXPIRED' }), error: null },
        { data: { id: 'attempt-2', attempt_no: 2, state: 'PENDING', qr_payload: 'q', expires_at: 'e' }, error: null },
        { data: paymentRowWithState('PENDING'), error: null },
      ],
      { provider: { createPayment: jest.fn().mockResolvedValue(REGENERATED_PROVIDER_RESULT) } },
    );

    await subject.createPayment(customerUser(), ORDER_ID);

    expect(calls.filter((c) => c.table === 'orders' && c.op === 'update')).toHaveLength(1);
    expect(calls.find((c) => c.table === 'order_status_history')).toBeUndefined();
  });

  it('10b. regeneration self-heals when the payment guarded UPDATE affects 0 rows (a concurrent transition already happened), without discarding the new attempt', async () => {
    const { subject, calls } = buildService(
      [
        { data: null, error: null },
        { data: PENDING_PAYMENT_ORDER, error: null },
        { data: paymentRowWithState('EXPIRED'), error: null },
        { data: attemptRow({ attempt_no: 1, state: 'EXPIRED' }), error: null },
        {
          data: { id: 'attempt-2', attempt_no: 2, state: 'PENDING', qr_payload: 'q', expires_at: 'e' },
          error: null,
        }, // attempt insert succeeds — we won the attempt_no race
        { data: null, error: null }, // payments guarded UPDATE -> 0 rows
        { data: paymentRowWithState('PENDING'), error: null }, // self-heal re-read
      ],
      { provider: { createPayment: jest.fn().mockResolvedValue(REGENERATED_PROVIDER_RESULT) } },
    );

    const result = await subject.createPayment(customerUser(), ORDER_ID);

    expect(result.state).toBe('PENDING');
    expect(result.qr).toEqual({ type: 'QR_CODE', imageUrl: 'q', expiresAt: 'e' });
    const attemptInserts = calls.filter((c) => c.table === 'payment_attempts' && c.op === 'insert');
    expect(attemptInserts).toHaveLength(1); // never retried, never discarded
  });
});

describe('PaymentsService.createPayment — PAYMENT_ALREADY_SUCCEEDED guard (D)', () => {
  it.each(['SUCCESS', 'REFUND_PENDING', 'REFUND_PROCESSING', 'REFUNDED'])(
    '5-8. a %s payment rejects with PAYMENT_ALREADY_SUCCEEDED, no provider call, no insert, no update',
    async (state) => {
      const { subject, calls, createPayment } = buildRegenServiceForNoRewrite(state, 'SUCCESS');

      await expect(subject.createPayment(customerUser(), ORDER_ID)).rejects.toMatchObject({
        code: 'PAYMENT_ALREADY_SUCCEEDED',
        details: { currentState: state },
      });
      expect(createPayment).not.toHaveBeenCalled();
      expect(calls.filter((c) => c.table !== 'orders' && (c.op === 'insert' || c.op === 'update'))).toHaveLength(0);
    },
  );
});

describe('PaymentsService.createPayment — concurrent regeneration (9)', () => {
  it('9. two regenerations racing on attempt_no: the loser reads back the winner\'s attempt, never inserts twice, never overwrites', async () => {
    const regeneratedCreatePayment = jest.fn().mockResolvedValue(REGENERATED_PROVIDER_RESULT);
    const { subject, calls } = buildService(
      [
        { data: null, error: null },
        { data: PENDING_PAYMENT_ORDER, error: null },
        { data: paymentRowWithState('EXPIRED'), error: null },
        { data: attemptRow({ attempt_no: 1, state: 'EXPIRED' }), error: null },
        // this caller's insert loses the attempt_no unique-constraint race
        { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } },
        // read-back: the winner's payment (now PENDING) and its attempt (attempt_no 2)
        { data: paymentRowWithState('PENDING'), error: null },
        {
          data: {
            id: 'attempt-2',
            attempt_no: 2,
            state: 'PENDING',
            qr_payload: REGENERATED_PROVIDER_RESULT.presentation!.imageUrl,
            expires_at: REGENERATED_ATTEMPT_STORED_EXPIRES_AT,
          },
          error: null,
        },
      ],
      { provider: { createPayment: regeneratedCreatePayment } },
    );

    const result = await subject.createPayment(customerUser(), ORDER_ID);

    expect(regeneratedCreatePayment).toHaveBeenCalledTimes(1); // this caller's own (wasted) provider call
    expect(result.state).toBe('PENDING');
    expect(result.qr).toEqual({
      type: 'QR_CODE',
      imageUrl: REGENERATED_PROVIDER_RESULT.presentation!.imageUrl,
      expiresAt: REGENERATED_ATTEMPT_STORED_EXPIRES_AT,
    });
    const attemptInserts = calls.filter((c) => c.table === 'payment_attempts' && c.op === 'insert');
    expect(attemptInserts).toHaveLength(1); // the one attempt, which conflicted — never retried
    expect(calls.find((c) => c.table === 'payments' && c.op === 'update')).toBeUndefined(); // the loser never writes payments
  });
});

describe('PaymentsService.createPayment — unmodeled payment state (defensive)', () => {
  it('a payment in a state resumePayment does not recognize (e.g. CANCELLED) fails closed with INTERNAL_ERROR, no writes', async () => {
    const { subject, calls, createPayment } = buildRegenServiceForNoRewrite('CANCELLED', 'CANCELLED');

    await expect(subject.createPayment(customerUser(), ORDER_ID)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    expect(createPayment).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.table !== 'orders' && (c.op === 'insert' || c.op === 'update'))).toHaveLength(0);
  });
});
