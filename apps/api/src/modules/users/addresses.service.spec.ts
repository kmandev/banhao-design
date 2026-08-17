import { AddressesService } from './addresses.service';
import { DomainError } from '../../common/errors/domain-error';
import type { SupabaseService } from '../../supabase/supabase.service';

type Result = { data: unknown; error: { message: string } | null };

interface Recorded {
  op: 'select' | 'insert' | 'update';
  eq: Record<string, unknown>;
  neq: Record<string, unknown>;
  isNull: string[];
  payload?: Record<string, unknown>;
}

/**
 * Records the filters every statement was built with, so the tests can assert
 * that ownership is actually in the query. A service that returned the right
 * rows from a query missing `user_id` would still be a data leak, and only
 * inspecting the query can tell the difference.
 */
function supabaseStub(results: Result[]) {
  const calls: Recorded[] = [];
  let index = 0;

  const nextResult = (): Result => results[index++] ?? { data: null, error: null };

  const admin = {
    from(_table: string) {
      const call: Recorded = { op: 'select', eq: {}, neq: {}, isNull: [] };
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
        neq(column: string, value: unknown) {
          call.neq[column] = value;
          return builder;
        },
        is(column: string, value: unknown) {
          if (value === null) call.isNull.push(column);
          return builder;
        },
        order: () => builder,
        returns: () => Promise.resolve(nextResult()),
        maybeSingle: () => Promise.resolve(nextResult()),
        // An update with no .select() is still awaited directly.
        then: (resolve: (r: Result) => unknown) => Promise.resolve(nextResult()).then(resolve),
      };

      return builder;
    },
  };

  return { service: { admin } as unknown as SupabaseService, calls };
}

function serviceWith(results: Result[]) {
  const { service, calls } = supabaseStub(results);
  return { subject: new AddressesService(service), calls };
}

const ROW = {
  id: 'a1',
  label: 'บ้าน',
  recipient_name: 'นก',
  recipient_phone: '+66812345678',
  address_line: '88 หมู่ 4 ต.บุณฑริก',
  landmark: 'ตรงข้ามร้านขายยา',
  instructions: null,
  lat: 14.78,
  lng: 105.42,
  is_default: true,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

const VALID_CREATE = {
  recipientName: 'นก',
  recipientPhone: '+66812345678',
  addressLine: '88 หมู่ 4 ต.บุณฑริก',
};

describe('AddressesService — ownership scoping', () => {
  it('lists only the caller’s own active addresses', async () => {
    const { subject, calls } = serviceWith([{ data: [ROW], error: null }]);

    const result = await subject.list('user-42');

    expect(result).toHaveLength(1);
    expect(calls[0]?.eq.user_id).toBe('user-42');
    expect(calls[0]?.isNull).toContain('archived_at');
  });

  it('maps a row to the client shape and never exposes user_id', async () => {
    const { subject } = serviceWith([{ data: [ROW], error: null }]);
    const [address] = await subject.list('user-42');

    expect(address).toEqual({
      id: 'a1',
      label: 'บ้าน',
      recipientName: 'นก',
      recipientPhone: '+66812345678',
      addressLine: '88 หมู่ 4 ต.บุณฑริก',
      landmark: 'ตรงข้ามร้านขายยา',
      instructions: null,
      lat: 14.78,
      lng: 105.42,
      isDefault: true,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    });
    expect(address).not.toHaveProperty('user_id');
  });

  it('stamps user_id from the caller on insert, not from input', async () => {
    const { subject, calls } = serviceWith([{ data: ROW, error: null }]);

    await subject.create('user-42', {
      ...VALID_CREATE,
      // A caller-supplied user id has no route into the payload.
      userId: 'someone-else',
    } as never);

    expect(calls[0]?.payload?.user_id).toBe('user-42');
  });

  it('scopes an update by BOTH address id and user id', async () => {
    const { subject, calls } = serviceWith([{ data: ROW, error: null }]);

    await subject.update('user-42', 'a1', { label: 'ที่ทำงาน' });

    expect(calls[0]?.eq.id).toBe('a1');
    expect(calls[0]?.eq.user_id).toBe('user-42');
    expect(calls[0]?.isNull).toContain('archived_at');
  });

  it('scopes an archive by BOTH address id and user id', async () => {
    const { subject, calls } = serviceWith([{ data: { id: 'a1' }, error: null }]);

    await subject.archive('user-42', 'a1');

    expect(calls[0]?.eq.id).toBe('a1');
    expect(calls[0]?.eq.user_id).toBe('user-42');
  });

  it('cannot update another user’s address — no row matches, so 404', async () => {
    const { subject } = serviceWith([{ data: null, error: null }]);
    await expect(subject.update('attacker', 'victim-address', { label: 'x' })).rejects.toThrow(
      DomainError,
    );
  });

  it('cannot archive another user’s address — no row matches, so 404', async () => {
    const { subject } = serviceWith([{ data: null, error: null }]);
    await expect(subject.archive('attacker', 'victim-address')).rejects.toThrow(DomainError);
  });

  it('reports a foreign address as NOT_FOUND, never revealing that it exists', async () => {
    const { subject } = serviceWith([{ data: null, error: null }]);
    try {
      await subject.update('attacker', 'victim-address', { label: 'x' });
      fail('expected DomainError');
    } catch (error) {
      expect((error as DomainError).code).toBe('NOT_FOUND');
    }
  });
});

describe('AddressesService — deletion is an archive', () => {
  it('sets archived_at rather than issuing a delete', async () => {
    const { subject, calls } = serviceWith([{ data: { id: 'a1' }, error: null }]);

    await subject.archive('user-42', 'a1');

    // The database has no DELETE grant on this table at all (migration
    // 20260811000011 §13) — an order snapshots its address, so history must
    // never be rewritable by a removal.
    expect(calls[0]?.op).toBe('update');
    expect(calls[0]?.payload).toHaveProperty('archived_at');
  });

  it('clears the default flag when archiving, so no default points at a dead row', async () => {
    const { subject, calls } = serviceWith([{ data: { id: 'a1' }, error: null }]);
    await subject.archive('user-42', 'a1');
    expect(calls[0]?.payload?.is_default).toBe(false);
  });
});

describe('AddressesService — default address handling', () => {
  it('clears the previous default BEFORE writing the new one', async () => {
    const { subject, calls } = serviceWith([
      { data: null, error: null }, // clearDefault
      { data: ROW, error: null }, // insert
    ]);

    await subject.create('user-42', { ...VALID_CREATE, isDefault: true });

    // Order matters: the unique partial index permits one default per user, so
    // inserting first would be refused. Clearing first can only ever leave the
    // user with zero defaults, which is recoverable.
    expect(calls[0]?.op).toBe('update');
    expect(calls[0]?.payload?.is_default).toBe(false);
    expect(calls[0]?.eq.user_id).toBe('user-42');
    expect(calls[1]?.op).toBe('insert');
    expect(calls[1]?.payload?.is_default).toBe(true);
  });

  it('does not touch other rows when the new address is not default', async () => {
    const { subject, calls } = serviceWith([{ data: ROW, error: null }]);
    await subject.create('user-42', VALID_CREATE);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.op).toBe('insert');
  });

  it('excludes the row being promoted when clearing defaults', async () => {
    const { subject, calls } = serviceWith([
      { data: null, error: null },
      { data: ROW, error: null },
    ]);

    await subject.update('user-42', 'a1', { isDefault: true });

    // Otherwise re-asserting default on the current default would clear itself.
    expect(calls[0]?.neq.id).toBe('a1');
  });

  it('scopes the default-clearing update to the caller', async () => {
    const { subject, calls } = serviceWith([
      { data: null, error: null },
      { data: ROW, error: null },
    ]);
    await subject.create('user-42', { ...VALID_CREATE, isDefault: true });
    expect(calls[0]?.eq.user_id).toBe('user-42');
  });
});

describe('AddressesService — partial updates', () => {
  it('sends only the fields present in the patch', async () => {
    const { subject, calls } = serviceWith([{ data: ROW, error: null }]);

    await subject.update('user-42', 'a1', { label: 'ที่ทำงาน' });

    expect(calls[0]?.payload).toEqual({ label: 'ที่ทำงาน' });
  });

  it('writes an explicit null when a nullable field is cleared', async () => {
    const { subject, calls } = serviceWith([{ data: ROW, error: null }]);
    await subject.update('user-42', 'a1', { landmark: null });
    expect(calls[0]?.payload).toEqual({ landmark: null });
  });
});

describe('AddressesService — failure handling', () => {
  it.each([
    ['list', (s: AddressesService) => s.list('u1')],
    ['create', (s: AddressesService) => s.create('u1', VALID_CREATE)],
    ['update', (s: AddressesService) => s.update('u1', 'a1', { label: 'x' })],
    ['archive', (s: AddressesService) => s.archive('u1', 'a1')],
  ])('throws rather than reporting success when %s fails', async (_label, run) => {
    const { subject } = serviceWith([{ data: null, error: { message: 'connection reset' } }]);
    await expect(run(subject)).rejects.toBeInstanceOf(DomainError);
  });

  it('throws when an insert reports success but returns no row', async () => {
    const { subject } = serviceWith([{ data: null, error: null }]);
    await expect(subject.create('u1', VALID_CREATE)).rejects.toBeInstanceOf(DomainError);
  });
});
