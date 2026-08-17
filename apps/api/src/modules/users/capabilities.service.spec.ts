import { CapabilitiesService, CapabilityResolutionError } from './capabilities.service';
import { hasMerchantAccess } from '../../common/types';
import type { SupabaseService } from '../../supabase/supabase.service';

type Result = { data: unknown; error: { message: string } | null };

/**
 * Minimal stand-in for the Supabase query builder.
 *
 * Records the filters each table was queried with, so the tests can assert the
 * *query* is right — `revoked_at is null`, `status = 'APPROVED'` — rather than
 * only that the mapped output looks plausible. A resolver that returned the
 * right shape from the wrong query would still be a security hole.
 */
interface TableCall {
  eq: Record<string, unknown>;
  isNull: string[];
}

function supabaseStub(byTable: Record<string, Result>) {
  const recorded = new Map<string, TableCall>();

  const admin = {
    from(table: string) {
      const call: TableCall = { eq: {}, isNull: [] };
      recorded.set(table, call);
      const builder = {
        select: () => builder,
        eq(column: string, value: unknown) {
          call.eq[column] = value;
          return builder;
        },
        is(column: string, value: unknown) {
          if (value === null) call.isNull.push(column);
          return builder;
        },
        returns: () => Promise.resolve(byTable[table] ?? { data: [], error: null }),
        maybeSingle: () => Promise.resolve(byTable[table] ?? { data: null, error: null }),
      };
      return builder;
    },
  };

  /** Fails loudly if the table was never queried — that would be a real defect. */
  const callsFor = (table: string): TableCall => {
    const call = recorded.get(table);
    if (!call) throw new Error(`Expected a query against "${table}", but none was made`);
    return call;
  };

  return { service: { admin } as unknown as SupabaseService, callsFor };
}

const ok = { data: null, error: null };
const okList = { data: [], error: null };

function serviceWith(byTable: Record<string, Result>) {
  const { service, callsFor } = supabaseStub(byTable);
  return { subject: new CapabilitiesService(service), callsFor };
}

describe('CapabilitiesService', () => {
  it('resolves a pure customer: customer true, nothing else', async () => {
    const { subject } = serviceWith({
      restaurant_members: okList,
      riders: ok,
      platform_staff: ok,
    });

    await expect(subject.resolve('u1')).resolves.toEqual({
      customer: true,
      merchant: [],
      rider: null,
      platformStaff: null,
    });
  });

  it('resolves an active merchant membership with its restaurant scope', async () => {
    const { subject } = serviceWith({
      restaurant_members: {
        data: [{ restaurant_id: 'rest-1', member_role: 'OWNER' }],
        error: null,
      },
      riders: ok,
      platform_staff: ok,
    });

    const result = await subject.resolve('u1');
    expect(result.merchant).toEqual([{ restaurantId: 'rest-1', memberRole: 'OWNER' }]);
  });

  it('resolves multiple active memberships', async () => {
    const { subject } = serviceWith({
      restaurant_members: {
        data: [
          { restaurant_id: 'rest-1', member_role: 'OWNER' },
          { restaurant_id: 'rest-2', member_role: 'STAFF' },
        ],
        error: null,
      },
      riders: ok,
      platform_staff: ok,
    });

    const result = await subject.resolve('u1');
    expect(result.merchant).toHaveLength(2);
    expect(result.merchant.map((m) => m.restaurantId)).toEqual(['rest-1', 'rest-2']);
  });

  it('excludes revoked memberships by filtering revoked_at is null in the query', async () => {
    const { subject, callsFor } = serviceWith({
      restaurant_members: okList,
      riders: ok,
      platform_staff: ok,
    });

    await subject.resolve('u1');
    expect(callsFor('restaurant_members').isNull).toContain('revoked_at');
    expect(callsFor('restaurant_members').eq.user_id).toBe('u1');
  });

  it('resolves an approved rider', async () => {
    const { subject } = serviceWith({
      restaurant_members: okList,
      riders: { data: { id: 'rider-1', status: 'APPROVED' }, error: null },
      platform_staff: ok,
    });

    const result = await subject.resolve('u1');
    expect(result.rider).toEqual({ riderId: 'rider-1' });
  });

  it('grants rider capability only for status APPROVED, so SUSPENDED/DEACTIVATED fail closed', async () => {
    const { subject, callsFor } = serviceWith({
      restaurant_members: okList,
      riders: ok, // no row comes back, because the query filters on APPROVED
      platform_staff: ok,
    });

    const result = await subject.resolve('u1');
    expect(result.rider).toBeNull();
    // The query itself is the guarantee: a SUSPENDED or DEACTIVATED row cannot
    // match, and a future status added to the enum is denied by default.
    expect(callsFor('riders').eq.status).toBe('APPROVED');
    expect(callsFor('riders').eq.user_id).toBe('u1');
  });

  it('resolves active platform staff with its role', async () => {
    const { subject } = serviceWith({
      restaurant_members: okList,
      riders: ok,
      platform_staff: { data: { staff_role: 'ADMIN' }, error: null },
    });

    const result = await subject.resolve('u1');
    expect(result.platformStaff).toEqual({ staffRole: 'ADMIN' });
  });

  it('excludes revoked platform staff by filtering revoked_at is null', async () => {
    const { subject, callsFor } = serviceWith({
      restaurant_members: okList,
      riders: ok,
      platform_staff: ok,
    });

    const result = await subject.resolve('u1');
    expect(result.platformStaff).toBeNull();
    expect(callsFor('platform_staff').isNull).toContain('revoked_at');
  });

  it('denies staff capability on an uninterpretable staff_role rather than trusting it', async () => {
    const { subject } = serviceWith({
      restaurant_members: okList,
      riders: ok,
      platform_staff: { data: { staff_role: 'SUPERUSER' }, error: null },
    });

    const result = await subject.resolve('u1');
    expect(result.platformStaff).toBeNull();
  });

  it('drops a membership with an uninterpretable member_role', async () => {
    const { subject } = serviceWith({
      restaurant_members: {
        data: [
          { restaurant_id: 'rest-1', member_role: 'GOD_MODE' },
          { restaurant_id: 'rest-2', member_role: 'MANAGER' },
        ],
        error: null,
      },
      riders: ok,
      platform_staff: ok,
    });

    const result = await subject.resolve('u1');
    expect(result.merchant).toEqual([{ restaurantId: 'rest-2', memberRole: 'MANAGER' }]);
  });

  it('queries by user_id and never depends on auth.uid(), so it works on the service-role client', async () => {
    const { subject, callsFor } = serviceWith({
      restaurant_members: okList,
      riders: ok,
      platform_staff: ok,
    });

    await subject.resolve('user-42');
    expect(callsFor('restaurant_members').eq.user_id).toBe('user-42');
    expect(callsFor('riders').eq.user_id).toBe('user-42');
    expect(callsFor('platform_staff').eq.user_id).toBe('user-42');
  });

  it('throws rather than reporting "no capabilities" when a read fails', async () => {
    const { subject } = serviceWith({
      restaurant_members: { data: null, error: { message: 'connection reset' } },
      riders: ok,
      platform_staff: ok,
    });

    await expect(subject.resolve('u1')).rejects.toBeInstanceOf(CapabilityResolutionError);
  });

  it('throws when the rider read fails, so a suspended rider is never silently granted', async () => {
    const { subject } = serviceWith({
      restaurant_members: okList,
      riders: { data: null, error: { message: 'timeout' } },
      platform_staff: ok,
    });

    await expect(subject.resolve('u1')).rejects.toBeInstanceOf(CapabilityResolutionError);
  });

  it('throws when the platform_staff read fails', async () => {
    const { subject } = serviceWith({
      restaurant_members: okList,
      riders: ok,
      platform_staff: { data: null, error: { message: 'timeout' } },
    });

    await expect(subject.resolve('u1')).rejects.toBeInstanceOf(CapabilityResolutionError);
  });
});

describe('hasMerchantAccess — restaurant isolation', () => {
  const capabilities = {
    customer: true,
    merchant: [{ restaurantId: 'rest-X', memberRole: 'OWNER' as const }],
    rider: null,
    platformStaff: null,
  };

  it('permits the restaurant the actor is a member of', () => {
    expect(hasMerchantAccess(capabilities, 'rest-X')).toBe(true);
  });

  it('refuses a restaurant the actor is NOT a member of', () => {
    expect(hasMerchantAccess(capabilities, 'rest-Y')).toBe(false);
  });

  it('refuses everything when there is no membership at all', () => {
    expect(hasMerchantAccess({ ...capabilities, merchant: [] }, 'rest-X')).toBe(false);
  });
});
