import { NotImplementedException } from '@nestjs/common';
import { NullPaymentProvider } from './providers/null-payment.provider';

/**
 * The null provider must fail loudly. A placeholder that silently "succeeded"
 * could let money-related code paths look correct in development and ship
 * untested — see AGENTS.md.
 */
describe('NullPaymentProvider', () => {
  const provider = new NullPaymentProvider();

  it('refuses to create a payment while no provider is configured', async () => {
    await expect(
      provider.createPayment({
        idempotencyKey: 'key-1',
        orderId: 'order-1',
        amount: { amount: 13000, currency: 'THB' },
        method: 'PROMPTPAY_QR',
        webhookUrl: 'https://example.test/webhook',
      }),
    ).rejects.toThrow(NotImplementedException);
  });

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

  it('fails webhook verification closed, never reporting verified: true', () => {
    const result = provider.verifyWebhookSignature('{}', {});

    expect(result.verified).toBe(false);
  });
});
