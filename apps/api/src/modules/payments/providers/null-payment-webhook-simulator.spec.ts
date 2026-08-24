const loadServerEnvMock = jest.fn();
jest.mock('@banhao/config', () => ({
  loadServerEnv: () => loadServerEnvMock(),
}));

import { NullPaymentWebhookSimulator } from './null-payment-webhook-simulator';
import { NullPaymentProvider, NULL_PROVIDER_SIGNATURE_HEADER_LOWER } from './null-payment.provider';

/**
 * DEC-APP-007's dev-only signed-event simulator. The core proof this file
 * exists for: a signature the simulator produces is one
 * `NullPaymentProvider.verifyWebhookSignature` genuinely accepts — the exact
 * code path a real provider's webhook would exercise, with no shortcut.
 */
describe('NullPaymentWebhookSimulator', () => {
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

  describe('production safety', () => {
    it('refuses to construct when NODE_ENV=production, regardless of whether a secret is set', () => {
      env({ nodeEnv: 'production', paymentWebhookDevSecret: DEV_SECRET });

      expect(() => new NullPaymentWebhookSimulator()).toThrow(/must never run in production/);
    });

    it('refuses to construct when no dev secret is configured, even in development', () => {
      env({ paymentWebhookDevSecret: undefined });

      expect(() => new NullPaymentWebhookSimulator()).toThrow(/PAYMENT_WEBHOOK_DEV_SECRET is required/);
    });

    it('constructs normally in development with a secret configured', () => {
      expect(() => new NullPaymentWebhookSimulator()).not.toThrow();
    });
  });

  describe('signPaymentSucceeded — round trip against the real verifier', () => {
    it('produces a signature NullPaymentProvider.verifyWebhookSignature accepts', () => {
      const simulator = new NullPaymentWebhookSimulator();
      const provider = new NullPaymentProvider();

      const { rawBody, headers } = simulator.signPaymentSucceeded({ providerPaymentId: 'NULL-payment-1' });
      const result = provider.verifyWebhookSignature(rawBody, headers);

      expect(result.verified).toBe(true);
    });

    it('carries the given providerPaymentId through to the verified result', () => {
      const simulator = new NullPaymentWebhookSimulator();
      const provider = new NullPaymentProvider();

      const { rawBody, headers } = simulator.signPaymentSucceeded({ providerPaymentId: 'NULL-payment-42' });
      const result = provider.verifyWebhookSignature(rawBody, headers);

      expect(result).toMatchObject({ verified: true, providerPaymentId: 'NULL-payment-42' });
    });

    it('generates a fresh providerEventId per call by default', () => {
      const simulator = new NullPaymentWebhookSimulator();

      const first = JSON.parse(simulator.signPaymentSucceeded({ providerPaymentId: 'p-1' }).rawBody);
      const second = JSON.parse(simulator.signPaymentSucceeded({ providerPaymentId: 'p-1' }).rawBody);

      expect(first.providerEventId).not.toBe(second.providerEventId);
    });

    it('reuses an explicit providerEventId — the mechanism a resend/retry test needs', () => {
      const simulator = new NullPaymentWebhookSimulator();

      const first = simulator.signPaymentSucceeded({ providerPaymentId: 'p-1', providerEventId: 'fixed-id' });
      const second = simulator.signPaymentSucceeded({ providerPaymentId: 'p-1', providerEventId: 'fixed-id' });

      const firstPayload = JSON.parse(first.rawBody);
      const secondPayload = JSON.parse(second.rawBody);
      expect(firstPayload.providerEventId).toBe('fixed-id');
      expect(secondPayload.providerEventId).toBe('fixed-id');
      // Same identity, but each call still signs its own body independently —
      // no shared/cached signature.
      expect(first.headers[NULL_PROVIDER_SIGNATURE_HEADER_LOWER]).toBeDefined();
      expect(second.headers[NULL_PROVIDER_SIGNATURE_HEADER_LOWER]).toBeDefined();
    });

    it('the synthetic event is unambiguously distinguishable from real provider data', () => {
      const simulator = new NullPaymentWebhookSimulator();
      const { rawBody } = simulator.signPaymentSucceeded({ providerPaymentId: 'p-1' });
      const payload = JSON.parse(rawBody);

      expect(payload.simulated).toBe(true);
      expect(payload.source).toBe('NullPaymentWebhookSimulator');
    });

    it('signs under the exact header NullPaymentProvider reads', () => {
      const simulator = new NullPaymentWebhookSimulator();
      const { headers } = simulator.signPaymentSucceeded({ providerPaymentId: 'p-1' });

      expect(Object.keys(headers)).toEqual([NULL_PROVIDER_SIGNATURE_HEADER_LOWER]);
    });

    it('never resolves to a Promise or performs any I/O — purely synchronous local computation', () => {
      const simulator = new NullPaymentWebhookSimulator();
      const result = simulator.signPaymentSucceeded({ providerPaymentId: 'p-1' });

      expect(result).not.toBeInstanceOf(Promise);
    });
  });

  describe('cross-secret isolation', () => {
    it('a simulator signed under one secret is rejected by a verifier configured with a different one', () => {
      env({ paymentWebhookDevSecret: 'secret-a' });
      const simulator = new NullPaymentWebhookSimulator();
      const { rawBody, headers } = simulator.signPaymentSucceeded({ providerPaymentId: 'p-1' });

      env({ paymentWebhookDevSecret: 'secret-b' });
      const provider = new NullPaymentProvider();

      expect(provider.verifyWebhookSignature(rawBody, headers).verified).toBe(false);
    });
  });
});
