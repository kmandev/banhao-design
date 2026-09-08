import { ProfileCustomerEmailSource } from './customer-email-source';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * DEC-056 — `ProfileCustomerEmailSource` is the real `profiles.email` read
 * that replaced the placeholder `NoPersistedCustomerEmailSource`. These
 * tests prove it reads the right column, the right way, and nothing else:
 * no Supabase Auth call, no JWT, no synthetic fallback, never a throw.
 */

interface StubResult {
  data: { email: string | null } | null;
  error: { message: string } | null;
}

function stubSupabase(result: StubResult): { supabase: SupabaseService; calls: Array<{ userId: string }> } {
  const calls: Array<{ userId: string }> = [];

  const admin = {
    from(table: string) {
      if (table !== 'profiles') {
        throw new Error(`unexpected table: ${table}`);
      }
      const builder = {
        select: (columns: string) => {
          if (columns !== 'email') {
            throw new Error(`unexpected column selection: ${columns}`);
          }
          return builder;
        },
        eq: (column: string, value: string) => {
          if (column !== 'id') {
            throw new Error(`unexpected filter column: ${column}`);
          }
          calls.push({ userId: value });
          return builder;
        },
        maybeSingle: () => Promise.resolve(result),
      };
      return builder;
    },
  };

  return { supabase: { admin } as unknown as SupabaseService, calls };
}

describe('ProfileCustomerEmailSource.resolve', () => {
  it('returns the persisted email when one is set', async () => {
    const { supabase, calls } = stubSupabase({ data: { email: 'customer@example.com' }, error: null });
    const source = new ProfileCustomerEmailSource(supabase);

    await expect(source.resolve('user-1')).resolves.toBe('customer@example.com');
    expect(calls).toEqual([{ userId: 'user-1' }]);
  });

  it('returns null when the column is NULL — never invents a value', async () => {
    const { supabase } = stubSupabase({ data: { email: null }, error: null });
    const source = new ProfileCustomerEmailSource(supabase);

    await expect(source.resolve('user-1')).resolves.toBeNull();
  });

  it('returns null when no profile row exists — never throws', async () => {
    const { supabase } = stubSupabase({ data: null, error: null });
    const source = new ProfileCustomerEmailSource(supabase);

    await expect(source.resolve('user-1')).resolves.toBeNull();
  });

  it('returns null (fails closed via the caller) on a query error — never throws, never substitutes', async () => {
    const { supabase } = stubSupabase({ data: null, error: { message: 'connection reset' } });
    const source = new ProfileCustomerEmailSource(supabase);

    await expect(source.resolve('user-1')).resolves.toBeNull();
  });

  it('reads by the exact userId it was given — the only input, never derived from Auth/JWT state', async () => {
    const { supabase, calls } = stubSupabase({ data: { email: 'a@example.com' }, error: null });
    const source = new ProfileCustomerEmailSource(supabase);

    await source.resolve('specific-user-id');
    expect(calls).toEqual([{ userId: 'specific-user-id' }]);
  });

  it('queries only the profiles table, only the email column — no Auth API, no cross-table read', async () => {
    // The stub itself throws on any table other than 'profiles' or any
    // column other than 'email' (see stubSupabase above) — resolving
    // without throwing is the assertion.
    const { supabase } = stubSupabase({ data: { email: 'a@example.com' }, error: null });
    const source = new ProfileCustomerEmailSource(supabase);

    await expect(source.resolve('user-1')).resolves.toBe('a@example.com');
  });
});
