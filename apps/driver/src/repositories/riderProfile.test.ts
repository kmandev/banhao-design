import type { SupabaseClient } from '@supabase/supabase-js';
import { createRiderProfileRepository } from './riderProfile';
import { UnknownRiderStatusError } from '../data/riderProfileMappers';

/**
 * Phase G, DEC-UX-006 — the approval gate's read path.
 *
 * The gate branches on `riders.status`, so this suite exists to make three
 * things impossible to get wrong quietly: reading the wrong table, adding a
 * client-side identity filter in place of `riders_select_own`, and collapsing
 * a failed read into "not a rider".
 */

type Result = { data: unknown; error: { message: string } | null };

interface Recorded {
  table: string;
  select: string[];
  eq: Record<string, unknown>;
  writeOps: string[];
}

const MONEY_PATTERN = /satang|price|commission|earning|payment_method|ledger|settlement|refund/i;

function supabaseStub(result: Result) {
  const calls: Recorded[] = [];

  const client = {
    from(table: string) {
      const call: Recorded = { table, select: [], eq: {}, writeOps: [] };
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
        maybeSingle: () => Promise.resolve(result),
      };

      return builder;
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

function repoWith(result: Result) {
  const { client, calls } = supabaseStub(result);
  return { subject: createRiderProfileRepository(client), calls };
}

const RIDER_ROW = {
  id: 'rider-1',
  full_name: 'สมชาย ใจดี',
  status: 'APPROVED',
  vehicle_type: 'MOTORCYCLE',
  plate: 'กข 1234',
};

describe('getOwnProfile — table and column access', () => {
  it('queries only riders', async () => {
    const { subject, calls } = repoWith({ data: RIDER_ROW, error: null });

    await subject.getOwnProfile();

    expect([...new Set(calls.map((c) => c.table))]).toEqual(['riders']);
  });

  it('selects exactly the fixed projection', async () => {
    const { subject, calls } = repoWith({ data: RIDER_ROW, error: null });

    await subject.getOwnProfile();

    expect(calls[0]?.select).toEqual(['id, full_name, status, vehicle_type, plate']);
  });

  it('never filters by user_id or rider id — authorization is riders_select_own', async () => {
    const { subject, calls } = repoWith({ data: RIDER_ROW, error: null });

    await subject.getOwnProfile();

    for (const call of calls) {
      expect(Object.keys(call.eq)).toEqual([]);
    }
  });

  it('never writes — rider onboarding is BQ-022 and is not implemented here', async () => {
    const { subject, calls } = repoWith({ data: RIDER_ROW, error: null });

    await subject.getOwnProfile();

    expect(calls.flatMap((c) => c.writeOps)).toEqual([]);
  });

  it('exposes no money field', async () => {
    const { subject } = repoWith({ data: RIDER_ROW, error: null });

    const profile = await subject.getOwnProfile();

    for (const key of Object.keys(profile ?? {})) {
      expect(MONEY_PATTERN.test(key)).toBe(false);
    }
  });
});

describe('getOwnProfile — results', () => {
  it('maps the row to the domain shape', async () => {
    const { subject } = repoWith({ data: RIDER_ROW, error: null });

    await expect(subject.getOwnProfile()).resolves.toEqual({
      riderId: 'rider-1',
      fullName: 'สมชาย ใจดี',
      status: 'APPROVED',
      vehicleType: 'MOTORCYCLE',
      plate: 'กข 1234',
    });
  });

  it('returns null when the signed-in user has no rider record — a real state, not an error', async () => {
    const { subject } = repoWith({ data: null, error: null });

    await expect(subject.getOwnProfile()).resolves.toBeNull();
  });

  it.each([
    'REGISTERED',
    'DOCUMENTS_SUBMITTED',
    'PENDING_APPROVAL',
    'APPROVED',
    'DOCUMENTS_REJECTED',
    'SUSPENDED',
    'DEACTIVATED',
  ])('accepts the deployed CHECK value %s', async (status) => {
    const { subject } = repoWith({ data: { ...RIDER_ROW, status }, error: null });

    await expect(subject.getOwnProfile()).resolves.toMatchObject({ status });
  });
});

describe('getOwnProfile — failures never become approval', () => {
  it('throws on a read error rather than returning null', async () => {
    const { subject } = repoWith({ data: null, error: { message: 'connection reset' } });

    await expect(subject.getOwnProfile()).rejects.toThrow(
      'Rider profile read failed: connection reset',
    );
  });

  it('throws on an unrecognised status rather than defaulting it in either direction', async () => {
    const { subject } = repoWith({ data: { ...RIDER_ROW, status: 'PROBATION' }, error: null });

    await expect(subject.getOwnProfile()).rejects.toBeInstanceOf(UnknownRiderStatusError);
  });
});
