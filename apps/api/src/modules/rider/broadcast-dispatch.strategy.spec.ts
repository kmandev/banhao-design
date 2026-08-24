import { BroadcastDispatchStrategy } from './broadcast-dispatch.strategy';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * DEC-037's eligibility rule, proven at the query level: `APPROVED` + online +
 * a valid recorded location, and **nothing else**.
 *
 * Same stub shape as the payment specs — a fake `supabase.admin.from()` that
 * records every filter a statement was built with, so a test can assert the
 * predicate is actually IN the query rather than applied afterwards in
 * application code. That matters here in both directions: the three conditions
 * must be present, and no fourth one may appear.
 */

type Result = { data: unknown; error: { message: string; code?: string } | null };

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update';
  eq: Record<string, unknown>;
  in: Record<string, unknown[]>;
  not: string[];
  ordered: boolean;
  limited: boolean;
  payload?: Record<string, unknown>;
}

function supabaseStub(results: Result[]) {
  const calls: Recorded[] = [];
  let index = 0;
  const nextResult = (): Result => results[index++] ?? { data: null, error: null };

  const admin = {
    from(table: string) {
      const call: Recorded = { table, op: 'select', eq: {}, in: {}, not: [], ordered: false, limited: false };
      calls.push(call);

      const builder: Record<string, unknown> = {
        select: () => builder,
        insert(payload: Record<string, unknown>) {
          call.op = 'insert';
          call.payload = payload;
          return builder;
        },
        update(payload: Record<string, unknown>) {
          call.op = 'update';
          call.payload = payload;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.eq[column] = value;
          return builder;
        },
        in(column: string, values: unknown[]) {
          call.in[column] = values;
          return builder;
        },
        not(column: string, operator: string, value: unknown) {
          call.not.push(`${column} ${operator} ${String(value)}`);
          return builder;
        },
        order: () => {
          call.ordered = true;
          return builder;
        },
        limit: () => {
          call.limited = true;
          return builder;
        },
        maybeSingle: () => Promise.resolve(nextResult()),
        returns: () => Promise.resolve(nextResult()),
        then: (resolve: (r: Result) => unknown) => Promise.resolve(nextResult()).then(resolve),
      };

      return builder;
    },
  };

  return { supabase: { admin } as unknown as SupabaseService, calls };
}

const RIDER_A = 'rider-a';
const RIDER_B = 'rider-b';

describe('BroadcastDispatchStrategy — the DEC-037 eligibility rule', () => {
  it('an APPROVED, online rider with a location qualifies', async () => {
    const { supabase } = supabaseStub([
      { data: [{ rider_id: RIDER_A }], error: null },
      { data: [{ id: RIDER_A }], error: null },
    ]);

    await expect(new BroadcastDispatchStrategy(supabase).selectCandidateRiderIds()).resolves.toEqual([
      RIDER_A,
    ]);
  });

  it('broadcasts to every eligible rider — DEC-020, no shortlist', async () => {
    const { supabase } = supabaseStub([
      { data: [{ rider_id: RIDER_A }, { rider_id: RIDER_B }], error: null },
      { data: [{ id: RIDER_A }, { id: RIDER_B }], error: null },
    ]);

    await expect(new BroadcastDispatchStrategy(supabase).selectCandidateRiderIds()).resolves.toEqual([
      RIDER_A,
      RIDER_B,
    ]);
  });

  it('an offline rider is excluded by the query itself — is_online = true is in the WHERE clause', async () => {
    const { supabase, calls } = supabaseStub([
      { data: [], error: null },
    ]);

    const result = await new BroadcastDispatchStrategy(supabase).selectCandidateRiderIds();

    expect(result).toEqual([]);
    const availability = calls.find((c) => c.table === 'rider_availability');
    expect(availability?.eq).toMatchObject({ is_online: true });
    // Nothing to intersect against, so the riders table is never read.
    expect(calls.find((c) => c.table === 'riders')).toBeUndefined();
  });

  it('a rider with a NULL location is excluded by the query itself — location IS NOT NULL is in the WHERE clause', async () => {
    const { supabase, calls } = supabaseStub([
      { data: [{ rider_id: RIDER_A }], error: null },
      { data: [{ id: RIDER_A }], error: null },
    ]);

    await new BroadcastDispatchStrategy(supabase).selectCandidateRiderIds();

    const availability = calls.find((c) => c.table === 'rider_availability');
    expect(availability?.not).toContain('location is null');
  });

  it('a rider who is online but not APPROVED is excluded — status is re-checked against riders', async () => {
    const { supabase, calls } = supabaseStub([
      { data: [{ rider_id: RIDER_A }, { rider_id: RIDER_B }], error: null },
      // Only A comes back APPROVED; B is SUSPENDED/PENDING and simply is not in the result.
      { data: [{ id: RIDER_A }], error: null },
    ]);

    const result = await new BroadcastDispatchStrategy(supabase).selectCandidateRiderIds();

    expect(result).toEqual([RIDER_A]);
    const riders = calls.find((c) => c.table === 'riders');
    expect(riders?.eq).toMatchObject({ status: 'APPROVED' });
    expect(riders?.in).toMatchObject({ id: [RIDER_A, RIDER_B] });
  });

  it('applies NO radius, NO distance filter and NO ranking — the queries contain nothing but the three DEC-037 predicates', async () => {
    const { supabase, calls } = supabaseStub([
      { data: [{ rider_id: RIDER_A }], error: null },
      { data: [{ id: RIDER_A }], error: null },
    ]);

    await new BroadcastDispatchStrategy(supabase).selectCandidateRiderIds();

    const availability = calls.find((c) => c.table === 'rider_availability');
    // Exactly one equality (is_online) and exactly one null-check (location).
    expect(Object.keys(availability?.eq ?? {})).toEqual(['is_online']);
    expect(availability?.not).toEqual(['location is null']);
    // No ORDER BY: ranking a broadcast pool would be DEC-020's rejected Model A.
    expect(availability?.ordered).toBe(false);
    // No LIMIT: a broadcast that silently truncated the pool would not be a broadcast.
    expect(availability?.limited).toBe(false);
    // The restaurant is never read at all, so `service_radius_m` cannot reach dispatch.
    expect(calls.find((c) => c.table === 'restaurants')).toBeUndefined();
    // No delivery, order or address read either — no customer distance input exists.
    expect(calls.map((c) => c.table).sort()).toEqual(['rider_availability', 'riders']);
  });

  it('fails closed: a read error yields an empty pool rather than an unfiltered one', async () => {
    const { supabase } = supabaseStub([
      { data: null, error: { message: 'connection reset' } },
    ]);

    await expect(new BroadcastDispatchStrategy(supabase).selectCandidateRiderIds()).resolves.toEqual([]);
  });

  it('fails closed when the approval read fails, even though online riders were found', async () => {
    const { supabase } = supabaseStub([
      { data: [{ rider_id: RIDER_A }], error: null },
      { data: null, error: { message: 'connection reset' } },
    ]);

    await expect(new BroadcastDispatchStrategy(supabase).selectCandidateRiderIds()).resolves.toEqual([]);
  });
});
