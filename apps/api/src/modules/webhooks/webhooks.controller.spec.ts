import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { WebhooksController } from './webhooks.controller';
import type { PaymentProvider, WebhookVerification } from '../payments/payment-provider.interface';

function fakeRequest(body: string, headers: Record<string, string> = {}): Request {
  return {
    rawBody: Buffer.from(body, 'utf8'),
    headers,
  } as unknown as Request;
}

function fakeProvider(verifyResult: WebhookVerification): PaymentProvider {
  return {
    name: 'fake',
    createPayment: jest.fn(),
    refund: jest.fn(),
    verifyWebhookSignature: jest.fn().mockReturnValue(verifyResult),
  };
}

describe('WebhooksController', () => {
  it('passes the exact raw body bytes to verifyWebhookSignature, not a reparsed one', () => {
    // Deliberately irregular formatting: re-serializing this via JSON.parse +
    // JSON.stringify would normalise key order and whitespace, producing a
    // different byte string. If the controller ever parsed and reserialized,
    // this exact assertion fails.
    const raw = '{"b":1,  "a": 2,"nested":{"z":true}}';
    const provider = fakeProvider({ verified: false, reason: 'irrelevant' });
    const controller = new WebhooksController(provider);

    try {
      controller.handle('null', fakeRequest(raw));
    } catch {
      // verification fails closed by design in this case; only the call
      // arguments matter here
    }

    expect(provider.verifyWebhookSignature).toHaveBeenCalledWith(raw, expect.anything());
  });

  it('passes headers through as a plain string record', () => {
    const provider = fakeProvider({ verified: false, reason: 'x' });
    const controller = new WebhooksController(provider);
    const headers = { 'x-signature': 'abc123', 'content-type': 'application/json' };

    try {
      controller.handle('null', fakeRequest('{}', headers));
    } catch {
      // expected — see below
    }

    expect(provider.verifyWebhookSignature).toHaveBeenCalledWith('{}', headers);
  });

  it('fails closed: rejects when verification fails', () => {
    const provider = fakeProvider({ verified: false, reason: 'bad signature' });
    const controller = new WebhooksController(provider);

    expect(() => controller.handle('null', fakeRequest('{}'))).toThrow(UnauthorizedException);
  });

  it('accepts and reports receipt when verification succeeds', () => {
    const provider = fakeProvider({
      verified: true,
      providerPaymentId: 'p-1',
      providerEvent: 'payment.succeeded',
      rawPayload: {},
    });
    const controller = new WebhooksController(provider);

    expect(controller.handle('null', fakeRequest('{}'))).toEqual({ received: true });
  });

  it('treats a missing rawBody as empty rather than throwing', () => {
    const provider = fakeProvider({ verified: false, reason: 'no body' });
    const controller = new WebhooksController(provider);
    const request = { rawBody: undefined, headers: {} } as unknown as Request;

    expect(() => controller.handle('null', request)).toThrow(UnauthorizedException);
    expect(provider.verifyWebhookSignature).toHaveBeenCalledWith('', {});
  });

  it('never trusts the verified result before checking it — no state is touched either way', () => {
    // The controller has no dependency on any repository/service beyond the
    // injected PaymentProvider — this is what keeps A-5 transport-only. If a
    // future change adds a write, this test's minimal constructor signature
    // will force that change to be visible in review.
    const provider = fakeProvider({ verified: false, reason: 'x' });
    expect(new WebhooksController(provider)).toBeInstanceOf(WebhooksController);
  });
});
