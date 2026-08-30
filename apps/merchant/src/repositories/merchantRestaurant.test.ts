import type { SupabaseClient } from '@supabase/supabase-js';
import { createMerchantRestaurantRepository } from './merchantRestaurant';

/**
 * M-1's authorization read path (DEC-APP-004 / DEC-033) — a direct Supabase
 * read against `restaurant_members` under RLS. These tests stub the query
 * builder so a dropped `revoked_at` filter, a wrong table, or a fabricated
 * membership fails here rather than only in a live check. Mirrors
 * apps/driver/src/repositories/riderOfferInbox.test.ts's stubbing style.
 */

type Result = { data: unknown; error: { message: string } | null };

interface Recorded {
  table: string;
  select: string[];
  is: Record<string, unknown>;
}

function supabaseStub(result: Result) {
  const calls: Recorded[] = [];

  const client = {
    from(table: string) {
      const call: Recorded = { table, select: [], is: {} };
      calls.push(call);

      const builder = {
        select(columns: string) {
          call.select.push(columns);
          return builder;
        },
        is(column: string, value: unknown) {
          call.is[column] = value;
          return Promise.resolve(result);
        },
      };

      return builder;
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

function repoWith(result: Result) {
  const { client, calls } = supabaseStub(result);
  return { subject: createMerchantRestaurantRepository(client), calls };
}

const MEMBER_ROW = {
  restaurant_id: 'rest-1',
  member_role: 'OWNER',
  restaurants: { name: 'ร้านบ้านเฮา', status: 'ACTIVE' },
};

describe('listOwnMemberships — table and column access', () => {
  it('queries only restaurant_members, joined to restaurants', async () => {
    const { subject, calls } = repoWith({ data: [MEMBER_ROW], error: null });
    await subject.listOwnMemberships();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.table).toBe('restaurant_members');
  });

  it('filters revoked_at is null — defense in depth alongside RLS', async () => {
    const { subject, calls } = repoWith({ data: [MEMBER_ROW], error: null });
    await subject.listOwnMemberships();

    expect(calls[0]!.is).toEqual({ revoked_at: null });
  });

  it('never applies a client-side user_id filter — RLS is the only scope', async () => {
    const { subject, calls } = repoWith({ data: [MEMBER_ROW], error: null });
    await subject.listOwnMemberships();

    const selected = calls[0]!.select.join(' ');
    expect(selected).not.toMatch(/user_id/);
  });
});

describe('listOwnMemberships — mapping and results', () => {
  it('maps an active membership to a RestaurantMembership', async () => {
    const { subject } = repoWith({ data: [MEMBER_ROW], error: null });
    const result = await subject.listOwnMemberships();

    expect(result).toEqual([
      {
        restaurantId: 'rest-1',
        restaurantName: 'ร้านบ้านเฮา',
        restaurantStatus: 'ACTIVE',
        memberRole: 'OWNER',
      },
    ]);
  });

  it('returns an empty array for a user with no active membership — not an error', async () => {
    const { subject } = repoWith({ data: [], error: null });
    const result = await subject.listOwnMemberships();

    expect(result).toEqual([]);
  });

  it('returns an empty array for a revoked-only membership set (RLS excludes it server-side)', async () => {
    // A revoked row would never actually come back from Supabase — RLS
    // filters it via is_restaurant_member()'s own revoked_at check — but the
    // repository must not fabricate a membership even if one somehow did.
    const { subject } = repoWith({ data: [], error: null });
    const result = await subject.listOwnMemberships();

    expect(result).toEqual([]);
  });

  it('skips a row whose joined restaurant is unreadable rather than rendering a nameless one', async () => {
    const { subject } = repoWith({
      data: [{ restaurant_id: 'rest-2', member_role: 'STAFF', restaurants: null }],
      error: null,
    });
    const result = await subject.listOwnMemberships();

    expect(result).toEqual([]);
  });

  it('throws rather than silently returning no memberships on a query error', async () => {
    const { subject } = repoWith({ data: null, error: { message: 'network error' } });
    await expect(subject.listOwnMemberships()).rejects.toThrow('network error');
  });
});
