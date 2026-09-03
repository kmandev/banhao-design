import { SupervisorCaseService } from './supervisor-case.service';
import { SupervisorController } from './supervisor.controller';
import { blockedByFor, isEscalationRow, type AuditRowForProjection } from './supervisor-case.projection';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * Phase I — the Human Supervisor case projection and its one command.
 *
 * Same fake-Supabase shape as the Phase J specs: a stub recording every table,
 * filter and payload, so a guard can be asserted to be IN the statement rather
 * than checked afterwards in application code.
 *
 * No test uses the protected real order `BH-20260824-0001`. Every id below is
 * a fixture uuid that exists only in this file.
 */

type Result = { data: unknown; error: { message: string; code?: string } | null };

interface Recorded {
  table: string;
  op: 'select' | 'insert';
  eq: Record<string, unknown>;
  in?: { column: string; values: unknown[] };
  like?: { column: string; pattern: string };
  payload?: Record<string, unknown>;
  order?: { column: string; ascending?: boolean };
  limit?: number;
}

const CASE_ID = 'aa100000-0000-4000-8000-000000000001';
const ORDER_ID = 'bb100000-0000-4000-8000-000000000002';
const DELIVERY_ID = 'cc100000-0000-4000-8000-000000000003';
const STAFF_USER_ID = 'dd100000-0000-4000-8000-000000000004';

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
        in(column: string, values: unknown[]) {
          call.in = { column, values };
          return builder;
        },
        like(column: string, pattern: string) {
          call.like = { column, pattern };
          return builder;
        },
        order(column: string, options?: { ascending?: boolean }) {
          call.order = { column, ascending: options?.ascending };
          return builder;
        },
        limit(value: number) {
          call.limit = value;
          return builder;
        },
        maybeSingle: () => Promise.resolve(nextResult()),
        returns: () => Promise.resolve(nextResult()),
        then: (resolve: (r: Result) => unknown) => Promise.resolve(nextResult()).then(resolve),
      };

      return builder;
    },
  };

  return { service: { admin } as unknown as SupabaseService, calls };
}

function buildService(results: Result[]) {
  const { service, calls } = supabaseStub(results);
  return { cases: new SupervisorCaseService(service), calls };
}

const escalationRow = (overrides: Partial<AuditRowForProjection> = {}): AuditRowForProjection => ({
  id: CASE_ID,
  actor_type: 'AI',
  action: 'AI_OPS_NO_RIDER_TRIAGE',
  entity_type: 'delivery',
  entity_id: DELIVERY_ID,
  reason: 'ESC-NORIDER: Delivery has been searching for 1900s across 30 round(s)',
  after: { escalation: 'ESC-NORIDER', roundsBroadcast: 30, ridersEligibleNow: 0 },
  created_at: '2026-09-03T02:00:00.000Z',
  ...overrides,
});

const resolutionRow = (): AuditRowForProjection => ({
  id: 'ee100000-0000-4000-8000-000000000005',
  actor_type: 'OPERATOR',
  action: 'AI_OPS_CASE_RESOLVED',
  entity_type: 'delivery',
  entity_id: DELIVERY_ID,
  reason: 'โทรหาไรเดอร์แล้ว รับงานเรียบร้อย',
  after: { caseId: CASE_ID, outcome: 'RESOLVED', staffRole: 'OPERATOR' },
  created_at: '2026-09-03T02:20:00.000Z',
});

const deliveryRow = () => ({
  id: DELIVERY_ID,
  order_id: ORDER_ID,
  state: 'RIDER_SEARCHING',
  created_at: '2026-09-03T01:30:00.000Z',
  rider_id: null,
});

const staffUser = (staffRole: 'OPERATOR' | 'ADMIN' = 'OPERATOR'): AuthenticatedUser => ({
  id: STAFF_USER_ID,
  phone: '+66812345678',
  capabilities: {
    customer: true,
    merchant: [],
    rider: null,
    platformStaff: { staffRole },
  },
});

describe('Phase I — the case projection', () => {
  it('treats only an AI escalation row as a case', () => {
    expect(isEscalationRow(escalationRow())).toBe(true);
    // An AI row that recorded an action rather than an escalation.
    expect(isEscalationRow(escalationRow({ after: { command: 'notify_merchant' } }))).toBe(false);
    // A human row, including the resolution rows this projection writes.
    expect(isEscalationRow(resolutionRow())).toBe(false);
    // Something else entirely that happens to live in audit_logs.
    expect(isEscalationRow(escalationRow({ actor_type: 'SYSTEM', after: { escalation: 'X' } }))).toBe(
      false,
    );
  });

  it('names the open decision that is why a case carries no command', () => {
    expect(blockedByFor('AI_OPS_NO_RIDER_TRIAGE')).toContain('UX-Q-006');
    expect(blockedByFor('AI_OPS_MERCHANT_ACCEPTANCE_TIMEOUT')).toContain('BQ-013');
    expect(blockedByFor('AI_OPS_SOMETHING_ELSE')).toBeNull();
  });
});

describe('Phase I — the operations inbox (S-02)', () => {
  it('reads AI escalations newest-first and derives state from resolution rows', async () => {
    const { cases, calls } = buildService([
      { data: [escalationRow()], error: null },
      { data: [resolutionRow()], error: null },
    ]);

    const result = await cases.listCases();

    const read = calls.find((c) => c.table === 'audit_logs' && c.op === 'select');
    expect(read?.eq).toMatchObject({ actor_type: 'AI' });
    expect(read?.like).toEqual({ column: 'action', pattern: 'AI_OPS_%' });
    expect(read?.order).toEqual({ column: 'created_at', ascending: false });

    expect(result.cases).toHaveLength(1);
    expect(result.cases[0]).toMatchObject({
      caseId: CASE_ID,
      escalation: 'ESC-NORIDER',
      subjectType: 'delivery',
      subjectId: DELIVERY_ID,
      state: 'RESOLVED',
    });
    expect(result.window).toEqual({ limit: 50, returned: 1, openInWindow: 0, resolvedInWindow: 1 });
  });

  it('leaves a case OPEN when no resolution row names it', async () => {
    const { cases } = buildService([
      { data: [escalationRow()], error: null },
      { data: [], error: null },
    ]);

    const result = await cases.listCases();

    expect(result.cases[0]?.state).toBe('OPEN');
    expect(result.cases[0]?.resolution).toBeNull();
    expect(result.window.openInWindow).toBe(1);
  });

  it('leaves a case OPEN when its resolution row is malformed, rather than hiding it', async () => {
    const malformed = { ...resolutionRow(), reason: null };

    const { cases } = buildService([
      { data: [escalationRow()], error: null },
      { data: [malformed], error: null },
    ]);

    expect((await cases.listCases()).cases[0]?.state).toBe('OPEN');
  });

  it('leaves cases OPEN when the resolution read itself fails', async () => {
    const { cases } = buildService([
      { data: [escalationRow()], error: null },
      { data: null, error: { message: 'audit unavailable' } },
    ]);

    expect((await cases.listCases()).cases[0]?.state).toBe('OPEN');
  });

  it('bounds the page size rather than trusting the caller', async () => {
    const { cases, calls } = buildService([{ data: [], error: null }]);

    await cases.listCases(5000);

    expect(calls[0]?.limit).toBe(100);
  });

  it('drops audit rows that are not escalations', async () => {
    const { cases } = buildService([
      { data: [escalationRow({ after: { command: 'notify_merchant' } })], error: null },
    ]);

    expect((await cases.listCases()).cases).toHaveLength(0);
  });
});

describe('Phase I — case detail (S-03)', () => {
  it('reads live domain state rather than the agent snapshot, and exposes no financial column', async () => {
    const { cases, calls } = buildService([
      { data: escalationRow(), error: null }, // case row
      { data: [], error: null }, // resolutions
      { data: deliveryRow(), error: null }, // subject
      { data: [escalationRow()], error: null }, // timeline audits
    ]);

    const detail = await cases.getCase(CASE_ID);

    expect(detail.subject).toEqual({
      type: 'delivery',
      deliveryId: DELIVERY_ID,
      orderId: ORDER_ID,
      state: 'RIDER_SEARCHING',
      createdAt: '2026-09-03T01:30:00.000Z',
      // Presence only — a rider id never reaches the console.
      hasRider: false,
    });
    expect(JSON.stringify(detail)).not.toContain('rider_id');

    // The state shown came from `deliveries`, not from the escalation payload.
    expect(calls.some((c) => c.table === 'deliveries' && c.eq.id === DELIVERY_ID)).toBe(true);

    expect(detail.evidence).toEqual({ roundsBroadcast: 30, ridersEligibleNow: 0 });
    expect(detail.blockedBy).toContain('UX-Q-006');
    expect(detail.timeline[0]?.source).toBe('audit');
  });

  it('reports an unreadable subject instead of inventing one', async () => {
    const { cases } = buildService([
      { data: escalationRow(), error: null },
      { data: [], error: null },
      { data: null, error: { message: 'gone' } },
      { data: [], error: null },
    ]);

    expect((await cases.getCase(CASE_ID)).subject).toEqual({
      type: 'unavailable',
      detail: 'Delivery could not be read for this case',
    });
  });

  it('refuses an audit row that is not a case, and a malformed id, as NOT_FOUND', async () => {
    const { cases } = buildService([{ data: resolutionRow(), error: null }]);
    await expect(cases.getCase(CASE_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const { cases: other } = buildService([]);
    await expect(other.getCase('not-a-uuid')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('selects no order amount, fee or total for an order-subject case', async () => {
    const { cases, calls } = buildService([
      { data: escalationRow({ entity_type: 'order', entity_id: ORDER_ID, action: 'AI_OPS_MERCHANT_ACCEPTANCE_TIMEOUT' }), error: null },
      { data: [], error: null },
      {
        data: {
          id: ORDER_ID,
          order_number: 'BH-26090301-0001',
          state: 'PAID',
          restaurant_id: 'ff100000-0000-4000-8000-000000000006',
          created_at: '2026-09-03T01:00:00.000Z',
          paid_at: '2026-09-03T01:01:00.000Z',
        },
        error: null,
      },
      { data: [], error: null }, // timeline audits
      { data: [{ from_state: 'PENDING_PAYMENT', to_state: 'PAID', actor_type: 'WEBHOOK', reason: null, occurred_at: '2026-09-03T01:01:00.000Z' }], error: null },
    ]);

    const detail = await cases.getCase(CASE_ID);

    expect(detail.subject).toMatchObject({ type: 'order', state: 'PAID' });
    expect(detail.blockedBy).toContain('BQ-013');
    expect(detail.timeline.some((t) => t.what === 'PENDING_PAYMENT → PAID')).toBe(true);

    const serialised = JSON.stringify(detail);
    for (const forbidden of ['satang', 'grand_total', 'subtotal', 'amount', 'payment_reference']) {
      expect(serialised).not.toContain(forbidden);
    }
    expect(calls.some((c) => c.table === 'payments')).toBe(false);
  });
});

describe('Phase I — resolving a case (S-06)', () => {
  it('writes exactly one append-only audit row with human attribution and the reason', async () => {
    const { cases, calls } = buildService([
      { data: escalationRow(), error: null },
      { data: [], error: null }, // no existing resolution
      { data: null, error: null }, // insert
    ]);

    const result = await cases.resolveCase(
      CASE_ID,
      { outcome: 'RESOLVED', reason: 'โทรหาไรเดอร์แล้ว' },
      staffUser('ADMIN'),
    );

    const inserts = calls.filter((c) => c.op === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.table).toBe('audit_logs');

    const payload = inserts[0]?.payload ?? {};
    // Human attribution: never SYSTEM, never AI.
    expect(payload.actor_type).toBe('OPERATOR');
    expect(payload.actor_id).toBe(STAFF_USER_ID);
    expect(payload.action).toBe('AI_OPS_CASE_RESOLVED');
    expect(payload.entity_type).toBe('delivery');
    expect(payload.entity_id).toBe(DELIVERY_ID);
    expect(payload.reason).toBe('โทรหาไรเดอร์แล้ว');
    // audit_logs.actor_type has no ADMIN value, so the grant held is recorded
    // rather than flattened away.
    expect(payload.after).toMatchObject({ caseId: CASE_ID, outcome: 'RESOLVED', staffRole: 'ADMIN' });

    expect(result).toMatchObject({ caseId: CASE_ID, state: 'RESOLVED' });
  });

  it('mutates no domain table', async () => {
    const { cases, calls } = buildService([
      { data: escalationRow(), error: null },
      { data: [], error: null },
      { data: null, error: null },
    ]);

    await cases.resolveCase(CASE_ID, { outcome: 'NO_ACTION_NEEDED', reason: 'ไม่ต้องทำอะไร' }, staffUser());

    for (const call of calls) {
      if (call.op === 'insert') {
        expect(call.table).toBe('audit_logs');
      }
      expect(['orders', 'deliveries', 'payments', 'ledger_entries', 'refunds']).not.toContain(
        call.op === 'insert' ? call.table : '',
      );
    }
  });

  it('refuses a second resolution rather than recording a competing one', async () => {
    const { cases, calls } = buildService([
      { data: escalationRow(), error: null },
      { data: [resolutionRow()], error: null },
    ]);

    await expect(
      cases.resolveCase(CASE_ID, { outcome: 'RESOLVED', reason: 'again' }, staffUser()),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(calls.some((c) => c.op === 'insert')).toBe(false);
  });

  it('refuses a principal with no platform_staff grant, behind the guard', async () => {
    const { cases, calls } = buildService([]);
    const notStaff: AuthenticatedUser = {
      id: STAFF_USER_ID,
      phone: null,
      capabilities: { customer: true, merchant: [], rider: null, platformStaff: null },
    };

    await expect(
      cases.resolveCase(CASE_ID, { outcome: 'RESOLVED', reason: 'no grant' }, notStaff),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(calls).toHaveLength(0);
  });
});

describe('Phase I — the controller boundary', () => {
  it('rejects a body with no reason, so a blank reason never reaches the database CHECK', async () => {
    const controller = new SupervisorController({} as SupervisorCaseService);

    await expect(
      controller.resolve(CASE_ID, { outcome: 'RESOLVED', reason: '   ' }, staffUser()),
    ).rejects.toBeInstanceOf(DomainError);

    await expect(
      controller.resolve(CASE_ID, { outcome: 'NOT_A_REAL_OUTCOME', reason: 'x' }, staffUser()),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses a body smuggling an actor or a case id', async () => {
    const controller = new SupervisorController({} as SupervisorCaseService);

    await expect(
      controller.resolve(
        CASE_ID,
        { outcome: 'RESOLVED', reason: 'ok', actorId: 'someone-else', caseId: 'another' },
        staffUser(),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('exposes no route that mutates domain state', () => {
    const methods = Object.getOwnPropertyNames(SupervisorController.prototype).filter(
      (name) => name !== 'constructor',
    );

    expect(methods.sort()).toEqual(['detail', 'list', 'resolve']);
  });
});
