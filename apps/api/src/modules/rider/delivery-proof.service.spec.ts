import { DeliveryProofService } from './delivery-proof.service';
import { DomainError } from '../../common/errors/domain-error';
import { parseDeliveryProofObjectKey } from '../storage/object-key';
import type { AuthenticatedUser } from '../../common/types';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { StorageService } from '../storage/storage.service';

/**
 * `POST /api/v1/rider/deliveries/:id/proof/upload-url` — POD, Phase G-7.2
 * Phase 2.
 *
 * The assertions here are about what a presign **authorizes**, not merely that
 * one was issued: which bucket it targets, that the key is server-templated
 * rather than accepted from the caller, and that it is refused for a delivery
 * the caller does not own or that is in the wrong state.
 */

type Result = { data: unknown; error: { message: string; code?: string } | null };

interface Recorded {
  table: string;
  eq: Record<string, unknown>;
}

function supabaseStub(results: Result[]) {
  const calls: Recorded[] = [];
  let index = 0;
  const nextResult = (): Result => results[index++] ?? { data: null, error: null };

  const admin = {
    from(table: string) {
      const call: Recorded = { table, eq: {} };
      calls.push(call);

      const builder: Record<string, unknown> = {
        select: () => builder,
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

const RIDER_ID = 'rider-1';
const OTHER_RIDER_ID = 'rider-2';
const DELIVERY_ID = '11111111-1111-4111-8111-111111111111';

function riderUser(riderId: string | null = RIDER_ID): AuthenticatedUser {
  return {
    id: 'user-1',
    phone: '+66812345678',
    capabilities: {
      customer: true,
      merchant: [],
      rider: riderId ? { riderId } : null,
      platformStaff: null,
    },
  };
}

function deliveryRow(state: string, riderId: string | null = RIDER_ID): Result {
  return { data: { id: DELIVERY_ID, state, rider_id: riderId }, error: null };
}

interface SignedCall {
  key: string;
  contentType: string;
  expiry: number | undefined;
  bucket: string | undefined;
}

function storageStub() {
  const signed: SignedCall[] = [];
  const getSignedUploadUrl = jest.fn(
    async (key: string, contentType: string, expiry?: number, bucket?: string) => {
      signed.push({ key, contentType, expiry, bucket });
      return `https://private.example/${key}?signed=1`;
    },
  );

  return { storage: { getSignedUploadUrl } as unknown as StorageService, signed, getSignedUploadUrl };
}

async function expectDomainError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await promise.catch((error: DomainError) => expect(error.code).toBe(code));
}

describe('DeliveryProofService — issuing a proof upload URL', () => {
  it('presigns into the PRIVATE bucket, never the public one', async () => {
    const { supabase } = supabaseStub([deliveryRow('EN_ROUTE')]);
    const { storage, signed } = storageStub();

    await new DeliveryProofService(supabase, storage).requestUploadUrl(
      riderUser(),
      DELIVERY_ID,
      'image/jpeg',
    );

    // The public bucket is served by an *.r2.dev URL, so an object there is
    // readable by anyone holding its key.
    expect(signed[0]?.bucket).toBe('private');
  });

  it('templates the object key server-side into the delivery’s own namespace', async () => {
    const { supabase } = supabaseStub([deliveryRow('EN_ROUTE')]);
    const { storage } = storageStub();

    const result = await new DeliveryProofService(supabase, storage).requestUploadUrl(
      riderUser(),
      DELIVERY_ID,
      'image/jpeg',
    );

    // The key must parse as this delivery's own — which is what makes "a rider
    // cannot upload to another rider's delivery" structural.
    expect(parseDeliveryProofObjectKey(result.objectKey, DELIVERY_ID)).toEqual({
      deliveryId: DELIVERY_ID,
      mimeType: 'image/jpeg',
    });
    expect(result.objectKey.startsWith(`deliveries/${DELIVERY_ID}/proof/`)).toBe(true);
  });

  it('scopes the signed URL to the one content type it was asked for', async () => {
    const { supabase } = supabaseStub([deliveryRow('EN_ROUTE')]);
    const { storage, signed } = storageStub();

    await new DeliveryProofService(supabase, storage).requestUploadUrl(
      riderUser(),
      DELIVERY_ID,
      'image/webp',
    );

    expect(signed[0]?.contentType).toBe('image/webp');
    expect(signed[0]?.key.endsWith('.webp')).toBe(true);
  });

  it('mints a DIFFERENT key on every call, so a retake never overwrites the previous object', async () => {
    const { supabase } = supabaseStub([deliveryRow('EN_ROUTE'), deliveryRow('EN_ROUTE')]);
    const { storage } = storageStub();
    const service = new DeliveryProofService(supabase, storage);

    const first = await service.requestUploadUrl(riderUser(), DELIVERY_ID, 'image/jpeg');
    const second = await service.requestUploadUrl(riderUser(), DELIVERY_ID, 'image/jpeg');

    expect(first.objectKey).not.toBe(second.objectKey);
  });

  it('writes nothing — a presign is an authorization, not a record', async () => {
    const { supabase, calls } = supabaseStub([deliveryRow('EN_ROUTE')]);
    const { storage } = storageStub();

    await new DeliveryProofService(supabase, storage).requestUploadUrl(
      riderUser(),
      DELIVERY_ID,
      'image/jpeg',
    );

    // One read to authorize, and nothing else. A rider who requests ten
    // presigns and uploads nothing leaves no state behind.
    expect(calls).toEqual([{ table: 'deliveries', eq: { id: DELIVERY_ID } }]);
  });
});

describe('DeliveryProofService — refusals', () => {
  it('refuses a caller with no rider capability, before any read', async () => {
    const { supabase, calls } = supabaseStub([]);
    const { storage, getSignedUploadUrl } = storageStub();

    await expectDomainError(
      new DeliveryProofService(supabase, storage).requestUploadUrl(
        riderUser(null),
        DELIVERY_ID,
        'image/jpeg',
      ),
      'FORBIDDEN',
    );
    expect(calls).toHaveLength(0);
    expect(getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('refuses a delivery assigned to another rider, and issues no URL', async () => {
    const { supabase } = supabaseStub([deliveryRow('EN_ROUTE', OTHER_RIDER_ID)]);
    const { storage, getSignedUploadUrl } = storageStub();

    await expectDomainError(
      new DeliveryProofService(supabase, storage).requestUploadUrl(
        riderUser(),
        DELIVERY_ID,
        'image/jpeg',
      ),
      'NOT_ASSIGNED_RIDER',
    );
    expect(getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('gives a missing delivery the SAME error as a foreign one', async () => {
    const { supabase } = supabaseStub([{ data: null, error: null }]);
    const { storage } = storageStub();

    // A rider must not be able to learn whether an id names a real delivery.
    await expectDomainError(
      new DeliveryProofService(supabase, storage).requestUploadUrl(
        riderUser(),
        DELIVERY_ID,
        'image/jpeg',
      ),
      'NOT_ASSIGNED_RIDER',
    );
  });

  it.each(['RIDER_ASSIGNED', 'AT_MERCHANT', 'PICKED_UP', 'DELIVERED', 'FAILED'])(
    'refuses a delivery in %s — a proof photo belongs only to an EN_ROUTE delivery',
    async (state) => {
      const { supabase } = supabaseStub([deliveryRow(state)]);
      const { storage, getSignedUploadUrl } = storageStub();

      await expectDomainError(
        new DeliveryProofService(supabase, storage).requestUploadUrl(
          riderUser(),
          DELIVERY_ID,
          'image/jpeg',
        ),
        'INVALID_TRANSITION',
      );
      // "Upload a photo to a delivery I closed last week" is refused here
      // rather than needing a separate rule at completion time.
      expect(getSignedUploadUrl).not.toHaveBeenCalled();
    },
  );

  it.each(['image/gif', 'application/pdf', 'text/html', 'image/svg+xml'])(
    'refuses the disallowed content type %s',
    async (contentType) => {
      const { supabase } = supabaseStub([deliveryRow('EN_ROUTE')]);
      const { storage, getSignedUploadUrl } = storageStub();

      await expectDomainError(
        new DeliveryProofService(supabase, storage).requestUploadUrl(
          riderUser(),
          DELIVERY_ID,
          contentType,
        ),
        'VALIDATION_FAILED',
      );
      expect(getSignedUploadUrl).not.toHaveBeenCalled();
    },
  );

  it('surfaces a lookup failure as INTERNAL_ERROR, not as a refusal', async () => {
    const { supabase } = supabaseStub([{ data: null, error: { message: 'connection reset' } }]);
    const { storage } = storageStub();

    await expectDomainError(
      new DeliveryProofService(supabase, storage).requestUploadUrl(
        riderUser(),
        DELIVERY_ID,
        'image/jpeg',
      ),
      'INTERNAL_ERROR',
    );
  });
});
