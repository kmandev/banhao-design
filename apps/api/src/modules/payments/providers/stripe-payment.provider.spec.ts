import type { CreatePaymentInput } from '../payment-provider.interface';

/**
 * DEC-055 — `StripePaymentProvider`. The `stripe` SDK itself is mocked (no
 * network call in a unit test); real Stripe Test-mode behaviour is proven
 * separately by `docs/STRIPE_PROMPTPAY_SANDBOX_SPIKE.md` and this task's own
 * sandbox verification pass — this file proves the *adapter's* own logic:
 * what it sends, what it does with what Stripe returns, and that it never
 * silently returns a broken success.
 */

const loadServerEnvMock = jest.fn();
jest.mock('@banhao/config', () => ({
  loadServerEnv: () => loadServerEnvMock(),
}));

const createMock = jest.fn();
const confirmMock = jest.fn();
const constructEventMock = jest.fn();

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: { create: createMock, confirm: confirmMock },
    webhooks: { constructEvent: constructEventMock },
  }));
});

import { StripePaymentProvider, StripeConfigError } from './stripe-payment.provider';

const SECRET_KEY = 'sk_test_fixture';
const WEBHOOK_SECRET = 'whsec_fixture';

function env(overrides: { stripeSecretKey?: string | undefined; stripeWebhookSecret?: string | undefined } = {}) {
  loadServerEnvMock.mockReturnValue({
    stripeSecretKey: 'stripeSecretKey' in overrides ? overrides.stripeSecretKey : SECRET_KEY,
    stripeWebhookSecret: 'stripeWebhookSecret' in overrides ? overrides.stripeWebhookSecret : WEBHOOK_SECRET,
  });
}

const INPUT: CreatePaymentInput = {
  idempotencyKey: 'order-1',
  orderId: 'order-1',
  paymentReference: 'PAY-BH000125',
  amount: { amount: 6000, currency: 'THB' },
  method: 'PROMPTPAY_QR',
  webhookUrl: '/webhooks/payments/stripe',
  email: 'customer@example.com',
};

/** A real, captured shape (`docs/STRIPE_PROMPTPAY_SANDBOX_SPIKE.md` § 2). */
const CREATED_INTENT = { id: 'pi_fixed', status: 'requires_payment_method', next_action: null };

const CONFIRMED_WITH_QR = {
  id: 'pi_fixed',
  status: 'requires_action',
  next_action: {
    type: 'promptpay_display_qr_code',
    promptpay_display_qr_code: {
      data: 'https://payments.stripe.com/payment_methods/test_payment?payment_attempt=payatt_fixed',
      hosted_instructions_url: 'https://payments.stripe.com/promptpay/instructions/fixed',
      image_url_png: 'https://qr.stripe.com/test_fixed.png',
      image_url_svg: 'https://qr.stripe.com/test_fixed.svg',
    },
  },
};

beforeEach(() => {
  loadServerEnvMock.mockReset();
  createMock.mockReset();
  confirmMock.mockReset();
  constructEventMock.mockReset();
  env();
});

describe('StripePaymentProvider — construction', () => {
  it('refuses to construct without STRIPE_SECRET_KEY', () => {
    env({ stripeSecretKey: undefined });
    expect(() => new StripePaymentProvider()).toThrow(StripeConfigError);
  });

  it('constructs fine without STRIPE_WEBHOOK_SECRET — that is checked lazily, not at construction', () => {
    env({ stripeWebhookSecret: undefined });
    expect(() => new StripePaymentProvider()).not.toThrow();
  });

  it('identifies itself as "stripe", never the null provider', () => {
    const provider = new StripePaymentProvider();
    expect(provider.name).toBe('stripe');
  });
});

describe('StripePaymentProvider.createPayment — PaymentIntent creation', () => {
  it('creates with the exact satang amount, no conversion', async () => {
    createMock.mockResolvedValue(CREATED_INTENT);
    confirmMock.mockResolvedValue(CONFIRMED_WITH_QR);
    const provider = new StripePaymentProvider();

    await provider.createPayment(INPUT);

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 6000 }),
      expect.anything(),
    );
  });

  it('creates with lowercase thb currency', async () => {
    createMock.mockResolvedValue(CREATED_INTENT);
    confirmMock.mockResolvedValue(CONFIRMED_WITH_QR);
    const provider = new StripePaymentProvider();

    await provider.createPayment(INPUT);

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ currency: 'thb' }), expect.anything());
  });

  it('creates with payment_method_types = ["promptpay"], no other method', async () => {
    createMock.mockResolvedValue(CREATED_INTENT);
    confirmMock.mockResolvedValue(CONFIRMED_WITH_QR);
    const provider = new StripePaymentProvider();

    await provider.createPayment(INPUT);

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ payment_method_types: ['promptpay'] }),
      expect.anything(),
    );
  });

  it('creates with metadata.orderId and metadata.paymentReference — the BANHAO reference, not a Stripe-invented one', async () => {
    createMock.mockResolvedValue(CREATED_INTENT);
    confirmMock.mockResolvedValue(CONFIRMED_WITH_QR);
    const provider = new StripePaymentProvider();

    await provider.createPayment(INPUT);

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { orderId: 'order-1', paymentReference: 'PAY-BH000125' },
      }),
      expect.anything(),
    );
  });

  it('creates and confirms with the given idempotencyKey, suffixed per endpoint — never the bare value on both', async () => {
    // Sandbox-verified live (this task's own Stripe Test-mode pass): Stripe
    // rejects reusing one idempotency key across two different endpoints —
    // "Keys for idempotent requests can only be used for the same endpoint
    // they were first used for." create and confirm must each get their own
    // deterministic, endpoint-scoped suffix of the same base key.
    createMock.mockResolvedValue(CREATED_INTENT);
    confirmMock.mockResolvedValue(CONFIRMED_WITH_QR);
    const provider = new StripePaymentProvider();

    await provider.createPayment(INPUT);

    expect(createMock).toHaveBeenCalledWith(expect.anything(), { idempotencyKey: 'order-1:create' });
    expect(confirmMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { idempotencyKey: 'order-1:confirm' },
    );
    // Never the bare, unsuffixed base key on either call — that is exactly
    // the shape Stripe rejects.
    expect(createMock).not.toHaveBeenCalledWith(expect.anything(), { idempotencyKey: 'order-1' });
    expect(confirmMock).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), { idempotencyKey: 'order-1' });
  });

  it('never invents an idempotency key of its own — derives deterministically from exactly what PaymentsService computed, including a regenerated attempt key', async () => {
    createMock.mockResolvedValue(CREATED_INTENT);
    confirmMock.mockResolvedValue(CONFIRMED_WITH_QR);
    const provider = new StripePaymentProvider();

    await provider.createPayment({ ...INPUT, idempotencyKey: 'order-1:2' });

    expect(createMock).toHaveBeenCalledWith(expect.anything(), { idempotencyKey: 'order-1:2:create' });
    expect(confirmMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { idempotencyKey: 'order-1:2:confirm' },
    );
  });

  it('retrying with the same input.idempotencyKey produces the exact same create/confirm key pair — deterministic, not random', async () => {
    createMock.mockResolvedValue(CREATED_INTENT);
    confirmMock.mockResolvedValue(CONFIRMED_WITH_QR);
    const provider = new StripePaymentProvider();

    await provider.createPayment(INPUT);
    await provider.createPayment(INPUT);

    const createKeys = createMock.mock.calls.map((call: unknown[]) => (call[1] as { idempotencyKey: string }).idempotencyKey);
    const confirmKeys = confirmMock.mock.calls.map((call: unknown[]) => (call[2] as { idempotencyKey: string }).idempotencyKey);
    expect(createKeys).toEqual(['order-1:create', 'order-1:create']);
    expect(confirmKeys).toEqual(['order-1:confirm', 'order-1:confirm']);
  });

  it('confirms with billing_details.email — the authoritative DEC-056 email, sent as-is, never independently sourced', async () => {
    createMock.mockResolvedValue(CREATED_INTENT);
    confirmMock.mockResolvedValue(CONFIRMED_WITH_QR);
    const provider = new StripePaymentProvider();

    await provider.createPayment({ ...INPUT, email: 'a-different-customer@example.com' });

    expect(confirmMock).toHaveBeenCalledWith(
      'pi_fixed',
      expect.objectContaining({
        payment_method_data: expect.objectContaining({
          type: 'promptpay',
          billing_details: { email: 'a-different-customer@example.com' },
        }),
      }),
      expect.anything(),
    );
  });

  it('returns the Stripe PaymentIntent id as providerPaymentId, never a Stripe SDK object', async () => {
    createMock.mockResolvedValue(CREATED_INTENT);
    confirmMock.mockResolvedValue(CONFIRMED_WITH_QR);
    const provider = new StripePaymentProvider();

    const result = await provider.createPayment(INPUT);

    expect(result.providerPaymentId).toBe('pi_fixed');
    expect(typeof result.providerPaymentId).toBe('string');
  });
});

describe('StripePaymentProvider.createPayment — presentation mapping (DEC-055 Addendum A)', () => {
  it('maps image_url_png to presentation.imageUrl', async () => {
    createMock.mockResolvedValue(CREATED_INTENT);
    confirmMock.mockResolvedValue(CONFIRMED_WITH_QR);
    const provider = new StripePaymentProvider();

    const result = await provider.createPayment(INPUT);

    expect(result.presentation?.imageUrl).toBe('https://qr.stripe.com/test_fixed.png');
  });

  it('maps hosted_instructions_url to presentation.hostedInstructionsUrl', async () => {
    createMock.mockResolvedValue(CREATED_INTENT);
    confirmMock.mockResolvedValue(CONFIRMED_WITH_QR);
    const provider = new StripePaymentProvider();

    const result = await provider.createPayment(INPUT);

    expect(result.presentation?.hostedInstructionsUrl).toBe(
      'https://payments.stripe.com/promptpay/instructions/fixed',
    );
  });

  it('presentation.type is QR_CODE', async () => {
    createMock.mockResolvedValue(CREATED_INTENT);
    confirmMock.mockResolvedValue(CONFIRMED_WITH_QR);
    const provider = new StripePaymentProvider();

    const result = await provider.createPayment(INPUT);

    expect(result.presentation?.type).toBe('QR_CODE');
  });

  it('never exposes Stripe\'s own expiry field — CreatePaymentResult.presentation has no expiresAt at the type level, and none is ever set at runtime', async () => {
    createMock.mockResolvedValue(CREATED_INTENT);
    confirmMock.mockResolvedValue(CONFIRMED_WITH_QR);
    const provider = new StripePaymentProvider();

    const result = await provider.createPayment(INPUT);

    expect(result.presentation).not.toHaveProperty('expiresAt');
  });

  it('never exposes Stripe\'s internal data field (Addendum A-5)', async () => {
    createMock.mockResolvedValue(CREATED_INTENT);
    confirmMock.mockResolvedValue(CONFIRMED_WITH_QR);
    const provider = new StripePaymentProvider();

    const result = await provider.createPayment(INPUT);

    expect(result.presentation).not.toHaveProperty('data');
    expect(JSON.stringify(result.presentation)).not.toContain('payment_attempt=payatt_fixed');
  });

  it('never selects the SVG image — the customer app has no SVG renderer', async () => {
    createMock.mockResolvedValue(CREATED_INTENT);
    confirmMock.mockResolvedValue(CONFIRMED_WITH_QR);
    const provider = new StripePaymentProvider();

    const result = await provider.createPayment(INPUT);

    expect(result.presentation?.imageUrl).not.toContain('.svg');
    expect(JSON.stringify(result.presentation)).not.toContain('test_fixed.svg');
  });
});

describe('StripePaymentProvider.createPayment — missing/unsupported next_action', () => {
  it('throws rather than returning a presentation-less "successful" result when next_action is null', async () => {
    createMock.mockResolvedValue(CREATED_INTENT);
    confirmMock.mockResolvedValue({ id: 'pi_fixed', status: 'succeeded', next_action: null });
    const provider = new StripePaymentProvider();

    await expect(provider.createPayment(INPUT)).rejects.toThrow(/promptpay_display_qr_code/);
  });

  it('throws when next_action exists but is not promptpay_display_qr_code', async () => {
    createMock.mockResolvedValue(CREATED_INTENT);
    confirmMock.mockResolvedValue({
      id: 'pi_fixed',
      status: 'requires_action',
      next_action: { type: 'use_stripe_sdk' },
    });
    const provider = new StripePaymentProvider();

    await expect(provider.createPayment(INPUT)).rejects.toThrow(/promptpay_display_qr_code/);
  });
});

describe('StripePaymentProvider.refund — Q-020 out of scope', () => {
  it('refuses, matching NullPaymentProvider\'s own precedent', async () => {
    const provider = new StripePaymentProvider();
    await expect(
      provider.refund({ idempotencyKey: 'k', providerPaymentId: 'pi_fixed', amount: { amount: 100, currency: 'THB' }, reason: 'x' }),
    ).rejects.toThrow(/does not implement refund/);
  });
});

describe('StripePaymentProvider.verifyWebhookSignature', () => {
  const RAW_BODY = '{"id":"evt_fixed"}';

  function headers(signature?: string): Record<string, string> {
    return signature ? { 'stripe-signature': signature } : {};
  }

  it('fails closed with no webhook secret configured', () => {
    env({ stripeWebhookSecret: undefined });
    const provider = new StripePaymentProvider();

    const result = provider.verifyWebhookSignature(RAW_BODY, headers('sig'));

    expect(result).toEqual({ verified: false, reason: 'No payment provider configured' });
    expect(constructEventMock).not.toHaveBeenCalled();
  });

  it('fails closed with a missing signature header', () => {
    const provider = new StripePaymentProvider();

    const result = provider.verifyWebhookSignature(RAW_BODY, headers());

    expect(result).toEqual({ verified: false, reason: 'Missing signature header' });
    expect(constructEventMock).not.toHaveBeenCalled();
  });

  it('calls Stripe\'s own constructEvent with the exact raw body — never a re-serialized reconstruction', () => {
    constructEventMock.mockReturnValue({
      id: 'evt_fixed',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_fixed', amount_received: 6000 } },
    });
    const provider = new StripePaymentProvider();

    provider.verifyWebhookSignature(RAW_BODY, headers('t=1,v1=abc'));

    expect(constructEventMock).toHaveBeenCalledWith(RAW_BODY, 't=1,v1=abc', WEBHOOK_SECRET);
  });

  it('fails closed with an invalid signature — constructEvent throwing', () => {
    constructEventMock.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature for payload');
    });
    const provider = new StripePaymentProvider();

    const result = provider.verifyWebhookSignature(RAW_BODY, headers('bad-sig'));

    expect(result).toEqual({
      verified: false,
      reason: 'No signatures found matching the expected signature for payload',
    });
  });

  it('fails closed on a malformed payload — constructEvent throwing a parse error', () => {
    constructEventMock.mockImplementation(() => {
      throw new SyntaxError('Unexpected token in JSON');
    });
    const provider = new StripePaymentProvider();

    const result = provider.verifyWebhookSignature('not json', headers('sig'));

    expect(result.verified).toBe(false);
  });

  it('normalizes payment_intent.succeeded to payment.succeeded, with flat providerPaymentId/amountSatang and the embedded original event', () => {
    const stripeEvent = {
      id: 'evt_success',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_fixed', amount: 6000, amount_received: 6000, status: 'succeeded' } },
    };
    constructEventMock.mockReturnValue(stripeEvent);
    const provider = new StripePaymentProvider();

    const result = provider.verifyWebhookSignature(RAW_BODY, headers('sig'));

    expect(result).toMatchObject({
      verified: true,
      providerPaymentId: 'pi_fixed',
      providerEventId: 'evt_success',
      providerEvent: 'payment.succeeded',
    });
    expect((result as { rawPayload: unknown }).rawPayload).toMatchObject({
      providerPaymentId: 'pi_fixed',
      amountSatang: 6000,
      stripeEvent,
    });
  });

  it('amountSatang is read from amount_received, exactly as Stripe reports it — no conversion', () => {
    constructEventMock.mockReturnValue({
      id: 'evt_success',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_fixed', amount: 7500, amount_received: 7500 } },
    });
    const provider = new StripePaymentProvider();

    const result = provider.verifyWebhookSignature(RAW_BODY, headers('sig'));

    expect((result as { rawPayload: { amountSatang: number } }).rawPayload.amountSatang).toBe(7500);
  });

  it('normalizes payment_intent.payment_failed to payment.failed, with the failure reason and never treated as terminal EXPIRED', () => {
    constructEventMock.mockReturnValue({
      id: 'evt_failed',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_fixed',
          status: 'requires_payment_method',
          last_payment_error: { message: 'The PromptPay payment attempt of this PaymentIntent has expired.' },
        },
      },
    });
    const provider = new StripePaymentProvider();

    const result = provider.verifyWebhookSignature(RAW_BODY, headers('sig'));

    expect(result).toMatchObject({ verified: true, providerEvent: 'payment.failed' });
    expect((result as { rawPayload: unknown }).rawPayload).toMatchObject({
      providerPaymentId: 'pi_fixed',
      reason: 'The PromptPay payment attempt of this PaymentIntent has expired.',
    });
  });

  it('normalizes payment_intent.canceled to a distinct name the generic processor does not recognize as failed or succeeded', () => {
    constructEventMock.mockReturnValue({
      id: 'evt_canceled',
      type: 'payment_intent.canceled',
      data: { object: { id: 'pi_fixed', status: 'canceled', canceled_at: 1700000000 } },
    });
    const provider = new StripePaymentProvider();

    const result = provider.verifyWebhookSignature(RAW_BODY, headers('sig'));

    expect(result).toMatchObject({ verified: true, providerEvent: 'payment.canceled' });
    // Never confused with a retryable failure or a success.
    expect((result as { providerEvent: string }).providerEvent).not.toBe('payment.failed');
    expect((result as { providerEvent: string }).providerEvent).not.toBe('payment.succeeded');
  });

  it('an unsubscribed/unknown Stripe event type still verifies (real signature) rather than crashing, passed through as its own raw type', () => {
    constructEventMock.mockReturnValue({
      id: 'evt_other',
      type: 'payment_intent.created',
      data: { object: { id: 'pi_fixed' } },
    });
    const provider = new StripePaymentProvider();

    const result = provider.verifyWebhookSignature(RAW_BODY, headers('sig'));

    expect(result).toMatchObject({ verified: true, providerEvent: 'payment_intent.created' });
  });

  it('verifying the same valid event twice is deterministic — no hidden adapter-side state affects duplicate delivery handling', () => {
    const stripeEvent = {
      id: 'evt_dup',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_fixed', amount_received: 6000 } },
    };
    constructEventMock.mockReturnValue(stripeEvent);
    const provider = new StripePaymentProvider();

    const first = provider.verifyWebhookSignature(RAW_BODY, headers('sig'));
    const second = provider.verifyWebhookSignature(RAW_BODY, headers('sig'));

    expect(first).toEqual(second);
  });
});
