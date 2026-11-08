import { ApiClientError, type ApiClient } from '@banhao/api-client';
import { createApiPaymentRepository } from './apiPayments';
import { PaymentStartError } from './types';

function stubClient(impl: () => Promise<unknown>) {
  const request = jest.fn().mockImplementation(impl);
  return { client: { request } as unknown as ApiClient, request };
}

const RESPONSE = {
  paymentId: 'pay-1',
  paymentReference: 'ref-1',
  state: 'PENDING',
  amountSatang: 19900,
  currency: 'THB',
  qr: { type: 'QR_CODE', imageUrl: 'https://stripe.example/qr.png', expiresAt: '2026-11-08T08:20:00Z' },
};

describe('apiPayments.startPayment', () => {
  it('POSTs /api/v1/orders/:id/payment with an empty body — no amount, no method', async () => {
    const { client, request } = stubClient(async () => RESPONSE);

    await createApiPaymentRepository(client).startPayment('o1');

    expect(request).toHaveBeenCalledWith('/api/v1/orders/o1/payment', { method: 'POST', body: '{}' });
  });

  it("returns the server's amount and the provider's QR unchanged", async () => {
    const { client } = stubClient(async () => RESPONSE);

    await expect(createApiPaymentRepository(client).startPayment('o1')).resolves.toEqual({
      paymentId: 'pay-1',
      amountSatang: 19900,
      qrImageUrl: 'https://stripe.example/qr.png',
      expiresAt: '2026-11-08T08:20:00Z',
    });
  });

  it('returns null QR fields when the provider gave no presentation', async () => {
    const { client } = stubClient(async () => ({ ...RESPONSE, qr: undefined }));

    await expect(createApiPaymentRepository(client).startPayment('o1')).resolves.toMatchObject({
      qrImageUrl: null,
      expiresAt: null,
    });
  });

  it.each([
    ['CUSTOMER_EMAIL_REQUIRED', 'EMAIL_REQUIRED'],
    ['ORDER_NOT_PAYABLE', 'NOT_PAYABLE'],
    ['PAYMENT_ALREADY_SUCCEEDED', 'ALREADY_PAID'],
  ])('maps %s to the %s refusal', async (code, refusal) => {
    const { client } = stubClient(async () => {
      throw new ApiClientError(409, { code: code as ConstructorParameters<typeof ApiClientError>[1]['code'] });
    });

    const promise = createApiPaymentRepository(client).startPayment('o1');
    await expect(promise).rejects.toBeInstanceOf(PaymentStartError);
    await expect(promise).rejects.toMatchObject({ refusal, message: refusal });
  });

  it('rethrows anything else unchanged, so an outage is never read as a refusal', async () => {
    const outage = new ApiClientError(503, { code: 'PROVIDER_UNAVAILABLE' });
    const { client } = stubClient(async () => {
      throw outage;
    });

    await expect(createApiPaymentRepository(client).startPayment('o1')).rejects.toBe(outage);
  });
});

describe('apiPayments.getPaymentSummary', () => {
  it('GETs /api/v1/orders/:id/payment and returns the summary unchanged', async () => {
    const summary = { orderNumber: 'BH-1', payment: null, refund: null };
    const { client, request } = stubClient(async () => summary);

    await expect(createApiPaymentRepository(client).getPaymentSummary('o1')).resolves.toEqual(summary);
    expect(request).toHaveBeenCalledWith('/api/v1/orders/o1/payment', { method: 'GET' });
  });
});
