import { ReconciliationCaseService } from './reconciliation-case.service';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { AuthenticatedUser } from '../../common/types';

/**
 * Q-020 Slice 4 — same stub shape as the payments module's own specs: a fake
 * `supabase.admin.from()` that records every filter/payload a statement was
 * built with and returns queued results in call order.
 */

type Result = { data: unknown; error: { message: string; code?: string } | null };

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update';
  eq: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

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
        update(payload: Record<string, unknown>) {
          call.op = 'update';
          call.payload = payload;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.eq[column] = value;
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve(nextResult()),
        returns: () => Promise.resolve(nextResult()),
        then: (resolve: (r: Result) => unknown) => Promise.resolve(nextResult()).then(resolve),
      };

      return builder;
    },
  };

  return { supabase: { admin } as unknown as SupabaseService, calls };
}

const CASE_ID = 'case-1';
const OPERATOR: AuthenticatedUser = {
  id: 'user-operator-1',
  phone: '+66812345678',
  capabilities: { customer: false, merchant: [], rider: null, platformStaff: { staffRole: 'OPERATOR' } },
};

function caseRow(overrides: Partial<{ kind: string; state: string; resolution_note: string | null; assigned_to: string | null }> = {}) {
  return {
    id: CASE_ID,
    kind: overrides.kind ?? 'AMOUNT_MISMATCH',
    state: overrides.state ?? 'OPEN',
    payment_id: 'payment-1',
    order_id: 'order-1',
    payment_event_id: 'event-1',
    assigned_to: overrides.assigned_to ?? null,
    resolution_note: overrides.resolution_note ?? null,
    created_at: '2026-09-09T00:00:00.000Z',
    updated_at: '2026-09-09T00:00:00.000Z',
  };
}

describe('ReconciliationCaseService.listCases', () => {
  it('returns cases newest-first with a reported window, defaulting the limit', async () => {
    const { supabase, calls } = supabaseStub([{ data: [caseRow()], error: null }]);
    const service = new ReconciliationCaseService(supabase);

    const result = await service.listCases({});

    expect(result.cases).toHaveLength(1);
    expect(result.window).toEqual({ limit: 50, returned: 1, openCount: 1 });
    const listCall = calls[0]!;
    expect(listCall.table).toBe('reconciliation_cases');
  });

  it('clamps an out-of-range limit rather than passing it through unbounded', async () => {
    const { supabase } = supabaseStub([{ data: [], error: null }]);
    const service = new ReconciliationCaseService(supabase);

    const result = await service.listCases({ limit: '999999' });

    expect(result.window.limit).toBe(200);
  });

  it('filters by kind when the value is a recognized one', async () => {
    const { supabase, calls } = supabaseStub([{ data: [caseRow({ kind: 'UNMATCHED_EVENT' })], error: null }]);
    const service = new ReconciliationCaseService(supabase);

    await service.listCases({ kind: 'UNMATCHED_EVENT' });

    const listCall = calls[0]!;
    expect(listCall.eq).toMatchObject({ kind: 'UNMATCHED_EVENT' });
  });

  it('rejects an unrecognized kind filter with VALIDATION_FAILED rather than silently returning nothing', async () => {
    const { supabase } = supabaseStub([]);
    const service = new ReconciliationCaseService(supabase);

    await expect(service.listCases({ kind: 'REFUND_AMOUNT_MISMATCH' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('rejects an unrecognized state filter the same way', async () => {
    const { supabase } = supabaseStub([]);
    const service = new ReconciliationCaseService(supabase);

    await expect(service.listCases({ state: 'ESCALATED' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('counts only OPEN/IN_PROGRESS rows as openCount, never RESOLVED/CLOSED', async () => {
    const { supabase } = supabaseStub([
      {
        data: [
          caseRow({ state: 'OPEN' }),
          caseRow({ state: 'IN_PROGRESS' }),
          caseRow({ state: 'RESOLVED' }),
          caseRow({ state: 'CLOSED' }),
        ],
        error: null,
      },
    ]);
    const service = new ReconciliationCaseService(supabase);

    const result = await service.listCases({});

    expect(result.window.openCount).toBe(2);
  });

  it('never exposes a Stripe secret, webhook secret, or raw provider payload — the projection has no such field', async () => {
    const { supabase } = supabaseStub([{ data: [caseRow()], error: null }]);
    const service = new ReconciliationCaseService(supabase);

    const result = await service.listCases({});

    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/stripe/i);
    expect(serialized).not.toMatch(/raw_payload/i);
    expect(serialized).not.toMatch(/secret/i);
  });
});

describe('ReconciliationCaseService.getCase', () => {
  it('returns the case by id', async () => {
    const { supabase } = supabaseStub([{ data: caseRow(), error: null }]);
    const service = new ReconciliationCaseService(supabase);

    const result = await service.getCase(CASE_ID);

    expect(result.case.id).toBe(CASE_ID);
  });

  it('throws NOT_FOUND for an unknown id', async () => {
    const { supabase } = supabaseStub([{ data: null, error: null }]);
    const service = new ReconciliationCaseService(supabase);

    await expect(service.getCase('unknown')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('ReconciliationCaseService.resolveCase — manual intervention, advisory metadata only', () => {
  it('writes state/resolutionNote/assignedTo and returns the updated case', async () => {
    const { supabase, calls } = supabaseStub([
      { data: caseRow({ state: 'OPEN' }), error: null }, // loadCase
      { data: caseRow({ state: 'RESOLVED', resolution_note: 'confirmed via Stripe dashboard', assigned_to: OPERATOR.id }), error: null }, // update
    ]);
    const service = new ReconciliationCaseService(supabase);

    const result = await service.resolveCase(
      CASE_ID,
      { state: 'RESOLVED', resolutionNote: 'confirmed via Stripe dashboard' },
      OPERATOR,
    );

    expect(result.case.state).toBe('RESOLVED');
    expect(result.case.resolutionNote).toBe('confirmed via Stripe dashboard');
    const updateCall = calls.find((c) => c.op === 'update')!;
    expect(updateCall.payload).toEqual({
      state: 'RESOLVED',
      resolution_note: 'confirmed via Stripe dashboard',
      assigned_to: OPERATOR.id,
    });
  });

  it('throws NOT_FOUND rather than writing anything when the case does not exist', async () => {
    const { supabase, calls } = supabaseStub([{ data: null, error: null }]);
    const service = new ReconciliationCaseService(supabase);

    await expect(
      service.resolveCase(CASE_ID, { state: 'RESOLVED', resolutionNote: 'x' }, OPERATOR),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('never writes to refunds, payments, orders, or a ledger table — advisory metadata only, never a financial mutation', async () => {
    const { supabase, calls } = supabaseStub([
      { data: caseRow(), error: null },
      { data: caseRow({ state: 'RESOLVED' }), error: null },
    ]);
    const service = new ReconciliationCaseService(supabase);

    await service.resolveCase(CASE_ID, { state: 'RESOLVED', resolutionNote: 'x' }, OPERATOR);

    const financialTables = ['refunds', 'payments', 'orders', 'ledger_entry_groups', 'ledger_entries'];
    expect(calls.every((c) => !financialTables.includes(c.table))).toBe(true);
  });

  it('a case remains RESOLVED when re-fetched and nothing has changed since', async () => {
    const { supabase } = supabaseStub([{ data: caseRow({ state: 'RESOLVED', resolution_note: 'done' }), error: null }]);
    const service = new ReconciliationCaseService(supabase);

    const result = await service.getCase(CASE_ID);

    expect(result.case.state).toBe('RESOLVED');
  });

  it('an unresolved case stays OPEN when re-fetched and no resolve call has been made', async () => {
    const { supabase } = supabaseStub([{ data: caseRow({ state: 'OPEN' }), error: null }]);
    const service = new ReconciliationCaseService(supabase);

    const result = await service.getCase(CASE_ID);

    expect(result.case.state).toBe('OPEN');
  });
});
