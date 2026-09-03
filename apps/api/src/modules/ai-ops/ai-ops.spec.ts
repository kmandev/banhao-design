import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentPort, DeterministicAgentAdapter } from './agent.port';
import { AiAuditService } from './ai-audit.service';
import { CommandDispatcher } from './command-dispatcher';
import { EventNormalizer } from './event-normalizer';
import {
  Bq013MerchantAcceptancePolicySource,
  MerchantAcceptancePolicySource,
  type MerchantAcceptanceTimeoutPolicy,
} from './merchant-acceptance-policy';
import { MerchantAcceptanceTimeoutService } from './merchant-acceptance-timeout.service';
import { PlaybookRouter } from './playbook-router';
import {
  AUTONOMOUSLY_EXECUTABLE_LEVELS,
  COMMAND_CATALOG,
  COMMAND_NOTIFY_MERCHANT_ACCEPTANCE_DEADLINE,
} from './command-catalog';
import type {
  AgentDecision,
  PolicyResolution,
  ScopedOperationalProjection,
} from './ai-ops.types';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * Phase J vertical slice #1 — Merchant Acceptance Timeout.
 *
 * Same fake-Supabase shape as `no-rider-escalation.service.spec.ts` and
 * `dispatch.service.spec.ts`: a stub recording every table, filter and
 * payload, so a guard can be asserted to be IN the statement rather than
 * checked afterwards in application code.
 *
 * No test uses the protected real order `BH-20260824-0001`. Every id below is
 * a fixture uuid that exists only in this file.
 */

type Result = { data: unknown; error: { message: string; code?: string } | null };

interface Recorded {
  table: string;
  op: 'select' | 'insert';
  eq: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

const ORDER_ID = 'aa000000-0000-4000-8000-000000000001';
const RESTAURANT_ID = 'bb000000-0000-4000-8000-000000000002';
const MERCHANT_ID = 'cc000000-0000-4000-8000-000000000003';
const OWNER_USER_ID = 'dd000000-0000-4000-8000-000000000004';
const OUTBOX_ID = 'ee000000-0000-4000-8000-000000000005';

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
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve(nextResult()),
        returns: () => Promise.resolve(nextResult()),
        then: (resolve: (r: Result) => unknown) => Promise.resolve(nextResult()).then(resolve),
      };

      return builder;
    },
  };

  return { service: { admin } as unknown as SupabaseService, calls };
}

/** A policy source that resolves — used ONLY in tests, so no approved value is invented in production code. */
class FixturePolicySource extends MerchantAcceptancePolicySource {
  constructor(private readonly deadlineSeconds: number) {
    super();
  }

  resolve(): PolicyResolution<MerchantAcceptanceTimeoutPolicy> {
    return {
      status: 'RESOLVED',
      value: { acceptanceDeadlineSeconds: this.deadlineSeconds, reminderLeadSeconds: 30 },
      policyVersion: 'test-fixture-policy-v1',
    };
  }
}

class FixtureAgent extends AgentPort {
  constructor(private readonly decision: AgentDecision) {
    super();
  }

  seen: ScopedOperationalProjection | null = null;

  async decide(projection: ScopedOperationalProjection): Promise<AgentDecision> {
    this.seen = projection;
    return this.decision;
  }
}

const outboxRow = () => ({
  id: OUTBOX_ID,
  aggregate_type: 'order',
  aggregate_id: ORDER_ID,
  event_type: 'PaymentSucceeded',
  created_at: '2026-09-03T00:00:00.000Z',
});

/** An order that reached PAID two hours ago — past any plausible deadline a fixture policy sets. */
const paidOrderRow = (state = 'PAID') => ({
  id: ORDER_ID,
  state,
  restaurant_id: RESTAURANT_ID,
  paid_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
});

function buildService(params: {
  results: Result[];
  policy?: MerchantAcceptancePolicySource;
  agent?: AgentPort;
}) {
  const { service: supabase, calls } = supabaseStub(params.results);
  const audit = new AiAuditService(supabase);
  const dispatcher = new CommandDispatcher(supabase);
  const agent = params.agent ?? new FixtureAgent({ kind: 'NO_ACTION', reason: 'unused' });

  const pipeline = new MerchantAcceptanceTimeoutService(
    supabase,
    new EventNormalizer(),
    new PlaybookRouter(),
    params.policy ?? new Bq013MerchantAcceptancePolicySource(),
    agent,
    dispatcher,
    audit,
  );

  return { pipeline, calls, agent };
}

const auditInserts = (calls: Recorded[]) =>
  calls.filter((c) => c.table === 'audit_logs' && c.op === 'insert');

/** The first audit row's payload, asserted present — keeps the assertions below readable under `noUncheckedIndexedAccess`. */
function firstAuditPayload(calls: Recorded[]): Record<string, unknown> {
  const audits = auditInserts(calls);
  const payload = audits[0]?.payload;
  if (!payload) {
    throw new Error('expected at least one audit_logs insert');
  }
  return payload;
}

describe('Phase J — event normalization', () => {
  const normalizer = new EventNormalizer();

  it('normalizes a shipped PaymentSucceeded outbox row', () => {
    const event = normalizer.normalize(outboxRow());

    expect(event).not.toBeNull();
    expect(event?.aggregateId).toBe(ORDER_ID);
    expect(event?.dedupeKey).toBe(`${EventNormalizer.MERCHANT_ACCEPTANCE_ACTION}:${ORDER_ID}`);
  });

  it('refuses a malformed event rather than guessing at it', () => {
    expect(normalizer.normalize({ ...outboxRow(), aggregate_id: 'not-a-uuid' })).toBeNull();
    expect(normalizer.normalize({ ...outboxRow(), created_at: 'never' })).toBeNull();
    expect(normalizer.normalize({ ...outboxRow(), id: null })).toBeNull();
  });

  it('refuses an unknown event type', () => {
    expect(normalizer.normalize({ ...outboxRow(), event_type: 'SomethingElse' })).toBeNull();
  });
});

describe('Phase J — deterministic routing', () => {
  const router = new PlaybookRouter();
  const normalizer = new EventNormalizer();

  it('routes a paid order to the merchant acceptance timeout playbook', () => {
    const event = normalizer.normalize(outboxRow())!;
    expect(router.route(event)).toBe('MERCHANT_ACCEPTANCE_TIMEOUT');
  });

  it('routes nothing for an aggregate the playbook does not own', () => {
    const event = normalizer.normalize(outboxRow())!;
    expect(router.route({ ...event, aggregateType: 'delivery' })).toBeNull();
  });

  it('never invokes the agent to decide routing', async () => {
    // The router is a pure function with no collaborators at all — the
    // strongest available form of "no model call happens here".
    expect(Object.keys(router)).toHaveLength(0);
  });
});

describe('Phase J — policy fails closed (DEC-040 §5)', () => {
  it('production policy source resolves MISSING, citing BQ-013', () => {
    const resolution = new Bq013MerchantAcceptancePolicySource().resolve();

    expect(resolution.status).toBe('MISSING');
    if (resolution.status === 'MISSING') {
      expect(resolution.dependency).toBe('BQ-013');
    }
  });

  it('escalates ESC-UNKNOWN and never reaches the agent when policy is missing', async () => {
    const agent = new FixtureAgent({ kind: 'NO_ACTION', reason: 'should never be called' });
    const { pipeline, calls } = buildService({
      results: [
        { data: [outboxRow()], error: null }, // outbox candidates
        { data: [], error: null }, // audit dedupe check — not handled yet
        { data: null, error: null }, // audit insert
      ],
      agent,
    });

    const result = await pipeline.run();

    expect(result.escalated).toBe(1);
    expect(agent.seen).toBeNull();

    expect(auditInserts(calls)).toHaveLength(1);
    const audit = firstAuditPayload(calls);
    expect(audit.actor_type).toBe('AI');
    expect(String(audit.reason)).toContain('ESC-UNKNOWN');
    expect(String(audit.reason)).toContain('BQ-013');
  });

  it('invents no default anywhere in the production policy module', () => {
    // Guards against the failure mode DEC-040 §5 names: a "sensible" fallback
    // appearing later. The rider accept window must not be aliased here.
    const source = readFileSync(join(__dirname, 'merchant-acceptance-policy.ts'), 'utf8');

    const code = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .join('\n');

    expect(code).not.toMatch(/acceptanceDeadlineSeconds\s*:\s*\d+/);
    expect(code).not.toMatch(/ACCEPT_WINDOW_SECONDS/);
  });
});

describe('Phase J — command catalog and autonomy (DEC-040 §3/§6)', () => {
  it('contains no financial command', () => {
    const names = Object.keys(COMMAND_CATALOG).join(' ').toLowerCase();
    for (const forbidden of ['refund', 'payout', 'ledger', 'fee', 'commission', 'earning', 'payable', 'payment']) {
      expect(names).not.toContain(forbidden);
    }
    for (const entry of Object.values(COMMAND_CATALOG)) {
      expect(entry.domain).toBe('notification');
    }
  });

  it('never treats L4 or L5 as autonomously executable', () => {
    expect(AUTONOMOUSLY_EXECUTABLE_LEVELS.has('L4')).toBe(false);
    expect(AUTONOMOUSLY_EXECUTABLE_LEVELS.has('L5')).toBe(false);
    expect(AUTONOMOUSLY_EXECUTABLE_LEVELS.has('L2')).toBe(true);
  });

  it('refuses a command that is not in the catalog', async () => {
    const { service } = supabaseStub([]);
    const dispatcher = new CommandDispatcher(service);

    const result = await dispatcher.dispatch({
      name: 'issue_refund',
      orderId: ORDER_ID,
      reason: 'agent asked for it',
    });

    expect(result.status).toBe('NOT_PERMITTED');
    expect(result.detail).toContain('not in the AI Operations catalog');
  });

  it('reaches no database at all for a refused command', async () => {
    const { service, calls } = supabaseStub([]);
    const dispatcher = new CommandDispatcher(service);

    await dispatcher.dispatch({ name: 'drop_table', orderId: ORDER_ID, reason: 'no' });

    expect(calls).toHaveLength(0);
  });
});

describe('Phase J — the agent boundary (DEC-040 §1/§2)', () => {
  it('is constructed with no database client, so it cannot mutate anything', () => {
    const agent = new DeterministicAgentAdapter();

    // Nothing injectable, nothing stateful, nothing that could reach Postgres.
    expect(Object.keys(agent)).toHaveLength(0);
    expect(DeterministicAgentAdapter.length).toBe(0);
  });

  it('can only return a catalog command, an escalation, or no action', async () => {
    const decision: AgentDecision = await new DeterministicAgentAdapter().decide({
      playbook: 'MERCHANT_ACCEPTANCE_TIMEOUT',
      orderId: ORDER_ID,
      orderState: 'PAID',
      restaurantId: RESTAURANT_ID,
      awaitingAcceptanceSince: new Date().toISOString(),
      elapsedSeconds: 900,
      hasDelivery: false,
    });

    expect(decision.kind).toBe('COMMAND');
    if (decision.kind === 'COMMAND') {
      expect(decision.command.name).toBe(COMMAND_NOTIFY_MERCHANT_ACCEPTANCE_DEADLINE);
      expect(Object.keys(decision.command).sort()).toEqual(['name', 'orderId', 'reason']);
    }
  });

  it('receives a projection carrying no financial field', async () => {
    const agent = new FixtureAgent({ kind: 'NO_ACTION', reason: 'inspect only' });
    const { pipeline } = buildService({
      results: [
        { data: [outboxRow()], error: null },
        { data: [], error: null }, // dedupe: not handled
        { data: paidOrderRow(), error: null }, // projection order read
        { data: [], error: null }, // deliveries read
      ],
      policy: new FixturePolicySource(60),
      agent,
    });

    await pipeline.run();

    expect(agent.seen).not.toBeNull();
    const projectionKeys = Object.keys(agent.seen!);
    for (const forbidden of ['amount', 'satang', 'total', 'fee', 'payment', 'ledger']) {
      expect(projectionKeys.join(' ').toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe('Phase J — guarded domain integration and verification', () => {
  it('executes the command, verifies the effect, and audits as AI', async () => {
    const agent = new FixtureAgent({
      kind: 'COMMAND',
      command: {
        name: COMMAND_NOTIFY_MERCHANT_ACCEPTANCE_DEADLINE,
        orderId: ORDER_ID,
        reason: 'past deadline',
      },
    });

    const { pipeline, calls } = buildService({
      results: [
        { data: [outboxRow()], error: null }, // outbox candidates
        { data: [], error: null }, // audit dedupe
        { data: paidOrderRow(), error: null }, // projection order
        { data: [], error: null }, // deliveries
        { data: paidOrderRow(), error: null }, // dispatcher revalidation read
        { data: { merchant_id: MERCHANT_ID }, error: null }, // restaurants
        { data: { owner_user_id: OWNER_USER_ID }, error: null }, // merchants
        { data: null, error: null }, // outbox insert
        { data: [{ id: 'written' }], error: null }, // verification read
        { data: null, error: null }, // audit insert
      ],
      policy: new FixturePolicySource(60),
      agent,
    });

    const result = await pipeline.run();

    expect(result.acted).toBe(1);
    expect(result.escalated).toBe(0);

    const reminder = calls.find((c) => c.table === 'outbox' && c.op === 'insert');
    expect(reminder?.payload?.event_type).toBe('MerchantAcceptanceDeadlineReminder');

    expect(auditInserts(calls)).toHaveLength(1);
    const audit = firstAuditPayload(calls);
    expect(audit.actor_type).toBe('AI');
    expect(audit.actor_type).not.toBe('SYSTEM');
    expect(audit.entity_id).toBe(ORDER_ID);
    expect(audit.source).toBe('worker');
  });

  it('maps a domain refusal to ESC-DOMAIN-REJECT and writes no notification', async () => {
    const agent = new FixtureAgent({
      kind: 'COMMAND',
      command: {
        name: COMMAND_NOTIFY_MERCHANT_ACCEPTANCE_DEADLINE,
        orderId: ORDER_ID,
        reason: 'past deadline',
      },
    });

    const { pipeline, calls } = buildService({
      results: [
        { data: [outboxRow()], error: null },
        { data: [], error: null }, // dedupe
        { data: paidOrderRow(), error: null }, // projection sees PAID
        { data: [], error: null }, // deliveries
        // The merchant accepted between the projection and the command: the
        // domain's own state is what refuses, not application logic upstream.
        { data: paidOrderRow('MERCHANT_ACCEPTED'), error: null },
        { data: null, error: null }, // audit insert
      ],
      policy: new FixturePolicySource(60),
      agent,
    });

    const result = await pipeline.run();

    expect(result.escalated).toBe(1);
    expect(calls.some((c) => c.table === 'outbox' && c.op === 'insert')).toBe(false);

    const audit = firstAuditPayload(calls);
    expect(String(audit.reason)).toContain('ESC-DOMAIN-REJECT');
    expect(audit.actor_type).toBe('AI');
  });

  it('does not act on an order that is no longer awaiting acceptance', async () => {
    const agent = new FixtureAgent({ kind: 'NO_ACTION', reason: 'unused' });
    const { pipeline, calls } = buildService({
      results: [
        { data: [outboxRow()], error: null },
        { data: [], error: null },
        { data: paidOrderRow('DELIVERED'), error: null },
        { data: [], error: null },
      ],
      policy: new FixturePolicySource(60),
      agent,
    });

    const result = await pipeline.run();

    expect(result.acted).toBe(0);
    expect(agent.seen).toBeNull(); // deterministic branch settled it; no model call
    expect(auditInserts(calls)).toHaveLength(0);
  });
});

describe('Phase J — idempotency', () => {
  it('skips an event already recorded in audit_logs, producing no second effect', async () => {
    const agent = new FixtureAgent({
      kind: 'COMMAND',
      command: {
        name: COMMAND_NOTIFY_MERCHANT_ACCEPTANCE_DEADLINE,
        orderId: ORDER_ID,
        reason: 'past deadline',
      },
    });

    const { pipeline, calls } = buildService({
      results: [
        { data: [outboxRow()], error: null },
        { data: [{ id: 'already-there' }], error: null }, // dedupe: handled
      ],
      policy: new FixturePolicySource(60),
      agent,
    });

    const result = await pipeline.run();

    expect(result.skipped).toBe(1);
    expect(result.acted).toBe(0);
    expect(calls.some((c) => c.table === 'outbox' && c.op === 'insert')).toBe(false);
    expect(auditInserts(calls)).toHaveLength(0);
    expect(agent.seen).toBeNull();
  });

  it('treats a failed dedupe read as already handled, so a database fault cannot duplicate an action', async () => {
    const { service } = supabaseStub([{ data: null, error: { message: 'connection lost' } }]);
    const audit = new AiAuditService(service);

    await expect(audit.alreadyHandled('ANY_ACTION', ORDER_ID)).resolves.toBe(true);
  });
});

describe('Phase J — failure safety (DEC-040: AI failure is not an operational failure)', () => {
  it('never throws when the candidate read fails', async () => {
    const { pipeline } = buildService({
      results: [{ data: null, error: { message: 'outbox unavailable' } }],
    });

    await expect(pipeline.run()).resolves.toEqual({
      examined: 0,
      acted: 0,
      escalated: 0,
      skipped: 0,
      failed: 1,
    });
  });

  it('never throws when the agent itself fails', async () => {
    class ExplodingAgent extends AgentPort {
      async decide(): Promise<AgentDecision> {
        throw new Error('model unavailable');
      }
    }

    const { pipeline } = buildService({
      results: [
        { data: [outboxRow()], error: null },
        { data: [], error: null },
        { data: paidOrderRow(), error: null },
        { data: [], error: null },
      ],
      policy: new FixturePolicySource(60),
      agent: new ExplodingAgent(),
    });

    const result = await pipeline.run();

    expect(result.failed).toBe(1);
    expect(result.acted).toBe(0);
  });
});
