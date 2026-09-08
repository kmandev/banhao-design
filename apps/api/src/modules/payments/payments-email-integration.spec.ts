import { PaymentsService } from './payments.service';
import { ProfileCustomerEmailSource } from './customer-email-source';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { AuthenticatedUser } from '../../common/types';
import type { PaymentProvider, CreatePaymentResult } from './payment-provider.interface';

/**
 * DEC-056 — the real integration this slice exists to prove: a payment
 * initiated for a customer whose `profiles.email` is set reaches
 * `CreatePaymentInput.email` with that exact value, read by the real
 * `ProfileCustomerEmailSource` — not a test double standing in for it. A
 * customer with no persisted email still fails closed, with the provider
 * never called, exactly as `payments.service.spec.ts`'s own DEC-056 suite
 * already proves generically for any `CustomerEmailSource`; this file proves
 * it for the one now actually wired into `PaymentsModule`.
 */

type Result = { data: unknown; error: { message: string; code?: string } | null };

function supabaseStub(results: Result[]) {
  const calls: { table: string }[] = [];
  let index = 0;
  const nextResult = (): Result => results[index++] ?? { data: null, error: null };

  const admin = {
    from(table: string) {
      calls.push({ table });
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: () => builder,
        update: () => builder,
        eq: () => builder,
        in: () => builder,
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

const ORDER_ID = 'order-1';
const CUSTOMER_ID = 'customer-1';

function customerUser(): AuthenticatedUser {
  return { id: CUSTOMER_ID, phone: null, capabilities: { customer: true, merchant: [], rider: null, platformStaff: null } };
}

const PROVIDER_RESULT: CreatePaymentResult = {
  providerPaymentId: 'NULL-fixed-id',
  presentation: { type: 'QR_CODE', imageUrl: 'https://null-provider.local/qr/order-1/NULL-fixed-id.png' },
};

const TRANSITIONED_ORDER = { id: ORDER_ID, order_number: 'BH-20260908-0001', grand_total_satang: 7500 };
const INSERTED_PAYMENT = {
  id: 'payment-1',
  payment_reference: 'PAY-BH20260908-0001',
  state: 'PENDING',
  amount_satang: 7500,
  currency: 'THB',
};

describe('PaymentsService + ProfileCustomerEmailSource — end to end (DEC-056)', () => {
  it('a customer with a persisted email reaches CreatePaymentInput.email with that exact value', async () => {
    const createPayment = jest.fn().mockResolvedValue(PROVIDER_RESULT);
    const provider: PaymentProvider = {
      name: 'null',
      createPayment,
      refund: jest.fn(),
      verifyWebhookSignature: jest.fn(),
    };

    const { supabase } = supabaseStub([
      { data: { email: 'real.customer@example.com' }, error: null }, // ProfileCustomerEmailSource.resolve
      { data: TRANSITIONED_ORDER, error: null }, // orders guarded UPDATE
      { data: null, error: null }, // order_status_history insert
      { data: INSERTED_PAYMENT, error: null }, // payments insert
      { data: null, error: null }, // payment_attempts insert
    ]);

    const emailSource = new ProfileCustomerEmailSource(supabase);
    const subject = new PaymentsService(supabase, provider, emailSource);

    const result = await subject.createPayment(customerUser(), ORDER_ID);

    expect(createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'real.customer@example.com' }),
    );
    expect(result.paymentId).toBe(INSERTED_PAYMENT.id);
  });

  it('a customer with no persisted email fails closed — the provider is never called, no order mutation happens', async () => {
    const createPayment = jest.fn();
    const provider: PaymentProvider = {
      name: 'null',
      createPayment,
      refund: jest.fn(),
      verifyWebhookSignature: jest.fn(),
    };

    const { supabase, calls } = supabaseStub([
      { data: { email: null }, error: null }, // ProfileCustomerEmailSource.resolve — no email set
    ]);

    const emailSource = new ProfileCustomerEmailSource(supabase);
    const subject = new PaymentsService(supabase, provider, emailSource);

    await expect(subject.createPayment(customerUser(), ORDER_ID)).rejects.toMatchObject({
      code: 'CUSTOMER_EMAIL_REQUIRED',
    });
    expect(createPayment).not.toHaveBeenCalled();
    // Only the email lookup ran — no orders/payments/attempts table was ever touched.
    expect(calls).toEqual([{ table: 'profiles' }]);
  });

  it('a customer whose profile row does not exist yet also fails closed, never substitutes an id/phone', async () => {
    const createPayment = jest.fn();
    const provider: PaymentProvider = {
      name: 'null',
      createPayment,
      refund: jest.fn(),
      verifyWebhookSignature: jest.fn(),
    };

    const { supabase } = supabaseStub([
      { data: null, error: null }, // ProfileCustomerEmailSource.resolve — no row at all
    ]);

    const emailSource = new ProfileCustomerEmailSource(supabase);
    const subject = new PaymentsService(supabase, provider, emailSource);

    await expect(subject.createPayment(customerUser(), ORDER_ID)).rejects.toMatchObject({
      code: 'CUSTOMER_EMAIL_REQUIRED',
    });
    expect(createPayment).not.toHaveBeenCalled();
  });
});
