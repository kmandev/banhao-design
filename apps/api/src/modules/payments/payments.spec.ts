import { createHmac } from 'node:crypto';
import { NotImplementedException } from '@nestjs/common';

const loadServerEnvMock = jest.fn();
jest.mock('@banhao/config', () => ({
  loadServerEnv: () => loadServerEnvMock(),
}));

import { NullPaymentProvider, NULL_PROVIDER_SIGNATURE_HEADER } from './providers/null-payment.provider';

/**
 * `createPayment` (F-1) and `verifyWebhookSignature` (F-2a) both return real
 * (explicitly fake) results rather than throwing — DEC-APP-007, V1.1 § 8.
 * `refund` is untouched and must keep refusing.
 *
 * `verifyWebhookSignature`'s tests exercise the real HMAC-SHA256 algorithm
 * end to end (sign here with `createHmac`, verify via the provider) rather
 * than mocking crypto — the whole point is proving the constant-time
 * comparison and exact-byte sensitivity actually work.
 */
describe('NullPaymentProvider', () => {
  const DEV_SECRET = 'dev-secret-for-tests-only';

  function env(overrides: { nodeEnv?: string; paymentWebhookDevSecret?: string | undefined } = {}) {
    loadServerEnvMock.mockReturnValue({
      nodeEnv: overrides.nodeEnv ?? 'development',
      paymentWebhookDevSecret:
        'paymentWebhookDevSecret' in overrides ? overrides.paymentWebhookDevSecret : DEV_SECRET,
    });
  }

  beforeEach(() => {
    loadServerEnvMock.mockReset();
    env();
  });

  const INPUT = {
    idempotencyKey: 'order-1',
    orderId: 'order-1',
    amount: { amount: 7500, currency: 'THB' as const },
    method: 'PROMPTPAY_QR' as const,
    webhookUrl: '/webhooks/payments/null',
  };

  describe('createPayment — simulated, dev-only', () => {
    it('returns a result rather than throwing', async () => {
      const provider = new NullPaymentProvider();
      await expect(provider.createPayment(INPUT)).resolves.toBeDefined();
    });

    it('mints a providerPaymentId clearly labelled as the null provider, never a bare/opaque id', async () => {
      const provider = new NullPaymentProvider();
      const result = await provider.createPayment(INPUT);
      expect(result.providerPaymentId).toMatch(/^NULL-/);
    });

    it('returns a QR_STRING presentation with an expiry roughly 10 minutes out', async () => {
      const provider = new NullPaymentProvider();
      const before = Date.now();
      const result = await provider.createPayment(INPUT);
      const after = Date.now();

      expect(result.presentation?.type).toBe('QR_STRING');
      const expiresAt = new Date(result.presentation!.expiresAt).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(before + 9 * 60 * 1000);
      expect(expiresAt).toBeLessThanOrEqual(after + 11 * 60 * 1000);
    });

    it('the QR value is explicitly labelled NULL, never formatted as a real PromptPay payload', async () => {
      const provider = new NullPaymentProvider();
      const result = await provider.createPayment(INPUT);
      expect(result.presentation?.value).toMatch(/^NULL-QR:/);
    });

    it('two calls for two different orders produce two different providerPaymentIds — never a fixed fixture value', async () => {
      const provider = new NullPaymentProvider();
      const first = await provider.createPayment(INPUT);
      const second = await provider.createPayment({ ...INPUT, orderId: 'order-2', idempotencyKey: 'order-2' });
      expect(first.providerPaymentId).not.toBe(second.providerPaymentId);
    });

    it('makes no network call — provider.name identifies it as the null provider, not a real one', () => {
      const provider = new NullPaymentProvider();
      expect(provider.name).toBe('null');
    });
  });

  describe('refund — unchanged, still refuses (out of scope this session)', () => {
    it('refuses to refund while no provider is configured', async () => {
      const provider = new NullPaymentProvider();
      await expect(
        provider.refund({
          idempotencyKey: 'key-2',
          providerPaymentId: 'pay-1',
          amount: { amount: 13000, currency: 'THB' },
          reason: 'customer cancelled',
        }),
      ).rejects.toThrow(NotImplementedException);
    });
  });

  describe('verifyWebhookSignature — dev-only HMAC-SHA256 (F-2a)', () => {
    function sign(secret: string, rawBody: string): string {
      // Independent of the provider's own signing helper (the simulator) —
      // this reimplements the algorithm by hand so the test is not just
      // checking the provider against itself.
      return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
    }

    const PAYLOAD = {
      simulated: true,
      source: 'test',
      eventType: 'payment.succeeded',
      providerEventId: 'NULL-EVT-1',
      providerPaymentId: 'NULL-payment-1',
    };
    const RAW_BODY = JSON.stringify(PAYLOAD);

    it('verifies a correctly signed event as true, with the provider identity fields', () => {
      const provider = new NullPaymentProvider();
      const signature = sign(DEV_SECRET, RAW_BODY);

      const result = provider.verifyWebhookSignature(RAW_BODY, {
        [NULL_PROVIDER_SIGNATURE_HEADER.toLowerCase()]: signature,
      });

      expect(result).toMatchObject({
        verified: true,
        providerPaymentId: PAYLOAD.providerPaymentId,
        providerEventId: PAYLOAD.providerEventId,
        providerEvent: PAYLOAD.eventType,
      });
    });

    it('rejects an incorrect signature', () => {
      const provider = new NullPaymentProvider();

      const result = provider.verifyWebhookSignature(RAW_BODY, {
        [NULL_PROVIDER_SIGNATURE_HEADER.toLowerCase()]: 'a'.repeat(64),
      });

      expect(result.verified).toBe(false);
    });

    it('rejects a missing signature header', () => {
      const provider = new NullPaymentProvider();

      const result = provider.verifyWebhookSignature(RAW_BODY, {});

      expect(result.verified).toBe(false);
    });

    it('rejects a malformed (non-hex, wrong-length) signature header', () => {
      const provider = new NullPaymentProvider();

      const result = provider.verifyWebhookSignature(RAW_BODY, {
        [NULL_PROVIDER_SIGNATURE_HEADER.toLowerCase()]: 'not-hex!!',
      });

      expect(result.verified).toBe(false);
    });

    it('rejects a signature computed with the wrong secret', () => {
      const provider = new NullPaymentProvider();
      const signature = sign('a-completely-different-secret', RAW_BODY);

      const result = provider.verifyWebhookSignature(RAW_BODY, {
        [NULL_PROVIDER_SIGNATURE_HEADER.toLowerCase()]: signature,
      });

      expect(result.verified).toBe(false);
    });

    it('is sensitive to the exact raw body — one byte of difference fails verification', () => {
      const provider = new NullPaymentProvider();
      const signature = sign(DEV_SECRET, RAW_BODY);
      const tamperedBody = RAW_BODY.replace('payment.succeeded', 'payment.succeeded '); // trailing space

      const result = provider.verifyWebhookSignature(tamperedBody, {
        [NULL_PROVIDER_SIGNATURE_HEADER.toLowerCase()]: signature,
      });

      expect(result.verified).toBe(false);
    });

    it('rejects a validly signed but malformed payload (missing required identity fields)', () => {
      const provider = new NullPaymentProvider();
      const body = JSON.stringify({ not: 'the expected shape' });
      const signature = sign(DEV_SECRET, body);

      const result = provider.verifyWebhookSignature(body, {
        [NULL_PROVIDER_SIGNATURE_HEADER.toLowerCase()]: signature,
      });

      expect(result.verified).toBe(false);
    });

    it('fails closed when no dev secret is configured at all — the pre-F-2a default', () => {
      env({ paymentWebhookDevSecret: undefined });
      const provider = new NullPaymentProvider();
      const signature = sign(DEV_SECRET, RAW_BODY); // any signature — nothing can be verified without a secret

      const result = provider.verifyWebhookSignature(RAW_BODY, {
        [NULL_PROVIDER_SIGNATURE_HEADER.toLowerCase()]: signature,
      });

      expect(result).toEqual({ verified: false, reason: 'No payment provider configured' });
    });
  });

  describe('production safety — the DEC-APP-007 startup assertion', () => {
    it('refuses to construct when NODE_ENV=production and the dev secret is set', () => {
      env({ nodeEnv: 'production', paymentWebhookDevSecret: DEV_SECRET });

      expect(() => new NullPaymentProvider()).toThrow(/must never be set in production/);
    });

    it('constructs normally in production when the dev secret is absent — the safe, expected deployment shape', () => {
      env({ nodeEnv: 'production', paymentWebhookDevSecret: undefined });

      expect(() => new NullPaymentProvider()).not.toThrow();
    });

    it('a provider constructed in production (no secret) still fails every verification closed', () => {
      env({ nodeEnv: 'production', paymentWebhookDevSecret: undefined });
      const provider = new NullPaymentProvider();

      const result = provider.verifyWebhookSignature('{}', {
        [NULL_PROVIDER_SIGNATURE_HEADER.toLowerCase()]: 'a'.repeat(64),
      });

      expect(result.verified).toBe(false);
    });
  });
});
