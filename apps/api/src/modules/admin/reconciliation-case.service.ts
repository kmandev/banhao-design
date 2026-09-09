import { Injectable, Logger } from '@nestjs/common';
import {
  RECONCILIATION_CASE_KINDS,
  RECONCILIATION_CASE_STATES,
  type ListReconciliationCasesQuery,
  type ReconciliationCaseDetailResponse,
  type ReconciliationCaseKind,
  type ReconciliationCaseListResponse,
  type ReconciliationCaseState,
  type ReconciliationCaseSummary,
  type ResolveReconciliationCaseRequest,
  type ResolveReconciliationCaseResponse,
} from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';

/** How many cases one page reads — a bound on work, matching `SupervisorCaseService`'s own `DEFAULT_LIMIT`/`MAX_LIMIT` shape. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface ReconciliationCaseRow {
  id: string;
  kind: string;
  state: string;
  payment_id: string | null;
  order_id: string | null;
  payment_event_id: string | null;
  assigned_to: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Q-020 Slice 4 — the `reconciliation_cases` read path and resolve action a
 * prior production audit found missing ("reconciliation_cases has zero read
 * path").
 *
 * ## What this closes, and what it does not
 *
 * This exposes the table **as it exists today** — the four kinds
 * `LATE_PAYMENT`/`SURPLUS_PAYMENT`/`AMOUNT_MISMATCH`/`UNMATCHED_EVENT`
 * `PaymentEventProcessingService.openCase` already writes. It does **not**
 * add a refund-specific anomaly kind (`PROVIDER_SUCCEEDED_LOCAL_NOT_REFUNDED`
 * and the rest, per Q-020 Slice 4's own mission) — `reconciliation_cases.kind`'s
 * CHECK constraint has no such value, and widening it is a migration this
 * slice's own final report reports as blocked, not something worked around
 * here by writing an unrecognized `kind` the database would reject outright
 * (`23514`).
 *
 * ## Authorization is reused, not invented
 *
 * Consumed only by `SupervisorController`, behind its existing
 * `@Roles('OPERATOR', 'ADMIN')` class-level grant — the identical boundary
 * `SupervisorCaseService`/`RefundService` already sit behind. No new role, no
 * new guard.
 *
 * ## Resolve is advisory metadata, never a financial mutation
 *
 * `resolveCase` writes only `reconciliation_cases.state`/`resolution_note`/
 * `assigned_to`/`updated_at` — every column this table's own
 * `set_updated_at` trigger allows to change. It never touches `refunds`,
 * `payments`, `orders`, or a ledger table. An operator resolving a case is a
 * record of their own judgement that the underlying inconsistency is
 * cleared, not itself the mechanism that clears one (DEC-058 — a
 * mutation may be performed only by an authorized role, with a reason, and
 * that reason is `resolutionNote` here, mirroring `resolveSupervisorCaseSchema`'s
 * DEC-032 precedent).
 */
@Injectable()
export class ReconciliationCaseService {
  private readonly logger = new Logger(ReconciliationCaseService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** The operator's reconciliation inbox — newest first, deterministic. */
  async listCases(query: ListReconciliationCasesQuery): Promise<ReconciliationCaseListResponse> {
    const kind = this.validateKind(query.kind);
    const state = this.validateState(query.state);
    const limit = this.boundedLimit(query.limit);

    let builder = this.supabase.admin
      .from('reconciliation_cases')
      .select('id, kind, state, payment_id, order_id, payment_event_id, assigned_to, resolution_note, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (kind) {
      builder = builder.eq('kind', kind);
    }
    if (state) {
      builder = builder.eq('state', state);
    }

    const { data, error } = await builder.returns<ReconciliationCaseRow[]>();

    if (error) {
      this.logger.error(`reconciliation_cases list read failed: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: `reconciliation_cases read failed: ${error.message}` });
    }

    const cases = (data ?? []).map((row) => this.toSummary(row));
    const openCount = cases.filter((c) => c.state === 'OPEN' || c.state === 'IN_PROGRESS').length;

    return { cases, window: { limit, returned: cases.length, openCount } };
  }

  /** S-03-shaped case detail — this table carries no field the list projection omits, so it is the same shape by one id. */
  async getCase(id: string): Promise<ReconciliationCaseDetailResponse> {
    const row = await this.loadCase(id);
    return { case: this.toSummary(row) };
  }

  /**
   * The one write this service performs — an operator's own resolution
   * record. Guarded (`.eq('id', id)`) but not state-machine-guarded beyond
   * that: unlike `refunds`/ledger tables, this table has no locked
   * transition policy of its own (DEC-049/057 govern the financial tables,
   * not this operator worklist), so any of the three forward states may be
   * set at operator discretion, matching the mission's own "must not become
   * RESOLVED merely because detection ran" — this endpoint is exactly the
   * human judgement call that decision requires, never automatic.
   */
  async resolveCase(
    id: string,
    request: ResolveReconciliationCaseRequest,
    user: AuthenticatedUser,
  ): Promise<ResolveReconciliationCaseResponse> {
    await this.loadCase(id);

    const { data, error } = await this.supabase.admin
      .from('reconciliation_cases')
      .update({ state: request.state, resolution_note: request.resolutionNote, assigned_to: user.id })
      .eq('id', id)
      .select('id, kind, state, payment_id, order_id, payment_event_id, assigned_to, resolution_note, created_at, updated_at')
      .maybeSingle<ReconciliationCaseRow>();

    if (error) {
      this.logger.error(`reconciliation_cases resolve failed for ${id}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: `reconciliation_cases resolve failed: ${error.message}` });
    }
    if (!data) {
      // Existed at loadCase above; a concurrent hard-delete is not a shape
      // this table's own append-only convention allows, but this fails
      // closed rather than assuming.
      throw new DomainError('NOT_FOUND', { message: 'Reconciliation case not found' });
    }

    return { case: this.toSummary(data) };
  }

  private async loadCase(id: string): Promise<ReconciliationCaseRow> {
    const { data, error } = await this.supabase.admin
      .from('reconciliation_cases')
      .select('id, kind, state, payment_id, order_id, payment_event_id, assigned_to, resolution_note, created_at, updated_at')
      .eq('id', id)
      .maybeSingle<ReconciliationCaseRow>();

    if (error) {
      this.logger.error(`reconciliation_cases read failed for ${id}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: `reconciliation_cases read failed: ${error.message}` });
    }
    if (!data) {
      throw new DomainError('NOT_FOUND', { message: 'Reconciliation case not found' });
    }
    return data;
  }

  private validateKind(kind: string | undefined): ReconciliationCaseKind | undefined {
    if (kind === undefined) {
      return undefined;
    }
    if (!(RECONCILIATION_CASE_KINDS as readonly string[]).includes(kind)) {
      throw new DomainError('VALIDATION_FAILED', {
        message: `Unrecognized reconciliation case kind "${kind}"`,
        details: { allowed: RECONCILIATION_CASE_KINDS },
      });
    }
    return kind as ReconciliationCaseKind;
  }

  private validateState(state: string | undefined): ReconciliationCaseState | undefined {
    if (state === undefined) {
      return undefined;
    }
    if (!(RECONCILIATION_CASE_STATES as readonly string[]).includes(state)) {
      throw new DomainError('VALIDATION_FAILED', {
        message: `Unrecognized reconciliation case state "${state}"`,
        details: { allowed: RECONCILIATION_CASE_STATES },
      });
    }
    return state as ReconciliationCaseState;
  }

  private boundedLimit(raw: string | undefined): number {
    if (raw === undefined) {
      return DEFAULT_LIMIT;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_LIMIT;
    }
    return Math.min(Math.max(Math.trunc(parsed), 1), MAX_LIMIT);
  }

  private toSummary(row: ReconciliationCaseRow): ReconciliationCaseSummary {
    return {
      id: row.id,
      kind: row.kind as ReconciliationCaseKind,
      state: row.state as ReconciliationCaseState,
      paymentId: row.payment_id,
      orderId: row.order_id,
      paymentEventId: row.payment_event_id,
      assignedTo: row.assigned_to,
      resolutionNote: row.resolution_note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
