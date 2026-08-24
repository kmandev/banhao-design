import { InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { WebhooksController } from './webhooks.controller';
import type { PaymentProvider, WebhookVerification } from '../payments/payment-provider.interface';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * Phase-1 webhook ingest — F-2a extends the A-5 transport shell to persist
 * `payment_events`. `PaymentProvider` stays a plain stub (its own logic is
 * `payments.spec.ts`'s job); this file proves the controller's own
 * responsibilities: verify-before-persist, exactly-once persistence, and
 * that a duplicate delivery never writes a second row.
 */

type Result = { data: unknown; error: { message: string; code?: string } | null };

interface Recorded {
  op: 'select' | 'insert';
  eq: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

function supabaseStub(results: Result[]) {
  const calls: Recorded[] = [];
  let index = 0;

  const nextResult = (): Result => results[index++] ?? { data: null, error: null };

  const admin = {
    from(_table: string) {
      const call: Recorded = { op: 'select', eq: {} };
      calls.push(call);

      const builder: Record<string, unknown> = {
        select: () => builder,
        insert(payload: Record<string, unknown>) {
          call.op = 'insert';
          call.payload = payload;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.eq[column] = value;
          return builder;
        },
        maybeSingle: () => Promise.resolve(nextResult()),
        then: (resolve: (r: Result) => unknown) => Promise.resolve(nextResult()).then(resolve),
      };

      return builder;
    },
  };

  return { supabase: { admin } as unknown as SupabaseService, calls };
}

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

const VERIFIED: Extract<WebhookVerification, { verified: true }> = {
  verified: true,
  providerPaymentId: 'NULL-payment-1',
  providerEventId: 'NULL-EVT-1',
  providerEvent: 'payment.succeeded',
  rawPayload: { simulated: true, providerEventId: 'NULL-EVT-1' },
};

describe('WebhooksController — signature verification', () => {
  it('passes the exact raw body bytes to verifyWebhookSignature, not a reparsed one', async () => {
    // Deliberately irregular formatting: re-serializing this via JSON.parse +
    // JSON.stringify would normalise key order and whitespace, producing a
    // different byte string. If the controller ever parsed and reserialized,
    // this exact assertion fails.
    const raw = '{"b":1,  "a": 2,"nested":{"z":true}}';
    const provider = fakeProvider({ verified: false, reason: 'irrelevant' });
    const { supabase } = supabaseStub([]);
    const controller = new WebhooksController(provider, supabase);

    await expect(controller.handle('null', fakeRequest(raw))).rejects.toThrow(UnauthorizedException);

    expect(provider.verifyWebhookSignature).toHaveBeenCalledWith(raw, expect.anything());
  });

  it('passes headers through as a plain string record', async () => {
    const provider = fakeProvider({ verified: false, reason: 'x' });
    const { supabase } = supabaseStub([]);
    const controller = new WebhooksController(provider, supabase);
    const headers = { 'x-signature': 'abc123', 'content-type': 'application/json' };

    await expect(controller.handle('null', fakeRequest('{}', headers))).rejects.toThrow();

    expect(provider.verifyWebhookSignature).toHaveBeenCalledWith('{}', headers);
  });

  it('fails closed: rejects when verification fails, and persists nothing', async () => {
    const provider = fakeProvider({ verified: false, reason: 'bad signature' });
    const { supabase, calls } = supabaseStub([]);
    const controller = new WebhooksController(provider, supabase);

    await expect(controller.handle('null', fakeRequest('{}'))).rejects.toThrow(UnauthorizedException);
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  it('treats a missing rawBody as empty rather than throwing a different error', async () => {
    const provider = fakeProvider({ verified: false, reason: 'no body' });
    const { supabase } = supabaseStub([]);
    const controller = new WebhooksController(provider, supabase);
    const request = { rawBody: undefined, headers: {} } as unknown as Request;

    await expect(controller.handle('null', request)).rejects.toThrow(UnauthorizedException);
    expect(provider.verifyWebhookSignature).toHaveBeenCalledWith('', {});
  });
});

describe('WebhooksController — payment_events persistence (F-2a)', () => {
  it('accepts, persists exactly one payment_events row, and reports receipt when verification succeeds', async () => {
    const provider = fakeProvider(VERIFIED);
    const { supabase, calls } = supabaseStub([{ data: null, error: null }]);
    const controller = new WebhooksController(provider, supabase);

    await expect(controller.handle('null', fakeRequest('{}'))).resolves.toEqual({ received: true });

    const inserts = calls.filter((c) => c.op === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.payload).toMatchObject({
      provider: 'null',
      provider_event_id: VERIFIED.providerEventId,
      event_type: VERIFIED.providerEvent,
      signature_verified: true,
      raw_payload: VERIFIED.rawPayload,
    });
  });

  it('a duplicate provider_event_id (23505) reads back the existing row, returns 200, and never inserts a second row', async () => {
    const provider = fakeProvider(VERIFIED);
    const { supabase, calls } = supabaseStub([
      { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } },
      { data: { id: 'event-1' }, error: null }, // read-back
    ]);
    const controller = new WebhooksController(provider, supabase);

    await expect(controller.handle('null', fakeRequest('{}'))).resolves.toEqual({ received: true });

    const inserts = calls.filter((c) => c.op === 'insert');
    expect(inserts).toHaveLength(1); // the one attempt, which conflicted — no retry insert
    const readBack = calls.find((c) => c.op === 'select');
    expect(readBack?.eq).toMatchObject({ provider: 'null', provider_event_id: VERIFIED.providerEventId });
  });

  it('two concurrent deliveries of the same event: the loser also reports 200, having inserted nothing', async () => {
    // Simulates two requests racing on the same (provider, provider_event_id):
    // this call is the "loser" — its own INSERT hits the constraint the
    // winner already satisfied. The unique constraint is the sole
    // concurrency authority; nothing here checks first.
    const provider = fakeProvider(VERIFIED);
    const { supabase, calls } = supabaseStub([
      { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } },
      { data: { id: 'event-1' }, error: null },
    ]);
    const controller = new WebhooksController(provider, supabase);

    const result = await controller.handle('null', fakeRequest('{}'));

    expect(result).toEqual({ received: true });
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(1);
  });

  it('a non-duplicate database error surfaces as 500, so a real provider retries', async () => {
    const provider = fakeProvider(VERIFIED);
    const { supabase } = supabaseStub([{ data: null, error: { message: 'connection reset' } }]);
    const controller = new WebhooksController(provider, supabase);

    await expect(controller.handle('null', fakeRequest('{}'))).rejects.toThrow(InternalServerErrorException);
  });

  it('makes exactly one Supabase call — the payment_events insert, nothing else', async () => {
    // Phase 1 is ingest-only (ADR-008): no read or write against orders,
    // payments, payment_attempts, payment_transactions, or any ledger table.
    // A second recorded call here would mean this controller reached beyond
    // that boundary.
    const provider = fakeProvider(VERIFIED);
    const { supabase, calls } = supabaseStub([{ data: null, error: null }]);
    const controller = new WebhooksController(provider, supabase);

    await controller.handle('null', fakeRequest('{}'));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.op).toBe('insert');
  });
});
