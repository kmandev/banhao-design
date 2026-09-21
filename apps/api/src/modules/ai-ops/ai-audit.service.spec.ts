import { AiAuditService } from './ai-audit.service';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * DEC-065 §1 — conflict-safe audit writes.
 *
 * The database half (the partial unique index itself, and the two-real-
 * connection race that proves it holds) lives in
 * `supabase/tests/ai_ops_audit_dedup_test.sql` and its concurrency
 * assertions, run by `run-domain-tests.sh` against real PostgreSQL. This file
 * proves the service half: that a `23505` from that index is treated as the
 * designed outcome rather than a failure, that every other error still
 * reports as a failure, and that the write payload — including DEC-040 §8's
 * `actor_type = 'AI'` — did not change.
 *
 * Same fake-Supabase shape as `ai-ops.spec.ts`.
 */

type Result = { data: unknown; error: { message: string; code?: string } | null };

interface Recorded {
  table: string;
  op: 'select' | 'insert';
  eq: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

const ORDER_ID = 'b5000000-0000-4000-8000-000000000001';
const ACTION = 'AI_OPS_MERCHANT_ACCEPTANCE_TIMEOUT';

function supabaseStub(results: Result[]) {
  const calls: Recorded[] = [];
  let index = 0;
  const nextResult = (): Result => results[index++] ?? { data: null, error: null };

  const admin = {
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
        limit: () => builder,
        returns: () => Promise.resolve(nextResult()),
        then: (resolve: (r: Result) => unknown) => Promise.resolve(nextResult()).then(resolve),
      };

      return builder;
    },
  };

  return { service: { admin } as unknown as SupabaseService, calls };
}

const uniqueViolation = {
  code: '23505',
  message:
    'duplicate key value violates unique constraint "audit_logs_ai_action_entity_key"',
};

/** Index access under `noUncheckedIndexedAccess`, failing the test rather than asserting non-null. */
function first<T>(items: readonly T[], what: string): T {
  const item = items[0];
  if (item === undefined) {
    throw new Error(`expected at least one ${what}, got none`);
  }
  return item;
}

function firstLogMessage(spy: jest.SpyInstance): string {
  return String(first(spy.mock.calls, 'log call')[0]);
}

describe('AiAuditService — DEC-065 §1 conflict-safe audit writes', () => {
  it('writes the row, with actor_type AI and actor_id null, when no conflict occurs', async () => {
    const { service, calls } = supabaseStub([{ data: null, error: null }]);
    const audit = new AiAuditService(service);
    const error = jest.spyOn(audit['logger'], 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(audit['logger'], 'warn').mockImplementation(() => undefined);

    await audit.recordAction({
      action: ACTION,
      entityId: ORDER_ID,
      reason: 'fixture',
      after: { command: 'NOTIFY' },
    });

    expect(calls).toHaveLength(1);
    const insertCall = first(calls, 'recorded call');
    expect(insertCall.table).toBe('audit_logs');
    expect(insertCall.op).toBe('insert');
    // DEC-040 §8 / AI-01 — unchanged by this work.
    expect(insertCall.payload).toMatchObject({
      actor_type: 'AI',
      actor_id: null,
      action: ACTION,
      entity_id: ORDER_ID,
      entity_type: 'order',
      source: 'worker',
    });
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('treats a 23505 against the dedup index as the designed outcome, not a failure', async () => {
    const { service } = supabaseStub([{ data: null, error: uniqueViolation }]);
    const audit = new AiAuditService(service);
    const error = jest.spyOn(audit['logger'], 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(audit['logger'], 'warn').mockImplementation(() => undefined);

    await expect(
      audit.recordAction({ action: ACTION, entityId: ORDER_ID, reason: 'fixture', after: {} }),
    ).resolves.toBeUndefined();

    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(firstLogMessage(warn)).toContain('dedupe held');
  });

  it('recognises a duplicate-key conflict reported without a code', async () => {
    const { service } = supabaseStub([
      { data: null, error: { message: 'duplicate key value violates unique constraint' } },
    ]);
    const audit = new AiAuditService(service);
    const error = jest.spyOn(audit['logger'], 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(audit['logger'], 'warn').mockImplementation(() => undefined);

    await audit.recordAction({ action: ACTION, entityId: ORDER_ID, reason: 'fixture', after: {} });

    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('still reports any other write failure as an error, and still never throws', async () => {
    const { service } = supabaseStub([
      { data: null, error: { code: '08006', message: 'connection failure' } },
    ]);
    const audit = new AiAuditService(service);
    const error = jest.spyOn(audit['logger'], 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(audit['logger'], 'warn').mockImplementation(() => undefined);

    await expect(
      audit.recordAction({ action: ACTION, entityId: ORDER_ID, reason: 'fixture', after: {} }),
    ).resolves.toBeUndefined();

    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(firstLogMessage(error)).toContain('audit_logs write failed');
  });

  it('applies the same conflict handling to an escalation write', async () => {
    const { service, calls } = supabaseStub([{ data: null, error: uniqueViolation }]);
    const audit = new AiAuditService(service);
    const error = jest.spyOn(audit['logger'], 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(audit['logger'], 'warn').mockImplementation(() => undefined);

    await audit.recordEscalation({
      action: ACTION,
      entityId: ORDER_ID,
      escalation: 'ESC-UNKNOWN',
      reason: 'fixture',
    });

    expect(first(calls, 'recorded call').op).toBe('insert');
    expect(error).not.toHaveBeenCalled();
    // One warn for the escalation itself, one for the dedupe.
    expect(warn.mock.calls.some((call) => String(call[0]).includes('dedupe held'))).toBe(true);
  });

  it('leaves alreadyHandled() unchanged: still a (action, entity_id) read that fails closed', async () => {
    const { service, calls } = supabaseStub([{ data: [], error: null }]);
    const audit = new AiAuditService(service);

    await expect(audit.alreadyHandled(ACTION, ORDER_ID)).resolves.toBe(false);
    const readCall = first(calls, 'recorded call');
    expect(readCall.table).toBe('audit_logs');
    expect(readCall.op).toBe('select');
    expect(readCall.eq).toEqual({ action: ACTION, entity_id: ORDER_ID });

    const failing = supabaseStub([{ data: null, error: { message: 'read failed' } }]);
    const failingAudit = new AiAuditService(failing.service);
    jest.spyOn(failingAudit['logger'], 'error').mockImplementation(() => undefined);

    await expect(failingAudit.alreadyHandled(ACTION, ORDER_ID)).resolves.toBe(true);
  });
});
