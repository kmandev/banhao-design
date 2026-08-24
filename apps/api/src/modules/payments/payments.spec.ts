import { NotImplementedException } from '@nestjs/common';
import { NullPaymentProvider } from './providers/null-payment.provider';

/**
 * `createPayment` now returns a real (explicitly fake) simulated result —
 * DEC-APP-007, V1.1 § 8: Phases E–I build against `NullPaymentProvider`,
 * which stops refusing every call once a real endpoint needs it. `refund`
 * and `verifyWebhookSignature` are untouched this session (Phase F session 2)
 * and must keep refusing / failing closed exactly as before.
 */
describe('NullPaymentProvider', () => {
  const provider = new NullPaymentProvider();

  const INPUT = {
    idempotencyKey: 'order-1',
    orderId: 'order-1',
    amount: { amount: 7500, currency: 'THB' as const },
    method: 'PROMPTPAY_QR' as const,
    webhookUrl: '/webhooks/payments/null',
  };

  describe('createPayment — simulated, dev-only', () => {
    it('returns a result rather than throwing', async () => {
      await expect(provider.createPayment(INPUT)).resolves.toBeDefined();
    });

    it('mints a providerPaymentId clearly labelled as the null provider, never a bare/opaque id', async () => {
      const result = await provider.createPayment(INPUT);
      expect(result.providerPaymentId).toMatch(/^NULL-/);
    });

    it('returns a QR_STRING presentation with an expiry roughly 10 minutes out', async () => {
      const before = Date.now();
      const result = await provider.createPayment(INPUT);
      const after = Date.now();

      expect(result.presentation?.type).toBe('QR_STRING');
      const expiresAt = new Date(result.presentation!.expiresAt).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(before + 9 * 60 * 1000);
      expect(expiresAt).toBeLessThanOrEqual(after + 11 * 60 * 1000);
    });

    it('the QR value is explicitly labelled NULL, never formatted as a real PromptPay payload', async () => {
      const result = await provider.createPayment(INPUT);
      expect(result.presentation?.value).toMatch(/^NULL-QR:/);
    });

    it('two calls for two different orders produce two different providerPaymentIds — never a fixed fixture value', async () => {
      const first = await provider.createPayment(INPUT);
      const second = await provider.createPayment({ ...INPUT, orderId: 'order-2', idempotencyKey: 'order-2' });
      expect(first.providerPaymentId).not.toBe(second.providerPaymentId);
    });

    it('makes no network call — provider.name identifies it as the null provider, not a real one', () => {
      expect(provider.name).toBe('null');
    });
  });

  describe('refund — unchanged, still refuses (out of scope this session)', () => {
    it('refuses to refund while no provider is configured', async () => {
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

  describe('verifyWebhookSignature — unchanged, still fails closed (out of scope this session)', () => {
    it('fails webhook verification closed, never reporting verified: true', () => {
      const result = provider.verifyWebhookSignature('{}', {});
      expect(result.verified).toBe(false);
    });
  });
});
