import { Logger } from '@nestjs/common';
import {
  CANCELLED_PAID_ORDER_ACTION,
  CancelledPaidOrderEscalationService,
} from './cancelled-paid-order-escalation.service';
import { AiAuditService } from './ai-audit.service';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * DEC-050 / DEC-058 — the escalation for an order cancelled after payment with
 * no refund started. Same stub shape as `ai-ops.spec.ts`: queued results in
 * call order, every filter and payload recorded.
 */

type Result = { data: unknown; error: { message: string } | null };

interface Recorded {
  table: string;
  op: 'select' | 'insert';
  payload?: Record<string, unknown>;
  eq: Record<string, unknown>;
}

function build(results: Result[]) {
  const calls: Recorded[] = [];
  let index = 0;
  const next = (): Result => results[index++] ?? { data: null, error: null };

  const supabase = {
    admin: {
      from(table: string) {
        const call: Recorded = { table, op: 'select', eq: {} };
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
          order: () => builder,
          limit: () => builder,
          maybeSingle: () => Promise.resolve(next()),
          returns: () => Promise.resolve(next()),
          then: (resolve: (r: Result) => unknown) => Promise.resolve(next()).then(resolve),
        };
        return builder;
      },
    },
  } as unknown as SupabaseService;

  const service = new CancelledPaidOrderEscalationService(supabase, new AiAuditService(supabase));
  return { service, calls };
}

const PAYMENT = { id: 'payment-1', order_id: 'order-1' };
const NO_ROWS: Result = { data: [], error: null };
const ONE_ROW: Result = { data: [{ id: 'x' }], error: null };
const NO_ERROR: Result = { data: null, error: null };

const audits = (calls: Recorded[]) => calls.filter((c) => c.table === 'audit_logs' && c.op === 'insert');

describe('CancelledPaidOrderEscalationService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('reads only SUCCESS payments whose order is CANCELLED', async () => {
    const { service, calls } = build([NO_ROWS]);

    await service.run();

    expect(calls[0]?.table).toBe('payments');
    expect(calls[0]?.eq).toEqual({ state: 'SUCCESS', 'orders.state': 'CANCELLED' });
  });

  it('escalates a cancelled, paid order with no refund — once, as an AI actor, with no amount', async () => {
    const { service, calls } = build([
      { data: [PAYMENT], error: null }, // candidates
      NO_ROWS, // dedupe: not handled
      NO_ROWS, // refunds: none
      NO_ERROR, // audit insert
    ]);

    const result = await service.run();

    expect(result).toEqual({ examined: 1, acted: 0, escalated: 1, skipped: 0, failed: 0 });
    expect(audits(calls)).toHaveLength(1);
    const row = audits(calls)[0]?.payload as Record<string, unknown>;
    expect(row).toMatchObject({ actor_type: 'AI', action: CANCELLED_PAID_ORDER_ACTION, entity_id: 'order-1' });
    expect(String(row.reason)).toContain('ESC-UNKNOWN');
    expect(String(row.reason)).toContain('DEC-050');
    expect(row.after).toMatchObject({ escalation: 'ESC-UNKNOWN', playbook: 'CANCELLED_PAID_ORDER' });
    // DEC-040 §3: ids and states only — no financial *field*. (The reason text
    // says "no fee" in words; what must be absent is any amount-bearing key.)
    const keys = [...Object.keys(row), ...Object.keys(row.after as Record<string, unknown>)].join(' ').toLowerCase();
    for (const forbidden of ['amount', 'satang', 'total', 'fee', 'price', 'ledger']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('stays quiet once any refund exists for the payment, whatever its state', async () => {
    const { service, calls } = build([{ data: [PAYMENT], error: null }, NO_ROWS, ONE_ROW]);

    const result = await service.run();

    expect(result.skipped).toBe(1);
    expect(result.escalated).toBe(0);
    expect(audits(calls)).toHaveLength(0);
  });

  it('raises the alert once per order — a handled order is skipped', async () => {
    const { service, calls } = build([{ data: [PAYMENT], error: null }, ONE_ROW]);

    const result = await service.run();

    expect(result.skipped).toBe(1);
    expect(audits(calls)).toHaveLength(0);
    // And it never reached the refunds read.
    expect(calls.some((c) => c.table === 'refunds')).toBe(false);
  });

  it('starts no refund and writes nothing but the audit row', async () => {
    const { service, calls } = build([{ data: [PAYMENT], error: null }, NO_ROWS, NO_ROWS, NO_ERROR]);

    await service.run();

    expect(calls.filter((c) => c.op === 'insert').map((c) => c.table)).toEqual(['audit_logs']);
  });

  it('treats a failed refunds read as handled, so a database problem is silence rather than a duplicate alert', async () => {
    const { service, calls } = build([
      { data: [PAYMENT], error: null },
      NO_ROWS,
      { data: null, error: { message: 'connection reset' } },
    ]);

    const result = await service.run();

    expect(result.skipped).toBe(1);
    expect(audits(calls)).toHaveLength(0);
  });

  it('never throws when the candidate read fails', async () => {
    const { service } = build([{ data: null, error: { message: 'connection reset' } }]);

    await expect(service.run()).resolves.toEqual({ examined: 0, acted: 0, escalated: 0, skipped: 0, failed: 1 });
  });
});
