import { UsersService } from './users.service';
import { DomainError } from '../../common/errors/domain-error';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * `UsersService` had no dedicated spec before DEC-056 (its behaviour was
 * exercised indirectly through `auth.controller.spec.ts`'s mocks). This adds
 * direct coverage for the new email read/write, following the same stub
 * pattern `addresses.service.spec.ts`/`payments.service.spec.ts` already use.
 */

type Result = { data: unknown; error: { message: string } | null };

interface Recorded {
  op: 'select' | 'update';
  columns?: string;
  eq: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

function supabaseStub(results: Result[]) {
  const calls: Recorded[] = [];
  let index = 0;

  const nextResult = (): Result => results[index++] ?? { data: null, error: null };

  const admin = {
    from(_table: string) {
      const call: Recorded = { op: 'select', eq: {} };
      calls.push(call);

      const builder: Record<string, unknown> = {
        select(columns: string) {
          call.columns = columns;
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
        maybeSingle: () => Promise.resolve(nextResult()),
      };

      return builder;
    },
  };

  return { supabase: { admin } as unknown as SupabaseService, calls };
}

const PROFILE_ROW = {
  id: 'user-1',
  role: 'CUSTOMER',
  phone: '+66812345678',
  display_name: 'นก',
  email: null,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

describe('UsersService.findById — email (DEC-056)', () => {
  it('selects the email column alongside the existing fields', async () => {
    const { supabase, calls } = supabaseStub([{ data: PROFILE_ROW, error: null }]);
    const subject = new UsersService(supabase);

    await subject.findById('user-1');

    expect(calls[0]?.columns).toContain('email');
  });

  it('returns null email for a profile that has never set one', async () => {
    const { supabase } = supabaseStub([{ data: PROFILE_ROW, error: null }]);
    const subject = new UsersService(supabase);

    const profile = await subject.findById('user-1');
    expect(profile?.email).toBeNull();
  });

  it('returns the persisted email once one has been set', async () => {
    const { supabase } = supabaseStub([
      { data: { ...PROFILE_ROW, email: 'customer@example.com' }, error: null },
    ]);
    const subject = new UsersService(supabase);

    const profile = await subject.findById('user-1');
    expect(profile?.email).toBe('customer@example.com');
  });

  it('returns null for a profile that does not exist', async () => {
    const { supabase } = supabaseStub([{ data: null, error: null }]);
    const subject = new UsersService(supabase);

    await expect(subject.findById('missing')).resolves.toBeNull();
  });
});

describe('UsersService.updateEmail (DEC-056)', () => {
  it('writes only the email column, scoped to the given user id', async () => {
    const { supabase, calls } = supabaseStub([
      { data: { ...PROFILE_ROW, email: 'customer@example.com' }, error: null },
    ]);
    const subject = new UsersService(supabase);

    await subject.updateEmail('user-1', 'customer@example.com');

    expect(calls[0]?.op).toBe('update');
    expect(calls[0]?.payload).toEqual({ email: 'customer@example.com' });
    expect(calls[0]?.eq).toEqual({ id: 'user-1' });
  });

  it('returns the persisted profile with the new email', async () => {
    const { supabase } = supabaseStub([
      { data: { ...PROFILE_ROW, email: 'customer@example.com' }, error: null },
    ]);
    const subject = new UsersService(supabase);

    const profile = await subject.updateEmail('user-1', 'customer@example.com');
    expect(profile?.email).toBe('customer@example.com');
  });

  it('returns null when the row to update does not exist', async () => {
    const { supabase } = supabaseStub([{ data: null, error: null }]);
    const subject = new UsersService(supabase);

    await expect(subject.updateEmail('missing', 'customer@example.com')).resolves.toBeNull();
  });

  it('maps a database error to INTERNAL_ERROR rather than reporting success', async () => {
    const { supabase } = supabaseStub([{ data: null, error: { message: 'connection reset' } }]);
    const subject = new UsersService(supabase);

    await expect(subject.updateEmail('user-1', 'customer@example.com')).rejects.toBeInstanceOf(
      DomainError,
    );
  });

  it('never touches role, phone, or id — only the email column is in the payload', async () => {
    const { supabase, calls } = supabaseStub([
      { data: { ...PROFILE_ROW, email: 'customer@example.com' }, error: null },
    ]);
    const subject = new UsersService(supabase);

    await subject.updateEmail('user-1', 'customer@example.com');

    expect(Object.keys(calls[0]?.payload ?? {})).toEqual(['email']);
  });
});
