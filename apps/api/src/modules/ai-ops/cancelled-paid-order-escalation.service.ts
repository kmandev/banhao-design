import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { AiAuditService } from './ai-audit.service';
import type { AiOpsRunResult } from './ai-ops.types';

/** The audit action every escalation from this phase is recorded under. One row per order. */
export const CANCELLED_PAID_ORDER_ACTION = 'AI_OPS_CANCELLED_PAID_ORDER';

/** How many candidates one tick examines. A bound on work, not a policy value. */
const BATCH_SIZE = 25;

interface PaymentCandidateRow {
  id: string;
  order_id: string;
}

/**
 * DEC-050 / DEC-058 — an order that was cancelled **after the customer paid**
 * and has no refund started needs an operator.
 *
 * ## Why this exists
 *
 * DEC-050 says a customer who cancels in the free window gets a full refund
 * and no fee. DEC-058 says only an operator initiates and executes a refund,
 * and that the system never does it on its own. Between the two sat a gap
 * nobody could see: a customer cancels, the order is `CANCELLED`, the payment
 * is `SUCCESS`, and **nothing tells the operator** a refund is owed. This phase
 * is that tell. It raises one escalation per such order, into the same
 * supervisor inbox every other AI Operations case uses.
 *
 * ## What it is, and is not
 *
 * - It **notices**. It starts no refund, writes no `refunds` row, touches no
 *   payment, order or ledger row. The operator opens the case and initiates the
 *   refund through the existing supervisor route (DEC-058).
 * - It carries **no amount** (DEC-040 §3): ids and states only.
 * - It uses `ESC-UNKNOWN`, because no escalation id names this case and DEC-040
 *   §5 forbids inventing one. The `reason` says exactly what it is.
 * - It stays quiet once **any** refund row exists for the payment, in any
 *   state: someone has started it, and a refund that then fails has its own
 *   reconciliation case. Re-alerting would only be noise.
 *
 * ## Idempotency
 *
 * One `audit_logs` row per `(action, order)`, enforced by
 * `audit_logs_ai_action_entity_key` (DEC-065 §1). Newest candidates are read
 * first, so an unhandled cancellation is examined on the tick after it
 * happens; the same bound as J-01's candidate read applies (more than
 * `BATCH_SIZE` qualifying cancellations inside one tick would defer the
 * excess, not lose it, until the batch clears).
 *
 * Never throws: a failure here must not fail the phases sharing the tick.
 */
@Injectable()
export class CancelledPaidOrderEscalationService {
  private readonly logger = new Logger(CancelledPaidOrderEscalationService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AiAuditService,
  ) {}

  async run(): Promise<AiOpsRunResult> {
    const empty: AiOpsRunResult = { examined: 0, acted: 0, escalated: 0, skipped: 0, failed: 0 };

    let candidates: PaymentCandidateRow[];
    try {
      candidates = await this.listCandidates();
    } catch (cause) {
      this.logger.error(`Cancelled-paid-order candidate read failed: ${message(cause)}`);
      return { ...empty, failed: 1 };
    }

    let escalated = 0;
    let skipped = 0;
    let failed = 0;

    for (const candidate of candidates) {
      try {
        if (await this.audit.alreadyHandled(CANCELLED_PAID_ORDER_ACTION, candidate.order_id)) {
          skipped += 1;
          continue;
        }

        if (await this.hasRefund(candidate.id)) {
          skipped += 1;
          continue;
        }

        await this.audit.recordEscalation({
          action: CANCELLED_PAID_ORDER_ACTION,
          entityId: candidate.order_id,
          escalation: 'ESC-UNKNOWN',
          reason:
            'The order was cancelled after the customer paid and no refund has been started. ' +
            'DEC-050 makes this a full refund with no fee; an operator initiates it (DEC-058). ' +
            'Nothing has been refunded automatically.',
          context: { playbook: 'CANCELLED_PAID_ORDER', paymentId: candidate.id },
        });
        escalated += 1;
      } catch (cause) {
        failed += 1;
        this.logger.error(`Cancelled-paid-order escalation failed for order ${candidate.order_id}: ${message(cause)}`);
      }
    }

    return { examined: candidates.length, acted: 0, escalated, skipped, failed };
  }

  /**
   * Paid payments whose order is `CANCELLED`, newest first. `orders!inner`
   * makes the second filter an inner join, so only cancelled orders come back.
   * Selects ids only — no amount, fee or reference column (DEC-040 §3).
   */
  private async listCandidates(): Promise<PaymentCandidateRow[]> {
    const { data, error } = await this.supabase.admin
      .from('payments')
      .select('id, order_id, orders!inner(state)')
      .eq('state', 'SUCCESS')
      .eq('orders.state', 'CANCELLED')
      .order('created_at', { ascending: false })
      .limit(BATCH_SIZE)
      .returns<PaymentCandidateRow[]>();

    if (error) {
      throw new Error(`payments read failed: ${error.message}`);
    }
    return data ?? [];
  }

  /** Whether a refund of any state exists for this payment. A read failure counts as "has one": silence, not a duplicate alert. */
  private async hasRefund(paymentId: string): Promise<boolean> {
    const { data, error } = await this.supabase.admin
      .from('refunds')
      .select('id')
      .eq('payment_id', paymentId)
      .limit(1)
      .returns<{ id: string }[]>();

    if (error) {
      this.logger.error(`refunds read failed for payment ${paymentId}; treating as handled: ${error.message}`);
      return true;
    }
    return (data ?? []).length > 0;
  }
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
