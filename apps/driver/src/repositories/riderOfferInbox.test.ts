import type { SupabaseClient } from '@supabase/supabase-js';
import { createRiderOfferInboxRepository } from './riderOfferInbox';

/**
 * Phase G, V1.1 §9 — the rider's offer-inbox read path is a direct Supabase
 * read under RLS (DEC-APP-008), scoped entirely by
 * `rider_assignment_attempts_select_own`. These tests stub the query
 * builder the same way `riderOrderView.test.ts` does, so a wrong table, a
 * dropped column, a smuggled `rider_id` filter, or a missing `PENDING`
 * filter fails here rather than only in a live check.
 */

type Result = { data: unknown; error: { message: string } | null };

interface Recorded {
  table: string;
  select: string[];
  eq: Record<string, unknown>;
  in: Record<string, unknown[]>;
  writeOps: string[];
}

const FORBIDDEN_TABLES = [
  'orders',
  'order_items',
  'order_item_options',
  'deliveries',
  'rider_assignments',
  'rider_availability',
];

const MONEY_PATTERN = /satang|price|commission|earning|payment_method|ledger|settlement|refund/i;

function supabaseStub(byTable: Record<string, Result>) {
  const calls: Recorded[] = [];

  const client = {
    from(table: string) {
      const call: Recorded = { table, select: [], eq: {}, in: {}, writeOps: [] };
      calls.push(call);

      const builder: Record<string, unknown> = {
        select(columns: string) {
          call.select.push(columns);
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
        insert() {
          call.writeOps.push('insert');
          return builder;
        },
        update() {
          call.writeOps.push('update');
          return builder;
        },
        upsert() {
          call.writeOps.push('upsert');
          return builder;
        },
        delete() {
          call.writeOps.push('delete');
          return builder;
        },
        rpc() {
          call.writeOps.push('rpc');
          return builder;
        },
        returns: () => Promise.resolve(byTable[table] ?? { data: [], error: null }),
      };

      return builder;
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

function repoWith(byTable: Record<string, Result>) {
  const { client, calls } = supabaseStub(byTable);
  return {
    subject: createRiderOfferInboxRepository(client),
    calls,
  };
}

/** Recursively collects every own-property key of a value, including nested arrays/objects. */
function collectKeys(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, into);
    return into;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      into.push(key);
      collectKeys(entry, into);
    }
  }
  return into;
}

const OFFER_ROW = {
  id: 'attempt-1',
  delivery_id: 'delivery-1',
  round_no: 1,
  offered_at: '2026-08-25T05:00:00Z',
  expires_at: '2026-08-25T05:01:00Z',
  outcome: 'PENDING',
};

describe('listPendingOffers — table and column access', () => {
  it('queries only rider_assignment_attempts', async () => {
    const { subject, calls } = repoWith({
      rider_assignment_attempts: { data: [OFFER_ROW], error: null },
    });

    await subject.listPendingOffers();

    const tables = [...new Set(calls.map((c) => c.table))];
    expect(tables).toEqual(['rider_assignment_attempts']);
    for (const forbidden of FORBIDDEN_TABLES) {
      expect(tables).not.toContain(forbidden);
    }
  });

  it('selects exactly the allowed columns — the literal projection, never "*" and never a superset', async () => {
    const { subject, calls } = repoWith({
      rider_assignment_attempts: { data: [OFFER_ROW], error: null },
    });

    await subject.listPendingOffers();

    expect(calls[0]?.select).toEqual(['id, delivery_id, round_no, offered_at, expires_at, outcome']);
  });
});

describe('listPendingOffers — PENDING filter, no identity filter', () => {
  it('filters on outcome = PENDING', async () => {
    const { subject, calls } = repoWith({
      rider_assignment_attempts: { data: [OFFER_ROW], error: null },
    });

    await subject.listPendingOffers();

    expect(calls[0]?.eq).toEqual({ outcome: 'PENDING' });
  });

  it('never filters by a rider identity — authorization is the RLS policy alone', async () => {
    const { subject, calls } = repoWith({
      rider_assignment_attempts: { data: [OFFER_ROW], error: null },
    });

    await subject.listPendingOffers();

    const forbiddenFilterKeys = ['rider_id', 'riderId'];
    for (const call of calls) {
      const filterKeys = [...Object.keys(call.eq), ...Object.keys(call.in)];
      for (const key of filterKeys) {
        expect(forbiddenFilterKeys).not.toContain(key);
      }
    }
  });
});

describe('listPendingOffers — money isolation', () => {
  it('never requests or returns a money-shaped field: satang, price, commission, earning, payment_method, ledger, settlement, refund', async () => {
    const { subject, calls } = repoWith({
      rider_assignment_attempts: { data: [OFFER_ROW], error: null },
    });

    const offers = await subject.listPendingOffers();

    for (const call of calls) {
      for (const columns of call.select) {
        expect(MONEY_PATTERN.test(columns)).toBe(false);
      }
    }

    for (const key of collectKeys(offers)) {
      expect(MONEY_PATTERN.test(key)).toBe(false);
    }
  });
});

describe('listPendingOffers — empty inbox', () => {
  it('returns an empty list when the rider has no pending offers, not an error', async () => {
    const { subject } = repoWith({
      rider_assignment_attempts: { data: [], error: null },
    });

    await expect(subject.listPendingOffers()).resolves.toEqual([]);
  });
});

describe('listPendingOffers — multiple concurrent offers', () => {
  it('maps every pending offer, across different deliveries, in one list', async () => {
    const secondOffer = {
      id: 'attempt-2',
      delivery_id: 'delivery-2',
      round_no: 1,
      offered_at: '2026-08-25T05:00:05Z',
      expires_at: '2026-08-25T05:01:05Z',
      outcome: 'PENDING',
    };

    const { subject } = repoWith({
      rider_assignment_attempts: { data: [OFFER_ROW, secondOffer], error: null },
    });

    const offers = await subject.listPendingOffers();

    expect(offers).toEqual([
      {
        offerId: 'attempt-1',
        deliveryId: 'delivery-1',
        roundNo: 1,
        offeredAt: '2026-08-25T05:00:00Z',
        expiresAt: '2026-08-25T05:01:00Z',
        outcome: 'PENDING',
      },
      {
        offerId: 'attempt-2',
        deliveryId: 'delivery-2',
        roundNo: 1,
        offeredAt: '2026-08-25T05:00:05Z',
        expiresAt: '2026-08-25T05:01:05Z',
        outcome: 'PENDING',
      },
    ]);
  });
});

describe('listPendingOffers — failures', () => {
  it('throws rather than returning an empty result on a Supabase read error', async () => {
    const { subject } = repoWith({
      rider_assignment_attempts: { data: null, error: { message: 'connection reset' } },
    });

    await expect(subject.listPendingOffers()).rejects.toThrow('Rider offer read failed: connection reset');
  });
});

describe('listPendingOffers — read-only', () => {
  it('never calls insert, update, upsert, delete or rpc against any table', async () => {
    const { subject, calls } = repoWith({
      rider_assignment_attempts: { data: [OFFER_ROW], error: null },
    });

    await subject.listPendingOffers();

    expect(calls.flatMap((c) => c.writeOps)).toEqual([]);
  });
});
