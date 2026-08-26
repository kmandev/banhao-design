import { Injectable, Logger } from '@nestjs/common';
import { loadServerEnv } from '@banhao/config';
import { SupabaseService } from '../../supabase/supabase.service';
import { StorageService } from '../storage/storage.service';
import { parseAnyDeliveryProofObjectKey, parseDeliveryProofObjectKey } from '../storage/object-key';
import {
  POD_ORPHAN_RETENTION_DAYS,
  POD_ORPHAN_SWEEP_PAGE_SIZE,
  POD_PROOF_OBJECT_PREFIX,
  POD_RETENTION_BATCH_SIZE,
  POD_RETENTION_DAYS,
} from './pod-retention-policy';

/** `deliveries`, the columns the referenced-photo purge needs. */
interface PurgeableDeliveryRow {
  id: string;
  proof_photo_path: string;
}

export interface ProofPhotoRetentionResult {
  /** `POD_RETENTION_PURGE_ENABLED` at the moment this run started. */
  enabled: boolean;
  /** Referenced photos past the 90-day cutoff this run looked at (whether or not deletion is enabled). */
  referencedCandidates: number;
  /** Unreferenced R2 objects past the 7-day cutoff this run looked at (whether or not deletion is enabled). */
  orphanCandidates: number;
  /** Objects actually deleted this run (0 whenever `enabled` is false). */
  purged: number;
  /** Candidates this run declined to touch — malformed key, DB row changed under us, etc. — never a thrown error. */
  skipped: number;
  /** Candidates whose R2 delete or DB update genuinely errored. */
  failed: number;
}

/**
 * POD proof-photo retention — **DEC-039** (resolving Q-012's retention
 * duration; the lawful-basis half of Q-012 stays `LEGAL_REVIEW_REQUIRED` and
 * is untouched by this class — see the decision).
 *
 * Two independent passes, because a `delivered_at` query structurally cannot
 * see the other kind of object that needs to go:
 *
 * 1. **Referenced photos** — `deliveries.proof_photo_path` older than
 *    {@link POD_RETENTION_DAYS}. Deleting one is two steps that must run in
 *    this order: delete the R2 object, *then* clear the column. Reversing the
 *    order risks clearing a live pointer to an object that is still there if
 *    the delete step is ever changed to run after — see `purgeReferenced`.
 * 2. **Orphans** — objects in the private bucket's `deliveries/` namespace
 *    that no `deliveries` row points at (a retake's discarded predecessor, or
 *    an upload nobody ever confirmed), older than
 *    {@link POD_ORPHAN_RETENTION_DAYS}. `DeliveryProofService`'s own header
 *    already names these as an accepted, documented consequence of the
 *    upload pattern — this is the mechanism that stops "accepted" from
 *    meaning "permanent".
 *
 * ## Runs from the tick, like every other scheduled unit of work
 *
 * `TickController` calls {@link run} once per minute, alongside but
 * independently of the payment and dispatch phases — same shape as
 * `PaymentAttemptExpiryService`. Every top-level failure mode (a failed list
 * query, a bad row) is caught and folded into the result rather than thrown,
 * for the same reason `PaymentEventProcessingService.processOne` never
 * throws: one bad row must never abort a tick's other, unrelated work, and a
 * throw here would fail payment processing and dispatch too, since
 * `TickController.handle` awaits all three in sequence with no isolation of
 * its own.
 *
 * ## Default-off, on purpose
 *
 * `POD_RETENTION_PURGE_ENABLED` gates every delete this class can perform.
 * When it is false (the default, including every environment that has never
 * set it), `run()` still does the listing and counting work — so
 * `referencedCandidates`/`orphanCandidates` are a live, always-on report of
 * what a purge *would* touch — but `purged` stays 0 and nothing is deleted.
 * There is deliberately no separate "dry run" flag: the disabled state
 * already produces the report, and adding a second flag would only be a
 * second way to spell the same behaviour.
 */
@Injectable()
export class ProofPhotoRetentionService {
  private readonly logger = new Logger(ProofPhotoRetentionService.name);
  private readonly purgeEnabled: boolean;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly storage: StorageService,
  ) {
    // Matches `StorageService`'s own constructor shape and the reason given
    // there: an optional constructor parameter typed with a design-time
    // TypeScript type is not a resolvable Nest DI token.
    this.purgeEnabled = loadServerEnv().podRetentionPurgeEnabled;
  }

  async run(): Promise<ProofPhotoRetentionResult> {
    const referenced = await this.purgeReferenced();
    const orphans = await this.sweepOrphans();

    return {
      enabled: this.purgeEnabled,
      referencedCandidates: referenced.candidates,
      orphanCandidates: orphans.candidates,
      purged: referenced.purged + orphans.purged,
      skipped: referenced.skipped + orphans.skipped,
      failed: referenced.failed + orphans.failed,
    };
  }

  /**
   * Pass 1 — `deliveries.proof_photo_path` older than
   * {@link POD_RETENTION_DAYS} from `delivered_at`.
   *
   * Bounded to {@link POD_RETENTION_BATCH_SIZE} rows per call, matching
   * `DispatchService`'s and `PaymentAttemptExpiryService`'s own per-tick
   * batch discipline — a large backlog is worked off over several ticks,
   * never in one.
   */
  private async purgeReferenced(): Promise<{
    candidates: number;
    purged: number;
    skipped: number;
    failed: number;
  }> {
    const cutoff = new Date(Date.now() - POD_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: rows, error } = await this.supabase.admin
      .from('deliveries')
      .select('id, proof_photo_path')
      .eq('state', 'DELIVERED')
      .not('proof_photo_path', 'is', null)
      .lt('delivered_at', cutoff)
      .order('delivered_at', { ascending: true })
      .limit(POD_RETENTION_BATCH_SIZE)
      .returns<PurgeableDeliveryRow[]>();

    if (error) {
      this.logger.error(`Failed to list referenced proof photos past retention: ${error.message}`);
      return { candidates: 0, purged: 0, skipped: 0, failed: 0 };
    }

    const candidates = rows ?? [];
    let purged = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of candidates) {
      const outcome = await this.purgeOneReferenced(row);
      if (outcome === 'purged') purged++;
      else if (outcome === 'skipped') skipped++;
      else failed++;
    }

    return { candidates: candidates.length, purged, skipped, failed };
  }

  /**
   * One referenced photo. Never throws — every failure mode is logged and
   * folded into the caller's counters, matching
   * `PaymentEventProcessingService.processOne`'s own contract.
   *
   * Order is load-bearing: the R2 object is deleted **before** the database
   * is touched. `StorageService.delete` on an already-missing key is a
   * successful no-op (R2's `DeleteObject` is idempotent), which is exactly
   * what makes a retried run of this method safe — a delivery whose object
   * was already removed by a prior, interrupted run simply proceeds straight
   * to clearing the column.
   */
  private async purgeOneReferenced(
    row: PurgeableDeliveryRow,
  ): Promise<'purged' | 'skipped' | 'failed'> {
    const key = row.proof_photo_path;

    // Structural sanity before anything touches R2 or the row — a value that
    // isn't shaped like a proof key for this delivery is never deleted or
    // cleared, deliberately: this purge must not become a generic "delete
    // whatever is in this column" primitive.
    if (!parseDeliveryProofObjectKey(key, row.id)) {
      this.logger.warn(
        `deliveries.${row.id}.proof_photo_path is not a valid proof key for this delivery — skipping, not deleting`,
      );
      return 'skipped';
    }

    if (!this.purgeEnabled) {
      // Counted as a candidate by the caller already; nothing more to do.
      return 'skipped';
    }

    try {
      await this.storage.delete(key, 'private');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.logger.error(`R2 delete failed for delivery ${row.id} proof photo, leaving DB row intact: ${message}`);
      return 'failed';
    }

    // The CAS guard: only clear the column if it still holds the exact key
    // just deleted. If a concurrent process changed it since the read above,
    // this matches zero rows and the (now-stale) update is silently skipped
    // rather than clobbering whatever is there now.
    const { data: cleared, error: clearError } = await this.supabase.admin
      .from('deliveries')
      .update({ proof_photo_path: null })
      .eq('id', row.id)
      .eq('proof_photo_path', key)
      .select('id')
      .maybeSingle<{ id: string }>();

    if (clearError) {
      this.logger.error(
        `proof_photo_path clear failed for delivery ${row.id} after R2 delete succeeded: ${clearError.message}`,
      );
      return 'failed';
    }

    if (!cleared) {
      this.logger.warn(
        `deliveries.${row.id}.proof_photo_path changed before the retention clear could apply — R2 object was still deleted`,
      );
      return 'skipped';
    }

    await this.writeAuditRecord(row.id, key);
    return 'purged';
  }

  /** DEC-039's audit requirement — one row per successfully purged referenced photo. Never throws; a failed write does not undo the purge that already happened. */
  private async writeAuditRecord(deliveryId: string, key: string): Promise<void> {
    const { error } = await this.supabase.admin.from('audit_logs').insert({
      actor_type: 'SYSTEM',
      actor_id: null,
      action: 'PROOF_PHOTO_PURGED',
      entity_type: 'delivery',
      entity_id: deliveryId,
      before: { proof_photo_path: key },
      after: { proof_photo_path: null },
      reason: `DEC-039 retention policy expiry (${POD_RETENTION_DAYS} days from delivered_at)`,
      source: 'worker',
    });

    if (error) {
      this.logger.error(`audit_logs write failed for purged delivery ${deliveryId} (photo already deleted): ${error.message}`);
    }
  }

  /**
   * Pass 2 — objects in the private bucket's `deliveries/` namespace with no
   * `deliveries` row pointing at them, older than
   * {@link POD_ORPHAN_RETENTION_DAYS}.
   *
   * One page of {@link StorageService.listObjects} per call
   * ({@link POD_ORPHAN_SWEEP_PAGE_SIZE} objects) — bounded by construction,
   * never a paginate-until-exhausted loop. A backlog larger than one page is
   * worked off over multiple ticks.
   *
   * No `audit_logs` row is written for an orphan purge: an orphan has no
   * `deliveries` row, and `audit_logs.entity_id` is `not null` — inventing a
   * fake delivery id to satisfy that constraint would be worse than not
   * recording one. The aggregate count in the returned result and this
   * class's own logging are the record instead (§16 of the Q-012 analysis).
   */
  private async sweepOrphans(): Promise<{
    candidates: number;
    purged: number;
    skipped: number;
    failed: number;
  }> {
    let page: Awaited<ReturnType<StorageService['listObjects']>>;
    try {
      page = await this.storage.listObjects(POD_PROOF_OBJECT_PREFIX, 'private', {
        maxKeys: POD_ORPHAN_SWEEP_PAGE_SIZE,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.logger.error(`Failed to list POD objects for the orphan sweep: ${message}`);
      return { candidates: 0, purged: 0, skipped: 0, failed: 0 };
    }

    const cutoffMs = Date.now() - POD_ORPHAN_RETENTION_DAYS * 24 * 60 * 60 * 1000;

    let candidates = 0;
    let purged = 0;
    let skipped = 0;
    let failed = 0;

    for (const object of page.objects) {
      // Never touch anything that isn't structurally a POD proof key, even
      // though the prefix already scopes the listing — defence in depth,
      // matching `StorageService.assertSafeObjectKey`'s own "check again
      // anyway" discipline.
      const parsed = parseAnyDeliveryProofObjectKey(object.key);
      if (!parsed) {
        skipped++;
        continue;
      }

      if (!object.lastModified || object.lastModified.getTime() >= cutoffMs) {
        // Too young to be a purge candidate at all — not counted, not logged.
        continue;
      }

      candidates++;

      const referenced = await this.isReferenced(object.key);
      if (referenced === 'error') {
        failed++;
        continue;
      }
      if (referenced === 'yes') {
        // Not an orphan — it belongs to a delivery. `purgeReferenced` is the
        // pass responsible for it once it also clears the 90-day bar.
        skipped++;
        continue;
      }

      if (!this.purgeEnabled) {
        skipped++;
        continue;
      }

      try {
        await this.storage.delete(object.key, 'private');
        purged++;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        this.logger.error(`R2 delete failed for orphan proof object ${object.key}: ${message}`);
        failed++;
      }
    }

    return { candidates, purged, skipped, failed };
  }

  private async isReferenced(key: string): Promise<'yes' | 'no' | 'error'> {
    const { data, error } = await this.supabase.admin
      .from('deliveries')
      .select('id')
      .eq('proof_photo_path', key)
      .maybeSingle<{ id: string }>();

    if (error) {
      this.logger.error(`Reference check failed for candidate orphan ${key}: ${error.message}`);
      return 'error';
    }

    return data ? 'yes' : 'no';
  }
}
