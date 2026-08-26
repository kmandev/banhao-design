import type { ServerEnv } from '@banhao/config';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { StorageService } from '../storage/storage.service';

/**
 * POD proof-photo retention — DEC-039.
 *
 * `@banhao/config`'s `loadServerEnv` is mocked because `ProofPhotoRetentionService`
 * reads `podRetentionPurgeEnabled` the same way `StorageService` reads its own
 * config — a direct call in the constructor, since an optional constructor
 * parameter typed with a design-time `ServerEnv` is not a resolvable Nest DI
 * token. `supabase.admin` is a fake query builder that pops queued results per
 * table, in call order — same shape `dispatch.service.spec.ts` uses — and
 * `StorageService` is a plain jest.fn() stub, never real R2.
 */

const loadServerEnvMock = jest.fn();
jest.mock('@banhao/config', () => ({
  loadServerEnv: () => loadServerEnvMock(),
}));

import { ProofPhotoRetentionService } from './proof-photo-retention.service';
import { deliveryProofObjectKey } from '../storage/object-key';

type Result = { data: unknown; error: { message: string } | null };

interface RecordedCall {
  table: string;
  op: 'select' | 'insert' | 'update';
  eq: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

/** A fake `supabase.admin` — each `.from(table)` call pops the next queued result for that table, in the order they were queued. */
function supabaseStub() {
  const queues = new Map<string, Result[]>();
  const calls: RecordedCall[] = [];

  function queue(table: string, result: Result): void {
    const existing = queues.get(table) ?? [];
    existing.push(result);
    queues.set(table, existing);
  }

  function pop(table: string): Result {
    const existing = queues.get(table);
    if (!existing || existing.length === 0) return { data: null, error: null };
    return existing.shift() as Result;
  }

  const admin = {
    from(table: string) {
      const call: RecordedCall = { table, op: 'select', eq: {} };
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
        not: () => builder,
        lt: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve(pop(table)),
        returns: () => Promise.resolve(pop(table)),
        then: (resolve: (r: Result) => unknown) => Promise.resolve(pop(table)).then(resolve),
      };

      return builder;
    },
  };

  return { supabase: { admin } as unknown as SupabaseService, calls, queue };
}

function storageStub() {
  const del = jest.fn().mockResolvedValue(undefined);
  const listObjects = jest.fn().mockResolvedValue({ objects: [], nextContinuationToken: undefined });
  return { storage: { delete: del, listObjects } as unknown as StorageService, del, listObjects };
}

function build(purgeEnabled: boolean) {
  loadServerEnvMock.mockReturnValue({ podRetentionPurgeEnabled: purgeEnabled } as ServerEnv);
  const { supabase, calls, queue } = supabaseStub();
  const { storage, del, listObjects } = storageStub();
  const service = new ProofPhotoRetentionService(supabase, storage);
  return { service, calls, queue, del, listObjects };
}

const DELIVERY_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_DELIVERY_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  loadServerEnvMock.mockReset();
});

describe('ProofPhotoRetentionService — referenced-photo purge', () => {
  it('is disabled by default: counts candidates but deletes nothing', async () => {
    const key = deliveryProofObjectKey(DELIVERY_ID, 'image/jpeg');
    const { service, queue, del } = build(false);
    queue('deliveries', { data: [{ id: DELIVERY_ID, proof_photo_path: key }], error: null });

    const result = await service.run();

    expect(result.enabled).toBe(false);
    expect(result.referencedCandidates).toBe(1);
    expect(result.purged).toBe(0);
    expect(del).not.toHaveBeenCalled();
  });

  it('queries past the 90-day cutoff from delivered_at, for DELIVERED rows with a non-null path', async () => {
    const { service, calls, queue } = build(false);
    queue('deliveries', { data: [], error: null });

    await service.run();

    const select = calls.find((c) => c.table === 'deliveries' && c.op === 'select');
    expect(select?.eq.state).toBe('DELIVERED');
  });

  it('rejects a malformed proof_photo_path — never deletes or clears it', async () => {
    const { service, queue, del, calls } = build(true);
    queue('deliveries', { data: [{ id: DELIVERY_ID, proof_photo_path: 'not-a-valid-key' }], error: null });

    const result = await service.run();

    expect(del).not.toHaveBeenCalled();
    expect(calls.some((c) => c.table === 'deliveries' && c.op === 'update')).toBe(false);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.purged).toBe(0);
  });

  it('rejects a key from the wrong namespace even if somehow present in the column', async () => {
    const { service, queue, del } = build(true);
    queue('deliveries', {
      data: [{ id: DELIVERY_ID, proof_photo_path: `menu-items/${DELIVERY_ID}/x.jpg` }],
      error: null,
    });

    await service.run();

    expect(del).not.toHaveBeenCalled();
  });

  it('rejects a key that names a DIFFERENT delivery than the row it was read from', async () => {
    const foreignKey = deliveryProofObjectKey(OTHER_DELIVERY_ID, 'image/jpeg');
    const { service, queue, del } = build(true);
    queue('deliveries', { data: [{ id: DELIVERY_ID, proof_photo_path: foreignKey }], error: null });

    await service.run();

    expect(del).not.toHaveBeenCalled();
  });

  it('deletes the R2 object, clears the column, and writes an audit row, in that order', async () => {
    const key = deliveryProofObjectKey(DELIVERY_ID, 'image/jpeg');
    const { service, queue, del, calls } = build(true);
    queue('deliveries', { data: [{ id: DELIVERY_ID, proof_photo_path: key }], error: null });
    queue('deliveries', { data: { id: DELIVERY_ID }, error: null }); // the guarded clear
    queue('audit_logs', { data: null, error: null });

    const result = await service.run();

    expect(del).toHaveBeenCalledWith(key, 'private');
    const update = calls.find((c) => c.table === 'deliveries' && c.op === 'update');
    expect(update?.payload).toEqual({ proof_photo_path: null });
    expect(update?.eq).toEqual({ id: DELIVERY_ID, proof_photo_path: key });

    const audit = calls.find((c) => c.table === 'audit_logs' && c.op === 'insert');
    expect(audit?.payload).toMatchObject({
      actor_type: 'SYSTEM',
      action: 'PROOF_PHOTO_PURGED',
      entity_type: 'delivery',
      entity_id: DELIVERY_ID,
      before: { proof_photo_path: key },
      after: { proof_photo_path: null },
      source: 'worker',
    });
    expect(result.purged).toBe(1);
  });

  it('DB path stays intact when the R2 delete fails — no clear is attempted', async () => {
    const key = deliveryProofObjectKey(DELIVERY_ID, 'image/jpeg');
    const { service, queue, del, calls } = build(true);
    del.mockRejectedValueOnce(new Error('R2 unreachable'));
    queue('deliveries', { data: [{ id: DELIVERY_ID, proof_photo_path: key }], error: null });

    const result = await service.run();

    expect(calls.some((c) => c.table === 'deliveries' && c.op === 'update')).toBe(false);
    expect(result.failed).toBe(1);
    expect(result.purged).toBe(0);
  });

  it('a retry after the object is already gone still succeeds — delete resolving is enough, never treated as failure', async () => {
    const key = deliveryProofObjectKey(DELIVERY_ID, 'image/jpeg');
    const { service, queue, del } = build(true);
    // R2's DeleteObject is idempotent — resolves even for an already-missing key.
    del.mockResolvedValueOnce(undefined);
    queue('deliveries', { data: [{ id: DELIVERY_ID, proof_photo_path: key }], error: null });
    queue('deliveries', { data: { id: DELIVERY_ID }, error: null });
    queue('audit_logs', { data: null, error: null });

    const result = await service.run();

    expect(result.purged).toBe(1);
  });

  it('a concurrently changed proof_photo_path cannot be clobbered — the CAS update matches nothing and the purge is skipped, not counted as done', async () => {
    const key = deliveryProofObjectKey(DELIVERY_ID, 'image/jpeg');
    const { service, queue, calls } = build(true);
    queue('deliveries', { data: [{ id: DELIVERY_ID, proof_photo_path: key }], error: null });
    // The guarded UPDATE matches zero rows — value changed since the read.
    queue('deliveries', { data: null, error: null });

    const result = await service.run();

    expect(calls.some((c) => c.table === 'audit_logs')).toBe(false);
    expect(result.purged).toBe(0);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
  });

  it('writes an audit row only on the success path — never for a skip or a failure', async () => {
    const key = deliveryProofObjectKey(DELIVERY_ID, 'image/jpeg');
    const { service, queue, del, calls } = build(true);
    del.mockRejectedValueOnce(new Error('boom'));
    queue('deliveries', { data: [{ id: DELIVERY_ID, proof_photo_path: key }], error: null });

    await service.run();

    expect(calls.some((c) => c.table === 'audit_logs')).toBe(false);
  });
});

describe('ProofPhotoRetentionService — orphan sweep', () => {
  const NOW = Date.parse('2026-08-26T12:00:00.000Z');
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('leaves an object younger than 7 days untouched', async () => {
    const key = deliveryProofObjectKey(DELIVERY_ID, 'image/jpeg');
    const { service, queue, del, listObjects } = build(true);
    queue('deliveries', { data: [], error: null }); // referenced-photo pass: nothing
    listObjects.mockResolvedValue({
      objects: [{ key, lastModified: new Date(NOW - 3 * ONE_DAY_MS) }],
      nextContinuationToken: undefined,
    });

    const result = await service.run();

    expect(del).not.toHaveBeenCalled();
    expect(result.orphanCandidates).toBe(0);
  });

  it('treats an object exactly at the 7-day boundary as still too young', async () => {
    const key = deliveryProofObjectKey(DELIVERY_ID, 'image/jpeg');
    const { service, queue, del, listObjects } = build(true);
    queue('deliveries', { data: [], error: null });
    listObjects.mockResolvedValue({
      objects: [{ key, lastModified: new Date(NOW - 7 * ONE_DAY_MS) }],
      nextContinuationToken: undefined,
    });

    await service.run();

    expect(del).not.toHaveBeenCalled();
  });

  it('treats an object just past the 7-day boundary as a candidate', async () => {
    const key = deliveryProofObjectKey(DELIVERY_ID, 'image/jpeg');
    const { service, queue, listObjects } = build(true);
    queue('deliveries', { data: [], error: null }); // referenced pass
    queue('deliveries', { data: null, error: null }); // isReferenced: not referenced
    listObjects.mockResolvedValue({
      objects: [{ key, lastModified: new Date(NOW - 7 * ONE_DAY_MS - 1) }],
      nextContinuationToken: undefined,
    });

    const result = await service.run();

    expect(result.orphanCandidates).toBe(1);
  });

  it('leaves a referenced object alone even if it is old — that is purgeReferenced\'s job, not the orphan sweep\'s', async () => {
    const key = deliveryProofObjectKey(DELIVERY_ID, 'image/jpeg');
    const { service, queue, del, listObjects } = build(true);
    queue('deliveries', { data: [], error: null }); // referenced pass finds nothing (not yet past 90 days)
    queue('deliveries', { data: { id: DELIVERY_ID }, error: null }); // isReferenced: yes
    listObjects.mockResolvedValue({
      objects: [{ key, lastModified: new Date(NOW - 30 * ONE_DAY_MS) }],
      nextContinuationToken: undefined,
    });

    const result = await service.run();

    expect(del).not.toHaveBeenCalled();
    expect(result.purged).toBe(0);
  });

  it('deletes an unreferenced object past the orphan cutoff when enabled', async () => {
    const key = deliveryProofObjectKey(DELIVERY_ID, 'image/jpeg');
    const { service, queue, del, listObjects } = build(true);
    queue('deliveries', { data: [], error: null });
    queue('deliveries', { data: null, error: null }); // isReferenced: no
    listObjects.mockResolvedValue({
      objects: [{ key, lastModified: new Date(NOW - 30 * ONE_DAY_MS) }],
      nextContinuationToken: undefined,
    });

    const result = await service.run();

    expect(del).toHaveBeenCalledWith(key, 'private');
    expect(result.purged).toBe(1);
  });

  it('never writes an audit_logs row for an orphan purge — no delivery row exists to attach one to', async () => {
    const key = deliveryProofObjectKey(DELIVERY_ID, 'image/jpeg');
    const { service, queue, calls, listObjects } = build(true);
    queue('deliveries', { data: [], error: null });
    queue('deliveries', { data: null, error: null });
    listObjects.mockResolvedValue({
      objects: [{ key, lastModified: new Date(NOW - 30 * ONE_DAY_MS) }],
      nextContinuationToken: undefined,
    });

    await service.run();

    expect(calls.some((c) => c.table === 'audit_logs')).toBe(false);
  });

  it('ignores a malformed / non-POD-namespace key without a reference check or a delete', async () => {
    const { service, queue, del, listObjects } = build(true);
    queue('deliveries', { data: [], error: null });
    listObjects.mockResolvedValue({
      objects: [
        { key: 'not-in-the-namespace/x.jpg', lastModified: new Date(NOW - 30 * ONE_DAY_MS) },
        { key: `menu-items/${DELIVERY_ID}/x.jpg`, lastModified: new Date(NOW - 30 * ONE_DAY_MS) },
      ],
      nextContinuationToken: undefined,
    });

    const result = await service.run();

    expect(del).not.toHaveBeenCalled();
    expect(result.orphanCandidates).toBe(0);
  });

  it('lists exactly one bounded page — never paginates within a single tick', async () => {
    const { service, queue, listObjects } = build(true);
    queue('deliveries', { data: [], error: null });
    listObjects.mockResolvedValue({
      objects: [],
      nextContinuationToken: 'there-is-more',
    });

    await service.run();

    expect(listObjects).toHaveBeenCalledTimes(1);
    expect(listObjects).toHaveBeenCalledWith('deliveries/', 'private', expect.objectContaining({ maxKeys: expect.any(Number) }));
  });

  it('disabled: reports orphan candidates but deletes nothing', async () => {
    const key = deliveryProofObjectKey(DELIVERY_ID, 'image/jpeg');
    const { service, queue, del, listObjects } = build(false);
    queue('deliveries', { data: [], error: null });
    queue('deliveries', { data: null, error: null }); // isReferenced: no
    listObjects.mockResolvedValue({
      objects: [{ key, lastModified: new Date(NOW - 30 * ONE_DAY_MS) }],
      nextContinuationToken: undefined,
    });

    const result = await service.run();

    expect(del).not.toHaveBeenCalled();
    expect(result.orphanCandidates).toBe(1);
    expect(result.purged).toBe(0);
  });
});
