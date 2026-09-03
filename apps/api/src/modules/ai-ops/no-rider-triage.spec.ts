import { AgentPort, DeterministicAgentAdapter } from './agent.port';
import { AiAuditService } from './ai-audit.service';
import { EventNormalizer } from './event-normalizer';
import {
  Dec022NoRiderTriagePolicySource,
  NoRiderTriagePolicySource,
  type NoRiderTriagePolicy,
} from './no-rider-triage-policy';
import { NoRiderTriageService } from './no-rider-triage.service';
import { PlaybookRouter } from './playbook-router';
import { COMMAND_CATALOG } from './command-catalog';
import { NO_RIDER_DECISION_SECONDS } from '../rider/no-rider-escalation.service';
import type { DispatchStrategy } from '../rider/dispatch-strategy.interface';
import type {
  AgentDecision,
  PolicyResolution,
  ScopedOperationalProjection,
} from './ai-ops.types';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * Phase J vertical slice #2 — No Rider Triage (design package § 10, "No rider
 * found").
 *
 * Same fake-Supabase shape as `ai-ops.spec.ts`: a stub recording every table,
 * filter and payload, so a guard is asserted to be IN the statement rather
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
  payload?: Record<string, unknown>;
  order?: { column: string; ascending?: boolean };
}

const DELIVERY_ID = '11000000-0000-4000-8000-000000000001';
const ORDER_ID = '22000000-0000-4000-8000-000000000002';
const OUTBOX_ID = '33000000-0000-4000-8000-000000000003';
const RIDER_A = '44000000-0000-4000-8000-000000000004';
const RIDER_B = '55000000-0000-4000-8000-000000000005';

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
        order(column: string, options?: { ascending?: boolean }) {
          call.order = { column, ascending: options?.ascending };
          return builder;
        },
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

class FixtureStrategy implements DispatchStrategy {
  constructor(private readonly riderIds: string[]) {}

  async selectCandidateRiderIds(): Promise<string[]> {
    return this.riderIds;
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
  aggregate_type: 'delivery',
  aggregate_id: DELIVERY_ID,
  event_type: 'OrderNoRiderFound',
  created_at: '2026-09-03T00:00:00.000Z',
});

/** A delivery that has been searching for 30 minutes — past DEC-022's 8-minute decision point. */
const searchingDeliveryRow = (state = 'RIDER_SEARCHING') => ({
  id: DELIVERY_ID,
  state,
  order_id: ORDER_ID,
  created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
});

const attemptRows = () => [
  { rider_id: RIDER_A, round_no: 1, outcome: 'EXPIRED' },
  { rider_id: RIDER_B, round_no: 1, outcome: 'DECLINED' },
  { rider_id: RIDER_A, round_no: 2, outcome: 'EXPIRED' },
];

function buildService(params: {
  results: Result[];
  policy?: NoRiderTriagePolicySource;
  agent?: AgentPort;
  riderPool?: string[];
}) {
  const { service: supabase, calls } = supabaseStub(params.results);
  const audit = new AiAuditService(supabase);
  const agent = params.agent ?? new DeterministicAgentAdapter();

  const pipeline = new NoRiderTriageService(
    supabase,
    new EventNormalizer(),
    new PlaybookRouter(),
    params.policy ?? new Dec022NoRiderTriagePolicySource(),
    agent,
    audit,
    new FixtureStrategy(params.riderPool ?? []),
  );

  return { pipeline, calls, agent };
}

const auditInserts = (calls: Recorded[]) =>
  calls.filter((c) => c.table === 'audit_logs' && c.op === 'insert');

/** The happy-path read order: outbox candidates, dedupe check, delivery, assignment attempts. */
const happyPathReads = (deliveryState = 'RIDER_SEARCHING'): Result[] => [
  { data: [outboxRow()], error: null },
  { data: [], error: null },
  { data: searchingDeliveryRow(deliveryState), error: null },
  { data: attemptRows(), error: null },
];

describe('Phase J — no-rider triage: normalization and routing', () => {
  const normalizer = new EventNormalizer();
  const router = new PlaybookRouter();

  it('normalizes a shipped OrderNoRiderFound outbox row and keys it to its own playbook', () => {
    const event = normalizer.normalize(outboxRow());

    expect(event?.eventType).toBe('OrderNoRiderFound');
    expect(event?.aggregateType).toBe('delivery');
    expect(event?.dedupeKey).toBe(`AI_OPS_NO_RIDER_TRIAGE:${DELIVERY_ID}`);
  });

  it('refuses an event whose aggregate type does not match the type it is known to carry', () => {
    expect(normalizer.normalize({ ...outboxRow(), aggregate_type: 'order' })).toBeNull();
    expect(
      normalizer.normalize({
        id: OUTBOX_ID,
        aggregate_type: 'delivery',
        aggregate_id: DELIVERY_ID,
        event_type: 'PaymentSucceeded',
        created_at: '2026-09-03T00:00:00.000Z',
      }),
    ).toBeNull();
  });

  it('routes it to NO_RIDER_TRIAGE, and leaves the merchant playbook where it was', () => {
    expect(router.route(normalizer.normalize(outboxRow())!)).toBe('NO_RIDER_TRIAGE');
  });
});

describe('Phase J — no-rider triage: policy resolves from an approved decision', () => {
  it('resolves DEC-022 rather than inventing a decision point', () => {
    const resolved = new Dec022NoRiderTriagePolicySource().resolve();

    expect(resolved.status).toBe('RESOLVED');
    if (resolved.status !== 'RESOLVED') throw new Error('unreachable');
    expect(resolved.policyVersion).toBe('DEC-022');
    // The one approved number, imported from the shipped deterministic ladder
    // rather than restated here.
    expect(resolved.value.decisionPointSeconds).toBe(NO_RIDER_DECISION_SECONDS);
  });

  it('escalates and never reaches the agent when a policy source reports MISSING', async () => {
    class MissingPolicy extends NoRiderTriagePolicySource {
      resolve(): PolicyResolution<NoRiderTriagePolicy> {
        return { status: 'MISSING', dependency: 'UX-Q-006', detail: 'no value' };
      }
    }

    const agent = new FixtureAgent({ kind: 'NO_ACTION', reason: 'unused' });
    const { pipeline, calls } = buildService({
      results: happyPathReads(),
      policy: new MissingPolicy(),
      agent,
    });

    const result = await pipeline.run();

    expect(agent.seen).toBeNull();
    expect(result.escalated).toBe(1);
    expect(auditInserts(calls)[0]?.payload?.reason).toContain('UX-Q-006');
  });
});

describe('Phase J — no-rider triage: what it may and may not do', () => {
  it('escalates ESC-NORIDER with the round history, writing no notification and no state change', async () => {
    const { pipeline, calls } = buildService({
      results: happyPathReads(),
      riderPool: [RIDER_A, RIDER_B],
    });

    const result = await pipeline.run();

    expect(result).toEqual({ examined: 1, acted: 0, escalated: 1, skipped: 0, failed: 0 });

    const audits = auditInserts(calls);
    expect(audits).toHaveLength(1);
    const payload = audits[0]?.payload ?? {};
    expect(payload.actor_type).toBe('AI');
    expect(payload.action).toBe('AI_OPS_NO_RIDER_TRIAGE');
    expect(payload.entity_type).toBe('delivery');
    expect(payload.entity_id).toBe(DELIVERY_ID);
    expect(String(payload.reason)).toContain('ESC-NORIDER');
    expect(payload.after).toMatchObject({
      escalation: 'ESC-NORIDER',
      policyVersion: 'DEC-022',
      roundsBroadcast: 2,
      offersMade: 3,
      offersExpired: 2,
      offersDeclined: 1,
      ridersOffered: 2,
      ridersEligibleNow: 2,
    });

    // Nothing is written anywhere else: no outbox notification, no delivery
    // update, no order update. The customer notice stays the deterministic
    // ladder's to send.
    expect(calls.some((c) => c.op === 'insert' && c.table !== 'audit_logs')).toBe(false);
    expect(calls.some((c) => c.table === 'deliveries' && c.op === 'insert')).toBe(false);
  });

  it('shows the agent counts only — no rider identity and no financial field', async () => {
    const agent = new FixtureAgent({ kind: 'NO_ACTION', reason: 'unused' });
    const { pipeline } = buildService({
      results: happyPathReads(),
      agent,
      riderPool: [RIDER_A],
    });

    await pipeline.run();

    const projection = agent.seen;
    expect(projection?.playbook).toBe('NO_RIDER_TRIAGE');

    const serialized = JSON.stringify(projection);
    for (const forbidden of [RIDER_A, RIDER_B, 'satang', 'fee', 'total', 'amount', 'payout', 'earnings']) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(Object.keys(projection ?? {}).sort()).toEqual(
      [
        'deliveryId',
        'deliveryState',
        'elapsedSeconds',
        'offersDeclined',
        'offersExpired',
        'offersMade',
        'orderId',
        'playbook',
        'ridersEligibleNow',
        'ridersOffered',
        'roundsBroadcast',
        'searchingSince',
      ].sort(),
    );
  });

  it('has no command in the catalog it could reach, so it cannot cancel or fail a delivery', () => {
    const names = Object.keys(COMMAND_CATALOG);

    for (const name of names) {
      expect(name).not.toMatch(/cancel|fail|abandon|refund|reassign|release/i);
    }

    // The one shipped command is the merchant-side notification; nothing in
    // the catalog belongs to this playbook at all.
    expect(names).toEqual(['notify_merchant_acceptance_deadline']);
  });

  it('refuses a command the agent proposes, executes nothing, and records the attempt', async () => {
    const rogue = new FixtureAgent({
      kind: 'COMMAND',
      command: { name: 'cancel_order', orderId: ORDER_ID, reason: 'nobody accepted' },
    });

    const { pipeline, calls } = buildService({ results: happyPathReads(), agent: rogue });

    const result = await pipeline.run();

    expect(result.escalated).toBe(1);
    expect(result.acted).toBe(0);
    const payload = auditInserts(calls)[0]?.payload ?? {};
    expect(String(payload.reason)).toContain('cancel_order');
    expect(String(payload.reason)).toContain('none was executed');
    expect(calls.some((c) => c.op === 'insert' && c.table !== 'audit_logs')).toBe(false);
  });

  it('does nothing for a delivery that has since found a rider', async () => {
    const agent = new FixtureAgent({ kind: 'NO_ACTION', reason: 'unused' });
    const { pipeline, calls } = buildService({
      results: happyPathReads('RIDER_ASSIGNED'),
      agent,
    });

    const result = await pipeline.run();

    expect(agent.seen).toBeNull();
    expect(result).toEqual({ examined: 1, acted: 0, escalated: 0, skipped: 1, failed: 0 });
    expect(auditInserts(calls)).toHaveLength(0);
  });

  it('does nothing before DEC-022 decision point, so the deterministic ladder keeps ownership', async () => {
    const agent = new FixtureAgent({ kind: 'NO_ACTION', reason: 'unused' });
    const { pipeline, calls } = buildService({
      results: [
        { data: [outboxRow()], error: null },
        { data: [], error: null },
        {
          data: {
            id: DELIVERY_ID,
            state: 'RIDER_SEARCHING',
            order_id: ORDER_ID,
            // Six minutes: past the 5-minute customer notice, short of the
            // 8-minute decision point.
            created_at: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
          },
          error: null,
        },
        { data: [], error: null },
      ],
      agent,
    });

    const result = await pipeline.run();

    expect(agent.seen).toBeNull();
    expect(result.escalated).toBe(0);
    expect(auditInserts(calls)).toHaveLength(0);
  });
});

describe('Phase J — no-rider triage: idempotency, candidate selection and failure safety', () => {
  it('skips a delivery already recorded in audit_logs', async () => {
    const agent = new FixtureAgent({ kind: 'NO_ACTION', reason: 'unused' });
    const { pipeline, calls } = buildService({
      results: [
        { data: [outboxRow()], error: null },
        { data: [{ id: 'existing' }], error: null },
      ],
      agent,
    });

    const result = await pipeline.run();

    expect(result.skipped).toBe(1);
    expect(agent.seen).toBeNull();
    expect(auditInserts(calls)).toHaveLength(0);
  });

  it('reads the outbox newest-first, filtered to its own event and aggregate type', async () => {
    const { pipeline, calls } = buildService({ results: [{ data: [], error: null }] });

    await pipeline.run();

    const read = calls.find((c) => c.table === 'outbox' && c.op === 'select');
    expect(read?.eq).toMatchObject({
      event_type: 'OrderNoRiderFound',
      aggregate_type: 'delivery',
    });
    expect(read?.order).toEqual({ column: 'created_at', ascending: false });
  });

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

  it('still escalates when the round-history read fails — an incomplete history is not a reason to stay silent', async () => {
    const { pipeline, calls } = buildService({
      results: [
        { data: [outboxRow()], error: null },
        { data: [], error: null },
        { data: searchingDeliveryRow(), error: null },
        { data: null, error: { message: 'attempts unavailable' } },
      ],
    });

    const result = await pipeline.run();

    expect(result.escalated).toBe(1);
    expect(auditInserts(calls)[0]?.payload?.after).toMatchObject({
      escalation: 'ESC-NORIDER',
      offersMade: 0,
      roundsBroadcast: 0,
    });
  });

  it('contains an agent failure as an ESC-UNKNOWN escalation, so a stuck delivery stays visible', async () => {
    class ExplodingAgent extends AgentPort {
      async decide(): Promise<AgentDecision> {
        throw new Error('model unavailable');
      }
    }

    const { pipeline, calls } = buildService({
      results: happyPathReads(),
      agent: new ExplodingAgent(),
    });

    const result = await pipeline.run();

    expect(result.failed).toBe(0);
    expect(result.escalated).toBe(1);

    const payload = auditInserts(calls)[0]?.payload ?? {};
    expect(payload.entity_type).toBe('delivery');
    expect(String(payload.reason)).toContain('ESC-UNKNOWN');
    expect(String(payload.reason)).toContain('model unavailable');
    expect(calls.some((c) => c.op === 'insert' && c.table !== 'audit_logs')).toBe(false);
  });
});
