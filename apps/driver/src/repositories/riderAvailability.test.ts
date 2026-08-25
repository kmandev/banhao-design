import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AvailabilityNotAppliedError,
  AvailabilityRowMissingError,
  createRiderAvailabilityRepository,
} from './riderAvailability';

/**
 * Phase G, DEC-037 — the rider's own availability row.
 *
 * `rider_availability` is the only table this app writes to directly, and the
 * deployed grant is `select, update (is_online)` — nothing else. These tests
 * stub the query builder the way `riderOfferInbox.test.ts` does, so a wrong
 * table, a widened projection, a smuggled `rider_id` filter, or a payload
 * carrying anything but `is_online` fails here rather than only in a live
 * check against `banhao-dev`.
 */

type Result = { data: unknown; error: { message: string } | null };

interface Recorded {
  table: string;
  select: string[];
  eq: Record<string, unknown>;
  /** Every payload passed to a write verb, in order. */
  payloads: Record<string, unknown>[];
  writeOps: string[];
}

const FORBIDDEN_TABLES = [
  'riders',
  'orders',
  'order_items',
  'order_item_options',
  'deliveries',
  'rider_assignments',
  'rider_assignment_attempts',
];

/** Columns the `authenticated` grant does not cover, plus the two the domain excludes. */
const FORBIDDEN_WRITE_KEYS = [
  'active_delivery_count',
  'last_lat',
  'last_lng',
  'blocked_reason',
  'location',
  'location_updated_at',
  'rider_id',
  'updated_at',
];

const MONEY_PATTERN = /satang|price|commission|earning|payment_method|ledger|settlement|refund/i;

/**
 * @param results `read` answers a plain select; `update` answers the guarded
 *   UPDATE. They are separate because `setOnline` legitimately does both.
 */
function supabaseStub(results: { read?: Result; update?: Result; readAfter?: Result }) {
  const calls: Recorded[] = [];
  let reads = 0;

  const client = {
    from(table: string) {
      const call: Recorded = { table, select: [], eq: {}, payloads: [], writeOps: [] };
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
        insert(payload: Record<string, unknown>) {
          call.writeOps.push('insert');
          call.payloads.push(payload);
          return builder;
        },
        update(payload: Record<string, unknown>) {
          call.writeOps.push('update');
          call.payloads.push(payload);
          return builder;
        },
        upsert(payload: Record<string, unknown>) {
          call.writeOps.push('upsert');
          call.payloads.push(payload);
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
        maybeSingle: () => {
          if (call.writeOps.includes('update')) {
            return Promise.resolve(results.update ?? { data: null, error: null });
          }
          reads += 1;
          // The second read in one operation is `setOnline`'s disambiguating
          // re-read after the guard matched nothing.
          const answer = reads === 1 ? results.read : (results.readAfter ?? results.read);
          return Promise.resolve(answer ?? { data: null, error: null });
        },
      };

      return builder;
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

function repoWith(results: { read?: Result; update?: Result; readAfter?: Result }) {
  const { client, calls } = supabaseStub(results);
  return { subject: createRiderAvailabilityRepository(client), calls };
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

const ONLINE_ROW = { is_online: true, location_updated_at: '2026-08-25T05:00:00Z' };
const OFFLINE_ROW = { is_online: false, location_updated_at: '2026-08-25T05:00:00Z' };

describe('getOwnAvailability — table and column access', () => {
  it('queries only rider_availability', async () => {
    const { subject, calls } = repoWith({ read: { data: ONLINE_ROW, error: null } });

    await subject.getOwnAvailability();

    const tables = [...new Set(calls.map((c) => c.table))];
    expect(tables).toEqual(['rider_availability']);
    for (const forbidden of FORBIDDEN_TABLES) {
      expect(tables).not.toContain(forbidden);
    }
  });

  it('selects exactly the fixed projection — never "*", never a superset', async () => {
    const { subject, calls } = repoWith({ read: { data: ONLINE_ROW, error: null } });

    await subject.getOwnAvailability();

    expect(calls[0]?.select).toEqual(['is_online, location_updated_at']);
  });

  it('never selects active_delivery_count, blocked_reason, or either coordinate column', async () => {
    const { subject, calls } = repoWith({ read: { data: ONLINE_ROW, error: null } });

    await subject.getOwnAvailability();

    for (const call of calls) {
      for (const columns of call.select) {
        expect(columns).not.toMatch(/active_delivery_count|blocked_reason|last_lat|last_lng/);
      }
    }
  });

  it('never filters by a rider identity — authorization is the RLS policy alone', async () => {
    const { subject, calls } = repoWith({ read: { data: ONLINE_ROW, error: null } });

    await subject.getOwnAvailability();

    for (const call of calls) {
      expect(Object.keys(call.eq)).not.toContain('rider_id');
      expect(Object.keys(call.eq)).not.toContain('riderId');
      expect(Object.keys(call.eq)).not.toContain('user_id');
    }
  });
});

describe('getOwnAvailability — results', () => {
  it('maps the row to the domain shape', async () => {
    const { subject } = repoWith({ read: { data: ONLINE_ROW, error: null } });

    await expect(subject.getOwnAvailability()).resolves.toEqual({
      isOnline: true,
      locationRecordedAt: '2026-08-25T05:00:00Z',
    });
  });

  it('treats a missing row as offline with no recorded position, not as an error', async () => {
    const { subject } = repoWith({ read: { data: null, error: null } });

    await expect(subject.getOwnAvailability()).resolves.toEqual({
      isOnline: false,
      locationRecordedAt: null,
    });
  });

  it('propagates a read error rather than reporting the rider as offline', async () => {
    const { subject } = repoWith({ read: { data: null, error: { message: 'connection reset' } } });

    await expect(subject.getOwnAvailability()).rejects.toThrow(
      'Rider availability read failed: connection reset',
    );
  });

  it('exposes no money field and no active_delivery_count in the domain shape', async () => {
    const { subject } = repoWith({ read: { data: ONLINE_ROW, error: null } });

    const availability = await subject.getOwnAvailability();

    for (const key of collectKeys(availability)) {
      expect(MONEY_PATTERN.test(key)).toBe(false);
      expect(key).not.toBe('activeDeliveryCount');
      expect(key).not.toBe('active_delivery_count');
      expect(key).not.toBe('blockedReason');
    }
  });
});

describe('setOnline — the write payload is exactly { is_online }', () => {
  it('sends only is_online when going online', async () => {
    const { subject, calls } = repoWith({ update: { data: ONLINE_ROW, error: null } });

    await subject.setOnline(true);

    const payloads = calls.flatMap((c) => c.payloads);
    expect(payloads).toEqual([{ is_online: true }]);
  });

  it('sends only is_online when going offline', async () => {
    const { subject, calls } = repoWith({ update: { data: OFFLINE_ROW, error: null } });

    await subject.setOnline(false);

    expect(calls.flatMap((c) => c.payloads)).toEqual([{ is_online: false }]);
  });

  it('never writes active_delivery_count, last_lat, last_lng, blocked_reason or any other column', async () => {
    const { subject, calls } = repoWith({ update: { data: ONLINE_ROW, error: null } });

    await subject.setOnline(true);

    for (const payload of calls.flatMap((c) => c.payloads)) {
      expect(Object.keys(payload)).toEqual(['is_online']);
      for (const forbidden of FORBIDDEN_WRITE_KEYS) {
        expect(payload).not.toHaveProperty(forbidden);
      }
    }
  });

  it('uses update, never upsert, insert or delete — the grant covers no other verb', async () => {
    const { subject, calls } = repoWith({ update: { data: ONLINE_ROW, error: null } });

    await subject.setOnline(true);

    const ops = calls.flatMap((c) => c.writeOps);
    expect(ops).toEqual(['update']);
    expect(ops).not.toContain('upsert');
    expect(ops).not.toContain('insert');
    expect(ops).not.toContain('delete');
  });
});

describe('setOnline — the guard is in the WHERE clause (ADR-003)', () => {
  it('guards on the previous value of is_online, and on nothing else', async () => {
    const { subject, calls } = repoWith({ update: { data: ONLINE_ROW, error: null } });

    await subject.setOnline(true);

    expect(calls[0]?.eq).toEqual({ is_online: false });
  });

  it('guards the other way round when going offline', async () => {
    const { subject, calls } = repoWith({ update: { data: OFFLINE_ROW, error: null } });

    await subject.setOnline(false);

    expect(calls[0]?.eq).toEqual({ is_online: true });
  });

  it('never adds a rider identity to the guard', async () => {
    const { subject, calls } = repoWith({ update: { data: ONLINE_ROW, error: null } });

    await subject.setOnline(true);

    for (const call of calls) {
      expect(Object.keys(call.eq)).not.toContain('rider_id');
      expect(Object.keys(call.eq)).not.toContain('user_id');
    }
  });
});

describe('setOnline — results and failures', () => {
  it('returns the state the server reports, not the value that was requested', async () => {
    // The server says the position is recorded; the caller never supplied that.
    const { subject } = repoWith({ update: { data: ONLINE_ROW, error: null } });

    await expect(subject.setOnline(true)).resolves.toEqual({
      isOnline: true,
      locationRecordedAt: '2026-08-25T05:00:00Z',
    });
  });

  it('treats a guard that matched nothing, with the row already in the target state, as an idempotent success', async () => {
    const { subject } = repoWith({
      update: { data: null, error: null },
      read: { data: ONLINE_ROW, error: null },
    });

    await expect(subject.setOnline(true)).resolves.toEqual({
      isOnline: true,
      locationRecordedAt: '2026-08-25T05:00:00Z',
    });
  });

  it('throws AvailabilityRowMissingError when the rider has no availability row at all', async () => {
    const { subject } = repoWith({
      update: { data: null, error: null },
      read: { data: null, error: null },
    });

    await expect(subject.setOnline(true)).rejects.toBeInstanceOf(AvailabilityRowMissingError);
  });

  it('throws AvailabilityNotAppliedError rather than reporting a toggle that did not take effect', async () => {
    const { subject } = repoWith({
      update: { data: null, error: null },
      read: { data: OFFLINE_ROW, error: null },
    });

    await expect(subject.setOnline(true)).rejects.toBeInstanceOf(AvailabilityNotAppliedError);
  });

  it('propagates a write error', async () => {
    const { subject } = repoWith({
      update: { data: null, error: { message: 'permission denied for column last_lat' } },
    });

    await expect(subject.setOnline(true)).rejects.toThrow(
      'Rider availability update failed: permission denied for column last_lat',
    );
  });
});
