import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { RefundLedgerReversalService } from './refund-ledger-reversal.service';

/** Bounded scan sizes — an operational limit, not a business rule, following `PaymentReconciliationService`'s own precedent (`DEFAULT_PAYMENT_SCAN_LIMIT`/`DEFAULT_ORPHAN_SCAN_LIMIT`) and `payment-event-processing.service.ts`'s `BATCH_SIZE`. No cursor exists (same absence that service documents for itself) — this is the smallest safe first version, not a claim of completeness over an unbounded dataset. */
const IN_FLIGHT_REFUND_SCAN_LIMIT = 50;
const REFUNDED_REFUND_SCAN_LIMIT = 50;
const MISSING_PROVIDER_ID_SCAN_LIMIT = 50;

/** `refunds.state` values DEC-057 §4 never reaches `REFUNDED` from — Q-020 Slice 4 case G (`PROVIDER_LOCAL_STATE_DIVERGENCE`), already handled by `RefundEventProcessingService` via `payment_events.processing_error`. DEC-060 §2 deliberately adds no `reconciliation_cases.kind` for it — this detector must never open one either. */
const CASE_G_BLOCKED_STATES = new Set(['REFUND_FAILED', 'REFUND_REJECTED']);

/** A refund still waiting to hear back from the provider — the candidate set for anomalies A/C (DEC-057 §2/§4). `REFUND_REQUESTED` is excluded: it is the pre-Stripe-call state (no `provider_refund_id` yet, nothing to confirm). */
const IN_FLIGHT_REFUND_STATES = ['REFUND_PENDING', 'REFUND_PROCESSING'];

const REFUND_STATUS_EVENT_TYPE = 'refund.status_reported';

/** One `refunds` row, the columns every phase below needs. */
interface RefundRow {
  id: string;
  payment_id: string;
  state: string;
  amount_satang: number;
  provider: string | null;
  provider_refund_id: string | null;
  updated_at: string;
}

/** `payments`, the columns every phase below needs. */
interface PaymentRow {
  id: string;
  order_id: string;
  amount_satang: number;
  provider_payment_id: string | null;
}

/** `orders`, the columns Anomaly F's ledger verification needs. */
interface OrderRow {
  id: string;
  customer_id: string;
  service_fee_satang: number;
}

/** `payment_events`, the columns a claimed refund-domain row carries. */
interface PaymentEventRow {
  id: string;
  payment_id: string | null;
  raw_payload: unknown;
}

/** `ledger_entry_groups`, the columns Anomaly F's verification needs. */
interface LedgerEntryGroupRow {
  id: string;
  order_id: string | null;
  refund_id: string | null;
  kind: string;
}

/** `ledger_entries`, the columns Anomaly F's verification needs. */
interface LedgerEntryRow {
  group_id: string;
  account: string;
  party_id: string | null;
  amount_satang: number;
}

/** One expected reversal component — the exact shape `RefundLedgerReversalService` itself posts (DEC-059 §G), restated here read-only for independent verification. Never used to write anything — see this file's own class doc comment, "Why this file never writes a ledger row itself". */
interface ExpectedComponent {
  groupKey: string;
  kind: 'CUSTOMER_PAYMENT_REFUND' | 'SERVICE_FEE_REVENUE_REFUND' | 'MERCHANT_COMMISSION_REFUND';
  expectedEntries: Array<{ account: string; partyId: string | null; amountSatang: number }>;
}

/** The six Q-020 refund reconciliation kinds this detector may open (DEC-060 §1). Case G is deliberately absent — DEC-060 §2. */
type RefundReconciliationKind =
  | 'PROVIDER_SUCCEEDED_LOCAL_NOT_REFUNDED'
  | 'LOCAL_REFUNDED_PROVIDER_NOT_CONFIRMED'
  | 'REFUND_AMOUNT_MISMATCH'
  | 'MISSING_PROVIDER_REFUND_ID'
  | 'MISSING_PROVIDER_EVENT'
  | 'REFUNDED_LEDGER_INCOMPLETE';

/** One anomaly phase's outcome — a candidate-scan count plus what happened to each candidate found anomalous. `resolved` is only ever non-zero for {@link RefundReconciliationRunResult.refundedLedgerIncomplete} (Anomaly F) — every other anomaly requires operator/admin investigation and is never auto-resolved (DEC-057 §6, DEC-058). */
export interface AnomalyPhaseResult {
  /** Candidates this phase actually looked at (not the same as how many turned out anomalous). */
  examined: number;
  /** A fresh `reconciliation_cases` row was inserted. */
  opened: number;
  /** An anomaly was found, but an `OPEN`/`IN_PROGRESS` case for it already existed — the unique index (`reconciliation_cases_refund_open_key`) was the concurrency/dedup authority, not a prior read. */
  reused: number;
  /** Anomaly F only — self-heal (via the existing `RefundLedgerReversalService`) verifiably cleared the underlying condition, so the case (freshly opened this run, or a stale one from an earlier run) was marked `RESOLVED`. */
  resolved: number;
}

export interface RefundReconciliationRunResult {
  /** Case A. */
  providerSucceededLocalNotRefunded: AnomalyPhaseResult;
  /** Case B. */
  localRefundedProviderNotConfirmed: AnomalyPhaseResult;
  /** Case C. */
  refundAmountMismatch: AnomalyPhaseResult;
  /** Case D. */
  missingProviderRefundId: AnomalyPhaseResult;
  /** Case E — always zero. See this file's own "Anomaly E" section: no valid staleness boundary exists in this codebase today (DEC-060's own explicit non-decision), so nothing is manufactured. */
  missingProviderEvent: AnomalyPhaseResult;
  /** Case F. */
  refundedLedgerIncomplete: AnomalyPhaseResult;
}

function emptyPhase(): AnomalyPhaseResult {
  return { examined: 0, opened: 0, reused: 0, resolved: 0 };
}

function emptyRunResult(): RefundReconciliationRunResult {
  return {
    providerSucceededLocalNotRefunded: emptyPhase(),
    localRefundedProviderNotConfirmed: emptyPhase(),
    refundAmountMismatch: emptyPhase(),
    missingProviderRefundId: emptyPhase(),
    missingProviderEvent: emptyPhase(),
    refundedLedgerIncomplete: emptyPhase(),
  };
}

/**
 * Q-020 Slice 4B — the reconciliation detector + safe recovery engine
 * DEC-060's schema unblocked. Runs from `POST /internal/tick`, exactly like
 * every sibling phase in this file's own module (`RefundEventProcessingService`,
 * `PaymentAttemptExpiryService`) — no second scheduler, no cron, no new
 * worker architecture (the mission's own explicit scope boundary).
 *
 * ## What this closes
 *
 * DEC-057 §6 requires refund reconciliation to detect five conditions before
 * a refund can move real money in production: provider-succeeded-but-local-
 * not-refunded, local-refunded-but-not-provider-confirmed, an amount
 * disagreement, a missing `provider_refund_id`, and a webhook that never
 * arrived. DEC-060 supplied the schema (six `reconciliation_cases.kind`
 * values, `reconciliation_cases_refund_open_key`); this file is what
 * populates it. Every detection here reads **persisted evidence already in
 * `payment_events`/`refunds`/`ledger_entry_groups`/`ledger_entries`** — never
 * a synchronous Stripe re-fetch, never a new provider call (Stripe finality
 * was already established, or not, by `RefundEventProcessingService`, Slice
 * 2; this file only re-inspects what that already recorded, state-at-rest).
 *
 * ## Case dedup — the DB unique index is the sole authority, never a prior read
 *
 * {@link insertOrReuseCase} is the one place every phase below creates a
 * case: `INSERT` first, and on a `23505` conflict against
 * `reconciliation_cases_refund_open_key`, read back the existing
 * `OPEN`/`IN_PROGRESS` row. This is the exact insert-first/read-back shape
 * `RefundService.createOrReuseRefund` and `RefundLedgerReversalService`'s own
 * `postIndependentGroup` already use (ADR-003 — the guarded write is the
 * concurrency authority, never a prior `SELECT`). Detecting the same anomaly
 * every tick, or from two genuinely concurrent tick invocations, produces
 * exactly one active case — the index enforces it, this file only reacts to
 * the outcome.
 *
 * ## Case F self-heal — reuses Slice 3, never a second ledger writer
 *
 * {@link reconcileRefundedRefunds} independently *verifies* ledger
 * completeness (read-only — `verifyExpectedComponents` never issues an
 * `INSERT`/`UPDATE`/`DELETE`), so detection does not depend on trusting
 * `RefundLedgerReversalService`'s own internal self-heal to have already run.
 * When a genuine gap is found, the only *write* this file ever performs
 * against a ledger table is calling `RefundLedgerReversalService.postReversals`
 * — the exact Slice 3 mechanism, unmodified, called exactly as
 * `RefundEventProcessingService` already calls it. Calling it any number of
 * times for the same refund is safe (its own idempotency), and this file
 * never inserts a `ledger_entry_groups`/`ledger_entries` row itself.
 *
 * ## Authority — mechanical repair only, never a financial override
 *
 * This file never sets `refunds.state`, never writes `provider_refund_id`,
 * never mutates a ledger amount, and never marks a case `RESOLVED` except
 * after re-verifying (Case F) that the exact condition it opened the case
 * for is now mechanically, deterministically true — never because a scan
 * merely ran. Every other anomaly (A/B/C/D) is detection-only: the case
 * stays `OPEN`/`IN_PROGRESS` until an operator/admin resolves it through the
 * existing `POST …/reconciliation-cases/:id/resolve` route
 * (`ReconciliationCaseService`, unchanged by this file). No AI reads or
 * writes anything here (DEC-040) — this is a deterministic tick phase with
 * no agent, no model, no command catalog entry.
 *
 * ## Case G is out of scope, by construction
 *
 * `PROVIDER_LOCAL_STATE_DIVERGENCE` (a provider `SUCCEEDED` event that
 * arrived for a refund already `REFUND_FAILED`/`REFUND_REJECTED`) has no
 * `reconciliation_cases.kind` (DEC-060 §2) and is not this file's concern —
 * {@link CASE_G_BLOCKED_STATES} excludes those two states from every phase
 * below, matching `RefundEventProcessingService`'s own
 * `LEDGER_REVERSAL_BLOCKED_STATES` exactly.
 *
 * ## Anomaly E — a documented, honest limitation, not a manufactured one
 *
 * `MISSING_PROVIDER_EVENT` needs a staleness boundary ("how long is too long
 * since a refund request") to distinguish "genuinely never arriving" from
 * "still in flight." No such boundary exists anywhere in this codebase for
 * refunds — DEC-060's own "Explicit non-decisions" section says so
 * explicitly, citing `PaymentReconciliationService.graceWindowMs`'s identical
 * documented absence for payments. `PaymentAttemptExpiryService`'s TTL is a
 * different domain object (`payment_attempts.expires_at`, a QR checkout
 * timer) with no analogous column or business meaning on `refunds` — reusing
 * it here would be inventing a boundary by borrowing an unrelated one, the
 * exact "aliasing two decisions" this codebase's own Phase J precedent
 * (`merchant-acceptance-policy.ts`) refuses to do. {@link detectMissingProviderEvent}
 * therefore detects nothing and always returns a zeroed phase — this is the
 * mission's own explicitly authorized outcome ("if the current architecture
 * has no valid boundary... do NOT manufacture one — instead document the
 * limitation"), not an oversight. A future decision that sets a staleness
 * constant unblocks this in one place.
 *
 * ## Never throws
 *
 * Same contract every phase sharing `POST /internal/tick` documents on
 * itself (`ArrivalTimeoutEscalationService`, `NoRiderEscalationService`,
 * …) — `TickController` has no per-phase try/catch, so a phase that threw
 * would cost every phase after it in the same invocation. Every read here
 * fails closed (logs, returns an empty candidate set) rather than
 * propagating, and {@link run}'s own outer try/catch is a last-resort net,
 * not the primary defence.
 */
@Injectable()
export class RefundReconciliationDetectorService {
  private readonly logger = new Logger(RefundReconciliationDetectorService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly ledgerReversal: RefundLedgerReversalService,
  ) {}

  async run(): Promise<RefundReconciliationRunResult> {
    try {
      const { a, c } = await this.detectInFlightEvidenceAnomalies();
      const { b, f } = await this.reconcileRefundedRefunds();
      const d = await this.detectMissingProviderRefundId();
      const e = this.detectMissingProviderEvent();

      return {
        providerSucceededLocalNotRefunded: a,
        localRefundedProviderNotConfirmed: b,
        refundAmountMismatch: c,
        missingProviderRefundId: d,
        missingProviderEvent: e,
        refundedLedgerIncomplete: f,
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.logger.error(`refund reconciliation detector run failed, reporting an empty result: ${message}`);
      return emptyRunResult();
    }
  }

  // ---------------------------------------------------------------------
  // Anomalies A + C — a refund still waiting on the provider, but
  // persisted evidence already says the provider called it SUCCEEDED.
  // ---------------------------------------------------------------------

  /**
   * Scans `refunds` in {@link IN_FLIGHT_REFUND_STATES} (never `REFUND_REQUESTED`
   * — no `provider_refund_id` to match on yet) and cross-checks each against
   * already-processed `refund.status_reported` `payment_events` rows for the
   * same `payment_id`. A match (`provider_refund_id` and `provider_payment_id`
   * both agree, and the event's own persisted status is `SUCCEEDED`) proves,
   * by construction, that `RefundEventProcessingService` could not have
   * carried this refund to `REFUNDED` for this event — case G is already
   * excluded (this refund is not `REFUND_FAILED`/`REFUND_REJECTED`), so
   * either the transition genuinely never ran, or some other anomaly
   * (amount, identity) blocked it. This file re-derives that outcome
   * independently rather than trusting `payment_events.processing_error`'s
   * free-text message.
   *
   * Amount agreement (event `amountSatang` vs. `refunds.amount_satang`, the
   * full local refund amount under DEC-057 §1's full-refund-only scope)
   * decides A vs. C. Neither ever mutates `refunds`/`payments`/a ledger row.
   */
  private async detectInFlightEvidenceAnomalies(): Promise<{ a: AnomalyPhaseResult; c: AnomalyPhaseResult }> {
    const a = emptyPhase();
    const c = emptyPhase();

    const candidates = await this.listInFlightRefunds();
    if (candidates.length === 0) {
      return { a, c };
    }

    const paymentIds = [...new Set(candidates.map((r) => r.payment_id))];
    const payments = await this.loadPaymentsByIds(paymentIds);
    const paymentById = new Map(payments.map((p) => [p.id, p]));

    const events = await this.loadProcessedRefundStatusEventsByPaymentIds(paymentIds);
    const eventsByPaymentId = new Map<string, PaymentEventRow[]>();
    for (const event of events) {
      if (!event.payment_id) continue;
      const list = eventsByPaymentId.get(event.payment_id) ?? [];
      list.push(event);
      eventsByPaymentId.set(event.payment_id, list);
    }

    for (const refund of candidates) {
      if (CASE_G_BLOCKED_STATES.has(refund.state)) continue; // defensive — not reachable given IN_FLIGHT_REFUND_STATES, kept for clarity/future-proofing

      const payment = paymentById.get(refund.payment_id);
      if (!payment) continue;

      const candidateEvents = eventsByPaymentId.get(refund.payment_id) ?? [];
      const matched = candidateEvents.find((event) => {
        const providerRefundId = readString(event.raw_payload, 'providerRefundId');
        const providerPaymentId = readString(event.raw_payload, 'providerPaymentId');
        const status = readString(event.raw_payload, 'status');
        return (
          status === 'SUCCEEDED' &&
          providerRefundId !== undefined &&
          providerRefundId === refund.provider_refund_id &&
          providerPaymentId !== undefined &&
          providerPaymentId === payment.provider_payment_id
        );
      });

      if (!matched) continue; // no proof yet — normal in-flight state, not this detector's concern (Anomaly E territory, undetectable — see class doc comment)

      const eventAmount = readAmount(matched.raw_payload, 'amountSatang');
      const isAmountMismatch = eventAmount !== undefined && eventAmount !== refund.amount_satang;

      const target = isAmountMismatch ? c : a;
      const kind: RefundReconciliationKind = isAmountMismatch ? 'REFUND_AMOUNT_MISMATCH' : 'PROVIDER_SUCCEEDED_LOCAL_NOT_REFUNDED';

      target.examined++;
      await this.applyCaseOutcome(target, kind, refund.payment_id, payment.order_id);
    }

    return { a, c };
  }

  // ---------------------------------------------------------------------
  // Anomalies B + F — every REFUNDED refund, checked both for provider
  // confirmation (B) and ledger reversal completeness (F).
  // ---------------------------------------------------------------------

  /**
   * Scans `refunds` in state `REFUNDED` (bounded, oldest-`updated_at`-first
   * so a permanently-anomalous refund never starves the rest of the batch —
   * it simply reoccupies one of {@link REFUNDED_REFUND_SCAN_LIMIT} slots each
   * run rather than blocking any other refund from being examined) and, for
   * each, independently checks:
   *
   * - **B** — does at least one already-processed, provider-matched
   *   `refund.status_reported` event with `status = SUCCEEDED` exist for
   *   this exact refund? If not, `refunds.state = REFUNDED` is a financial
   *   contradiction with no supporting evidence — never auto-resolved
   *   (DEC-057 §6, DEC-058).
   * - **F** — do all three DEC-059 §G reversal components
   *   (`CUSTOMER_PAYMENT_REFUND`, `SERVICE_FEE_REVENUE_REFUND`,
   *   `MERCHANT_COMMISSION_REFUND`) exist, each with the exact expected
   *   group identity, account, party and amount? If not, self-heal is
   *   attempted via the existing `RefundLedgerReversalService.postReversals`
   *   — never a second ledger writer.
   */
  private async reconcileRefundedRefunds(): Promise<{ b: AnomalyPhaseResult; f: AnomalyPhaseResult }> {
    const b = emptyPhase();
    const f = emptyPhase();

    const refunds = await this.listRefundedRefunds();
    if (refunds.length === 0) {
      return { b, f };
    }

    const paymentIds = [...new Set(refunds.map((r) => r.payment_id))];
    const payments = await this.loadPaymentsByIds(paymentIds);
    const paymentById = new Map(payments.map((p) => [p.id, p]));

    const orderIds = [...new Set(payments.map((p) => p.order_id))];
    const orders = await this.loadOrdersByIds(orderIds);
    const orderById = new Map(orders.map((o) => [o.id, o]));

    const events = await this.loadProcessedRefundStatusEventsByPaymentIds(paymentIds);
    const eventsByPaymentId = new Map<string, PaymentEventRow[]>();
    for (const event of events) {
      if (!event.payment_id) continue;
      const list = eventsByPaymentId.get(event.payment_id) ?? [];
      list.push(event);
      eventsByPaymentId.set(event.payment_id, list);
    }

    const originalCommissionByOrderId = await this.loadOriginalCommissionByOrderIds(orderIds);

    const refundIds = refunds.map((r) => r.id);
    const groupsByRefundId = await this.loadLedgerGroupsByRefundIds(refundIds);
    const entriesByGroupId = await this.loadLedgerEntriesByGroupIds(
      [...groupsByRefundId.values()].flat().map((g) => g.id),
    );

    for (const refund of refunds) {
      if (CASE_G_BLOCKED_STATES.has(refund.state)) continue; // defensive — REFUNDED is not in CASE_G_BLOCKED_STATES, kept for clarity

      const payment = paymentById.get(refund.payment_id);
      if (!payment) continue;
      const order = orderById.get(payment.order_id);
      if (!order) continue;

      // --- B ---
      b.examined++;
      const candidateEvents = eventsByPaymentId.get(refund.payment_id) ?? [];
      const confirmed = candidateEvents.some((event) => {
        const providerRefundId = readString(event.raw_payload, 'providerRefundId');
        const providerPaymentId = readString(event.raw_payload, 'providerPaymentId');
        const status = readString(event.raw_payload, 'status');
        return (
          status === 'SUCCEEDED' &&
          providerRefundId !== undefined &&
          providerRefundId === refund.provider_refund_id &&
          providerPaymentId !== undefined &&
          providerPaymentId === payment.provider_payment_id
        );
      });
      if (!confirmed) {
        await this.applyCaseOutcome(b, 'LOCAL_REFUNDED_PROVIDER_NOT_CONFIRMED', refund.payment_id, order.id);
      }

      // --- F ---
      f.examined++;
      const originalCommission = originalCommissionByOrderId.get(order.id) ?? null;
      const expected = buildExpectedComponents(refund.id, payment, order, originalCommission);
      const existingGroups = groupsByRefundId.get(refund.id) ?? [];
      const problems = verifyExpectedComponents(expected, order.id, refund.id, existingGroups, entriesByGroupId);

      if (problems.length === 0) {
        // Already fully, correctly posted — resolve any stale OPEN/IN_PROGRESS
        // case a prior run left behind (e.g. self-heal succeeded on a prior
        // tick but this refund was not re-verified until now).
        const existingCase = await this.findOpenCase('REFUNDED_LEDGER_INCOMPLETE', refund.payment_id);
        if (existingCase) {
          await this.autoResolveCase(
            existingCase.id,
            'Automatically resolved by the refund reconciliation detector: all three DEC-059 reversal components (CUSTOMER_PAYMENT_REFUND, SERVICE_FEE_REVENUE_REFUND, MERCHANT_COMMISSION_REFUND) verified present and correct.',
          );
          f.resolved++;
        }
        continue;
      }

      const caseOutcome = await this.insertOrReuseCase('REFUNDED_LEDGER_INCOMPLETE', refund.payment_id, order.id);
      if (!caseOutcome) continue;
      if (caseOutcome.created) f.opened++;
      else f.reused++;

      try {
        await this.ledgerReversal.postReversals(refund.id, refund.payment_id);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        this.logger.warn(
          `refund ${refund.id}: REFUNDED_LEDGER_INCOMPLETE self-heal via RefundLedgerReversalService failed — leaving case ${caseOutcome.id} OPEN/IN_PROGRESS, no destructive mutation attempted: ${message}`,
        );
        continue;
      }

      // Re-verify with fresh reads — postReversals just wrote rows the
      // batched maps above cannot see. Only re-fetched for this one refund
      // (the anomalous minority), never for the whole scanned batch.
      const reProblems = await this.verifyRefundedLedgerFresh(refund.id, payment, order, originalCommission);
      if (reProblems.length === 0) {
        await this.autoResolveCase(
          caseOutcome.id,
          'Automatically resolved by the refund reconciliation detector after RefundLedgerReversalService self-heal: all three DEC-059 reversal components verified present and correct.',
        );
        f.resolved++;
      } else {
        this.logger.warn(
          `refund ${refund.id}: self-heal completed without throwing but re-verification still finds ${reProblems.length} problem(s) — leaving case ${caseOutcome.id} OPEN/IN_PROGRESS: ${reProblems.join('; ')}`,
        );
      }
    }

    return { b, f };
  }

  // ---------------------------------------------------------------------
  // Anomaly D — a local refund state that requires provider identity but
  // carries none.
  // ---------------------------------------------------------------------

  /**
   * `REFUND_REQUESTED` is the only state legitimately reachable with a null
   * `provider_refund_id` (it is set, at the same time as the state leaves
   * `REFUND_REQUESTED`, by `RefundService.markPending` — the sole writer of
   * this column in the entire codebase). Any refund in any other state with
   * `provider_refund_id IS NULL` is therefore a genuine anomaly.
   *
   * **No automatic recovery is attempted for this kind.** The mission
   * authorizes repairing this via "the existing deterministic processing
   * path" only if a persisted provider event can be *safely* associated with
   * this refund — but `RefundEventProcessingService` matches an event to a
   * refund exclusively via `(provider, provider_refund_id)`, which this
   * refund by definition does not have. There is no second, refund→event
   * matching direction anywhere in this codebase (matching a candidate event
   * only by the refund's *payment*'s `provider_payment_id` is not safe: more
   * than one refund-domain event can share a `payment_id` over a payment's
   * lifetime, e.g. a `pending`/`requires_action` event followed later by a
   * `succeeded` one, or a genuinely different refund attempt in a future
   * partial-refund phase — picking one to "safely" adopt a `provider_refund_id`
   * from would be exactly the invented-fact risk the mission's own ground
   * rules forbid). Detection-only, requiring manual intervention, is
   * therefore the correct and honest outcome here — not a shortfall.
   */
  private async detectMissingProviderRefundId(): Promise<AnomalyPhaseResult> {
    const result = emptyPhase();

    const { data, error } = await this.supabase.admin
      .from('refunds')
      .select('id, payment_id, state, amount_satang, provider, provider_refund_id, updated_at')
      .neq('state', 'REFUND_REQUESTED')
      .is('provider_refund_id', null)
      .order('updated_at', { ascending: true })
      .limit(MISSING_PROVIDER_ID_SCAN_LIMIT)
      .returns<RefundRow[]>();

    if (error) {
      this.logger.error(`Failed to list refunds missing provider_refund_id: ${error.message}`);
      return result;
    }

    const candidates = data ?? [];
    if (candidates.length === 0) return result;

    const paymentIds = [...new Set(candidates.map((r) => r.payment_id))];
    const payments = await this.loadPaymentsByIds(paymentIds);
    const paymentById = new Map(payments.map((p) => [p.id, p]));

    for (const refund of candidates) {
      result.examined++;
      const payment = paymentById.get(refund.payment_id);
      await this.applyCaseOutcome(result, 'MISSING_PROVIDER_REFUND_ID', refund.payment_id, payment?.order_id ?? null);
    }

    return result;
  }

  // ---------------------------------------------------------------------
  // Anomaly E — documented, honest no-op. See this class's own doc comment.
  // ---------------------------------------------------------------------

  private detectMissingProviderEvent(): AnomalyPhaseResult {
    return emptyPhase();
  }

  // ---------------------------------------------------------------------
  // Shared case insert-or-reuse / resolve helpers
  // ---------------------------------------------------------------------

  private async applyCaseOutcome(
    phase: AnomalyPhaseResult,
    kind: RefundReconciliationKind,
    paymentId: string,
    orderId: string | null,
  ): Promise<void> {
    const outcome = await this.insertOrReuseCase(kind, paymentId, orderId);
    if (!outcome) return;
    if (outcome.created) phase.opened++;
    else phase.reused++;
  }

  /**
   * `INSERT` first; on a `23505` conflict against
   * `reconciliation_cases_refund_open_key`, read back the existing
   * `OPEN`/`IN_PROGRESS` row for the same `(kind, payment_id)`. The unique
   * index is the sole concurrency/dedup authority — this never runs a prior
   * `SELECT` to decide whether to insert (ADR-003), matching
   * `RefundService.createOrReuseRefund` and
   * `RefundLedgerReversalService`'s own `postIndependentGroup` exactly.
   */
  private async insertOrReuseCase(
    kind: RefundReconciliationKind,
    paymentId: string,
    orderId: string | null,
  ): Promise<{ id: string; created: boolean } | null> {
    const { data: inserted, error: insertError } = await this.supabase.admin
      .from('reconciliation_cases')
      .insert({ kind, payment_id: paymentId, order_id: orderId })
      .select('id')
      .maybeSingle<{ id: string }>();

    if (!insertError) {
      if (!inserted) {
        this.logger.error(`reconciliation_cases insert for ${kind}/${paymentId} returned no row`);
        return null;
      }
      return { id: inserted.id, created: true };
    }

    if (!isUniqueViolation(insertError)) {
      this.logger.error(`reconciliation_cases insert failed for ${kind}/${paymentId}: ${insertError.message}`);
      return null;
    }

    const existing = await this.findOpenCase(kind, paymentId);
    if (!existing) {
      this.logger.error(`reconciliation_cases read-back found no OPEN/IN_PROGRESS row for ${kind}/${paymentId} after a unique conflict`);
      return null;
    }
    return { id: existing.id, created: false };
  }

  private async findOpenCase(kind: RefundReconciliationKind, paymentId: string): Promise<{ id: string } | null> {
    const { data, error } = await this.supabase.admin
      .from('reconciliation_cases')
      .select('id')
      .eq('kind', kind)
      .eq('payment_id', paymentId)
      .in('state', ['OPEN', 'IN_PROGRESS'])
      .maybeSingle<{ id: string }>();

    if (error) {
      this.logger.error(`reconciliation_cases OPEN/IN_PROGRESS read failed for ${kind}/${paymentId}: ${error.message}`);
      return null;
    }
    return data ?? null;
  }

  /**
   * The only place this file ever moves a case forward — always into
   * `RESOLVED`, always guarded (`state in ('OPEN','IN_PROGRESS')` repeated in
   * the `WHERE`, never a prior read deciding — ADR-003), and only ever
   * called after this file's own fresh, independent re-verification has
   * confirmed the underlying condition is actually cleared (Anomaly F only —
   * see class doc comment). Never called for A/B/C/D.
   */
  private async autoResolveCase(caseId: string, note: string): Promise<void> {
    const { error } = await this.supabase.admin
      .from('reconciliation_cases')
      .update({ state: 'RESOLVED', resolution_note: note })
      .eq('id', caseId)
      .in('state', ['OPEN', 'IN_PROGRESS']);

    if (error) {
      this.logger.error(`reconciliation_cases auto-resolve failed for case ${caseId}: ${error.message}`);
    }
  }

  // ---------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------

  private async listInFlightRefunds(): Promise<RefundRow[]> {
    const { data, error } = await this.supabase.admin
      .from('refunds')
      .select('id, payment_id, state, amount_satang, provider, provider_refund_id, updated_at')
      .in('state', IN_FLIGHT_REFUND_STATES)
      .order('updated_at', { ascending: true })
      .limit(IN_FLIGHT_REFUND_SCAN_LIMIT)
      .returns<RefundRow[]>();

    if (error) {
      this.logger.error(`Failed to list in-flight refunds: ${error.message}`);
      return [];
    }
    return data ?? [];
  }

  private async listRefundedRefunds(): Promise<RefundRow[]> {
    const { data, error } = await this.supabase.admin
      .from('refunds')
      .select('id, payment_id, state, amount_satang, provider, provider_refund_id, updated_at')
      .eq('state', 'REFUNDED')
      .order('updated_at', { ascending: true })
      .limit(REFUNDED_REFUND_SCAN_LIMIT)
      .returns<RefundRow[]>();

    if (error) {
      this.logger.error(`Failed to list REFUNDED refunds: ${error.message}`);
      return [];
    }
    return data ?? [];
  }

  private async loadPaymentsByIds(paymentIds: string[]): Promise<PaymentRow[]> {
    if (paymentIds.length === 0) return [];
    const { data, error } = await this.supabase.admin
      .from('payments')
      .select('id, order_id, amount_satang, provider_payment_id')
      .in('id', paymentIds)
      .returns<PaymentRow[]>();

    if (error) {
      this.logger.error(`payments read failed for refund reconciliation: ${error.message}`);
      return [];
    }
    return data ?? [];
  }

  private async loadOrdersByIds(orderIds: string[]): Promise<OrderRow[]> {
    if (orderIds.length === 0) return [];
    const { data, error } = await this.supabase.admin
      .from('orders')
      .select('id, customer_id, service_fee_satang')
      .in('id', orderIds)
      .returns<OrderRow[]>();

    if (error) {
      this.logger.error(`orders read failed for refund reconciliation: ${error.message}`);
      return [];
    }
    return data ?? [];
  }

  private async loadProcessedRefundStatusEventsByPaymentIds(paymentIds: string[]): Promise<PaymentEventRow[]> {
    if (paymentIds.length === 0) return [];
    const { data, error } = await this.supabase.admin
      .from('payment_events')
      .select('id, payment_id, raw_payload')
      .eq('event_type', REFUND_STATUS_EVENT_TYPE)
      .not('processed_at', 'is', null)
      .in('payment_id', paymentIds)
      .returns<PaymentEventRow[]>();

    if (error) {
      this.logger.error(`payment_events read failed for refund reconciliation: ${error.message}`);
      return [];
    }
    return data ?? [];
  }

  /** The order's own original (non-reversal) `MERCHANT_COMMISSION` group + entries, batched across `orderIds` — the same source `RefundLedgerReversalService.readOriginalCommission` reads for one order at a time, restated here read-only for a batch. */
  private async loadOriginalCommissionByOrderIds(
    orderIds: string[],
  ): Promise<Map<string, { merchantId: string; commissionSatang: number } | null>> {
    const result = new Map<string, { merchantId: string; commissionSatang: number } | null>();
    if (orderIds.length === 0) return result;

    const { data: groups, error: groupsError } = await this.supabase.admin
      .from('ledger_entry_groups')
      .select('id, order_id, refund_id, kind')
      .eq('kind', 'MERCHANT_COMMISSION')
      .is('refund_id', null)
      .in('order_id', orderIds)
      .returns<LedgerEntryGroupRow[]>();

    if (groupsError) {
      this.logger.error(`original MERCHANT_COMMISSION groups read failed: ${groupsError.message}`);
      return result;
    }

    const groupIdToOrderId = new Map(
      (groups ?? [])
        .filter((g): g is LedgerEntryGroupRow & { order_id: string } => g.order_id !== null)
        .map((g) => [g.id, g.order_id]),
    );
    const groupIds = [...groupIdToOrderId.keys()];
    if (groupIds.length === 0) return result;

    const { data: entries, error: entriesError } = await this.supabase.admin
      .from('ledger_entries')
      .select('group_id, account, party_id, amount_satang')
      .in('group_id', groupIds)
      .returns<LedgerEntryRow[]>();

    if (entriesError) {
      this.logger.error(`original MERCHANT_COMMISSION entries read failed: ${entriesError.message}`);
      return result;
    }

    const entriesByGroupId = new Map<string, LedgerEntryRow[]>();
    for (const entry of entries ?? []) {
      const list = entriesByGroupId.get(entry.group_id) ?? [];
      list.push(entry);
      entriesByGroupId.set(entry.group_id, list);
    }

    for (const [groupId, orderId] of groupIdToOrderId) {
      const groupEntries = entriesByGroupId.get(groupId) ?? [];
      const revenueEntry = groupEntries.find((e) => e.account === 'PLATFORM_REVENUE');
      const payableEntry = groupEntries.find((e) => e.account === 'MERCHANT_PAYABLE');
      if (revenueEntry && payableEntry && payableEntry.party_id) {
        result.set(orderId, { merchantId: payableEntry.party_id, commissionSatang: revenueEntry.amount_satang });
      } else if (!result.has(orderId)) {
        result.set(orderId, null);
      }
    }

    return result;
  }

  private async loadLedgerGroupsByRefundIds(refundIds: string[]): Promise<Map<string, LedgerEntryGroupRow[]>> {
    const result = new Map<string, LedgerEntryGroupRow[]>();
    if (refundIds.length === 0) return result;

    const { data, error } = await this.supabase.admin
      .from('ledger_entry_groups')
      .select('id, order_id, refund_id, kind')
      .in('refund_id', refundIds)
      .returns<LedgerEntryGroupRow[]>();

    if (error) {
      this.logger.error(`ledger_entry_groups read failed for refund reconciliation: ${error.message}`);
      return result;
    }

    for (const group of data ?? []) {
      if (!group.refund_id) continue;
      const list = result.get(group.refund_id) ?? [];
      list.push(group);
      result.set(group.refund_id, list);
    }
    return result;
  }

  private async loadLedgerEntriesByGroupIds(groupIds: string[]): Promise<Map<string, LedgerEntryRow[]>> {
    const result = new Map<string, LedgerEntryRow[]>();
    if (groupIds.length === 0) return result;

    const { data, error } = await this.supabase.admin
      .from('ledger_entries')
      .select('group_id, account, party_id, amount_satang')
      .in('group_id', groupIds)
      .returns<LedgerEntryRow[]>();

    if (error) {
      this.logger.error(`ledger_entries read failed for refund reconciliation: ${error.message}`);
      return result;
    }

    for (const entry of data ?? []) {
      const list = result.get(entry.group_id) ?? [];
      list.push(entry);
      result.set(entry.group_id, list);
    }
    return result;
  }

  /** Fresh, single-refund re-verification — used only after a self-heal attempt, never for the initial batch scan (see {@link reconcileRefundedRefunds}). */
  private async verifyRefundedLedgerFresh(
    refundId: string,
    payment: PaymentRow,
    order: OrderRow,
    originalCommission: { merchantId: string; commissionSatang: number } | null,
  ): Promise<string[]> {
    const groupsByRefundId = await this.loadLedgerGroupsByRefundIds([refundId]);
    const groups = groupsByRefundId.get(refundId) ?? [];
    const entriesByGroupId = await this.loadLedgerEntriesByGroupIds(groups.map((g) => g.id));

    const expected = buildExpectedComponents(refundId, payment, order, originalCommission);
    return verifyExpectedComponents(expected, order.id, refundId, groups, entriesByGroupId);
  }
}

/** DEC-059 §G's exact three components, restated read-only. Mirrors `RefundLedgerReversalService`'s own private `reverse*` methods' expected shapes — never imported from there (that file has no exported spec-builder), duplicated deliberately narrowly so this file's verification never depends on, or risks regressing, the writer's own internals. */
function buildExpectedComponents(
  refundId: string,
  payment: PaymentRow,
  order: OrderRow,
  originalCommission: { merchantId: string; commissionSatang: number } | null,
): ExpectedComponent[] {
  const components: ExpectedComponent[] = [
    {
      groupKey: `refund:customer_payment:${refundId}`,
      kind: 'CUSTOMER_PAYMENT_REFUND',
      expectedEntries: [{ account: 'CUSTOMER_PAYMENT', partyId: order.customer_id, amountSatang: -payment.amount_satang }],
    },
    {
      groupKey: `refund:service_fee:${refundId}`,
      kind: 'SERVICE_FEE_REVENUE_REFUND',
      expectedEntries: [{ account: 'PLATFORM_REVENUE', partyId: null, amountSatang: -order.service_fee_satang }],
    },
  ];

  if (originalCommission) {
    components.push({
      groupKey: `refund:commission:${refundId}`,
      kind: 'MERCHANT_COMMISSION_REFUND',
      expectedEntries: [
        { account: 'MERCHANT_PAYABLE', partyId: originalCommission.merchantId, amountSatang: originalCommission.commissionSatang },
        { account: 'PLATFORM_REVENUE', partyId: null, amountSatang: -originalCommission.commissionSatang },
      ],
    });
  }
  // originalCommission === null (no original MERCHANT_COMMISSION group found
  // for this order) means the MERCHANT_COMMISSION_REFUND component's
  // expected shape cannot be determined at all — verifyExpectedComponents
  // reports this explicitly as its own problem below, rather than silently
  // omitting the component from the check.

  return components;
}

/**
 * Read-only verification — never issues an `INSERT`/`UPDATE`/`DELETE`. Checks
 * group key (by construction — the caller only ever looks up groups already
 * filtered to this `refund_id`), refund ID and order ID identity, `kind`,
 * and per expected entry: account, party, amount, and that no extra/
 * unexpected entry exists on the same group. Returns every problem found —
 * an empty array means fully verified correct.
 */
function verifyExpectedComponents(
  expected: ExpectedComponent[],
  orderId: string,
  refundId: string,
  existingGroups: LedgerEntryGroupRow[],
  entriesByGroupId: Map<string, LedgerEntryRow[]>,
): string[] {
  const problems: string[] = [];

  if (expected.length < 3) {
    problems.push(
      `no original MERCHANT_COMMISSION ledger_entry_groups row found for order ${orderId} — cannot determine the recognized commission amount to reverse, so MERCHANT_COMMISSION_REFUND cannot be verified`,
    );
  }

  const groupByKind = new Map(existingGroups.map((g) => [g.kind, g]));

  for (const component of expected) {
    const group = groupByKind.get(component.kind);
    if (!group) {
      problems.push(`missing ${component.kind} group (expected group_key ${component.groupKey})`);
      continue;
    }

    if (group.order_id !== orderId || group.refund_id !== refundId) {
      problems.push(
        `${component.kind} group ${group.id} has conflicting identity (order_id=${group.order_id ?? 'null'}, refund_id=${group.refund_id ?? 'null'}) — expected order_id=${orderId}, refund_id=${refundId}`,
      );
      continue;
    }

    const actualEntries = entriesByGroupId.get(group.id) ?? [];

    if (actualEntries.length !== component.expectedEntries.length) {
      problems.push(
        `${component.kind} group ${group.id} has ${actualEntries.length} entries, expected exactly ${component.expectedEntries.length}`,
      );
    }

    for (const expectedEntry of component.expectedEntries) {
      const match = actualEntries.find((e) => e.account === expectedEntry.account);
      if (!match) {
        problems.push(`${component.kind} group ${group.id} is missing its expected ${expectedEntry.account} entry`);
        continue;
      }
      if (match.party_id !== expectedEntry.partyId || match.amount_satang !== expectedEntry.amountSatang) {
        problems.push(
          `${component.kind} group ${group.id} account ${expectedEntry.account} has party_id=${match.party_id ?? 'null'}/amount_satang=${match.amount_satang}, expected party_id=${expectedEntry.partyId ?? 'null'}/amount_satang=${expectedEntry.amountSatang}`,
        );
      }
    }
  }

  return problems;
}

function readString(payload: unknown, key: string): string | undefined {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function readAmount(payload: unknown, key: string): number | undefined {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function isUniqueViolation(error: { code?: string; message: string }): boolean {
  return error.code === '23505' || error.message.includes('duplicate key');
}
