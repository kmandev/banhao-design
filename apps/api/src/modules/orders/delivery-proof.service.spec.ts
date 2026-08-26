import { DeliveryProofService } from './delivery-proof.service';
import { DomainError } from '../../common/errors/domain-error';
import { POD_RETENTION_DAYS } from '../rider/pod-retention-policy';
import type { AuthenticatedUser } from '../../common/types';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { StorageService } from '../storage/storage.service';

/**
 * `GET /api/v1/orders/:id/delivery-proof` — Plan §8.3, DEC-039's explicitly
 * deferred customer read path.
 *
 * The assertions here are about what this endpoint refuses to leak (a
 * foreign order's existence, the raw object key, the public bucket) as much
 * as about the happy path — see POD-C-06 in the implementation plan.
 */

type Result = { data: unknown; error: { message: string; code?: string } | null };

interface Recorded {
  table: string;
  columns: string;
  eq: Record<string, unknown>;
}

function supabaseStub(results: Result[]) {
  const calls: Recorded[] = [];
  let index = 0;
  const nextResult = (): Result => results[index++] ?? { data: null, error: null };

  const admin = {
    from(table: string) {
      const call: Recorded = { table, columns: '', eq: {} };
      calls.push(call);

      const builder: Record<string, unknown> = {
        select: (columns: string) => {
          call.columns = columns;
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

const CUSTOMER_ID = 'customer-1';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const PROOF_KEY = `deliveries/${ORDER_ID}/proof/abc.jpg`;

function customerUser(id: string = CUSTOMER_ID): AuthenticatedUser {
  return {
    id,
    phone: '+66812345678',
    capabilities: { customer: true, merchant: [], rider: null, platformStaff: null },
  };
}

function orderRow(): Result {
  return { data: { id: ORDER_ID }, error: null };
}

function noOrderRow(): Result {
  return { data: null, error: null };
}

function deliveryRow(overrides: { deliveredAt?: string | null; proofPhotoPath?: string | null } = {}): Result {
  return {
    data: {
      delivered_at: overrides.deliveredAt === undefined ? new Date().toISOString() : overrides.deliveredAt,
      proof_photo_path: overrides.proofPhotoPath === undefined ? PROOF_KEY : overrides.proofPhotoPath,
    },
    error: null,
  };
}

function noDeliveryRow(): Result {
  return { data: null, error: null };
}

function storageStub(options: { objectExists?: boolean } = {}) {
  const existsCalls: { key: string; bucket: string | undefined }[] = [];
  const signedCalls: { key: string; expiry: number | undefined; bucket: string | undefined }[] = [];

  const exists = jest.fn(async (key: string, bucket?: string) => {
    existsCalls.push({ key, bucket });
    return options.objectExists ?? true;
  });

  const getSignedDownloadUrl = jest.fn(async (key: string, expiry?: number, bucket?: string) => {
    signedCalls.push({ key, expiry, bucket });
    return `https://private.example/${key}?signed=1`;
  });

  return {
    storage: { exists, getSignedDownloadUrl } as unknown as StorageService,
    exists,
    getSignedDownloadUrl,
    existsCalls,
    signedCalls,
  };
}

async function expectDomainError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await promise.catch((error: DomainError) => expect(error.code).toBe(code));
}

describe('DeliveryProofService', () => {
  it('own order + valid proof → returns a signed URL response', async () => {
    const deliveredAt = new Date().toISOString();
    const { supabase } = supabaseStub([orderRow(), deliveryRow({ deliveredAt })]);
    const { storage } = storageStub();

    const result = await new DeliveryProofService(supabase, storage).getProof(customerUser(), ORDER_ID);

    expect(result).toEqual({
      photoUrl: `https://private.example/${PROOF_KEY}?signed=1`,
      capturedAt: deliveredAt,
      deliveredAt,
    });
  });

  it('own order + no proof path → returns null', async () => {
    const { supabase } = supabaseStub([orderRow(), deliveryRow({ proofPhotoPath: null })]);
    const { storage } = storageStub();

    const result = await new DeliveryProofService(supabase, storage).getProof(customerUser(), ORDER_ID);

    expect(result).toBeNull();
  });

  it('own order + no delivery row → returns null', async () => {
    const { supabase } = supabaseStub([orderRow(), noDeliveryRow()]);
    const { storage } = storageStub();

    const result = await new DeliveryProofService(supabase, storage).getProof(customerUser(), ORDER_ID);

    expect(result).toBeNull();
  });

  it('own order + R2 object no longer exists → returns null', async () => {
    const { supabase } = supabaseStub([orderRow(), deliveryRow()]);
    const { storage } = storageStub({ objectExists: false });

    const result = await new DeliveryProofService(supabase, storage).getProof(customerUser(), ORDER_ID);

    expect(result).toBeNull();
  });

  it('foreign order → NOT_FOUND, indistinguishable from a missing order', async () => {
    const { supabase } = supabaseStub([noOrderRow()]);
    const { storage } = storageStub();

    await expectDomainError(
      new DeliveryProofService(supabase, storage).getProof(customerUser(), ORDER_ID),
      'NOT_FOUND',
    );
  });

  it('retention-expired proof (past DEC-039’s 90-day window) → returns null and never mints a URL', async () => {
    const longAgo = new Date(Date.now() - (POD_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    const { supabase } = supabaseStub([orderRow(), deliveryRow({ deliveredAt: longAgo })]);
    const { storage, getSignedDownloadUrl, exists } = storageStub();

    const result = await new DeliveryProofService(supabase, storage).getProof(customerUser(), ORDER_ID);

    expect(result).toBeNull();
    expect(getSignedDownloadUrl).not.toHaveBeenCalled();
    expect(exists).not.toHaveBeenCalled();
  });

  it('signs against the PRIVATE bucket, never the public one', async () => {
    const { supabase } = supabaseStub([orderRow(), deliveryRow()]);
    const { storage, existsCalls, signedCalls } = storageStub();

    await new DeliveryProofService(supabase, storage).getProof(customerUser(), ORDER_ID);

    expect(existsCalls[0]?.bucket).toBe('private');
    // `getSignedDownloadUrl` defaults to the private bucket when no bucket
    // argument is passed — asserting the call omits one keeps this test
    // honest about what the service actually does, rather than asserting a
    // literal 'private' the production call never passes.
    expect(signedCalls[0]?.bucket).toBeUndefined();
  });

  it('never returns the raw object key — only a signed URL', async () => {
    const { supabase } = supabaseStub([orderRow(), deliveryRow()]);
    const { storage } = storageStub();

    const result = await new DeliveryProofService(supabase, storage).getProof(customerUser(), ORDER_ID);

    expect(result?.photoUrl).not.toBe(PROOF_KEY);
    expect(result?.photoUrl.startsWith('https://')).toBe(true);
  });

  it('requires ownership before reading the delivery — the order query is scoped to the caller', async () => {
    const { supabase, calls } = supabaseStub([orderRow(), deliveryRow()]);
    const { storage } = storageStub();

    await new DeliveryProofService(supabase, storage).getProof(customerUser(), ORDER_ID);

    expect(calls[0]).toMatchObject({
      table: 'orders',
      eq: { id: ORDER_ID, customer_id: CUSTOMER_ID },
    });
  });

  it('selects only the minimum delivery fields — never rider_id or rider_earning_satang', async () => {
    const { supabase, calls } = supabaseStub([orderRow(), deliveryRow()]);
    const { storage } = storageStub();

    await new DeliveryProofService(supabase, storage).getProof(customerUser(), ORDER_ID);

    const deliveryCall = calls.find((call) => call.table === 'deliveries');
    expect(deliveryCall?.columns).not.toMatch(/rider_id/);
    expect(deliveryCall?.columns).not.toMatch(/rider_earning_satang/);
  });
});
