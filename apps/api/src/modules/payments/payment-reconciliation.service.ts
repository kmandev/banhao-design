import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

/** Bounded scan sizes — an operational limit, not a business rule. No pagination cursor exists yet; see class doc comment. */
const DEFAULT_PAYMENT_SCAN_LIMIT = 200;
const DEFAULT_ORPHAN_SCAN_LIMIT = 200;

export type PaymentLedgerReconciliationStatus =
  | 'MATCH'
  | 'MISSING_CUSTOMER_PAYMENT_LEDGER'
  | 'ORPHAN_CUSTOMER_PAYMENT'
  | 'PAYMENT_LEDGER_AMOUNT_MISMATCH'
  | 'PAYMENT_LEDGER_IDENTITY_MISMATCH'
  | 'DUPLICATE_CUSTOMER_PAYMENT'
  | 'LEGACY_NOT_APPLICABLE'
  | 'IN_FLIGHT';

/**
 * One row of the reconciliation report — `docs/SETTLEMENT_MODEL.md` § 11.1's
 * locked output contract. Fields are nullable rather than split into a
 * discriminated union because which fields are populated depends on which
 * side of the check produced the row (a forward row always has a payment
 * identity; an orphan row never does) — callers should treat `status` as
 * authoritative and the rest as best-effort context for an eventual admin
 * report, never as inputs to a repair action (there is none).
 */
export interface PaymentLedgerReconciliationResult {
  status: PaymentLedgerReconciliationStatus;
  paymentId: string | null;
  providerTransactionId: string | null;
  orderId: string | null;
  expectedGroupKey: string | null;
  paymentAmountSatang: number | null;
  ledgerAmountSatang: number | null;
  customerId: string | null;
  ledgerGroupId: string | null;
  ledgerEntryIds: string[] | null;
  detail: string | null;
}

export interface ReconcileOptions {
  /** Max `SUCCESS` payments scanned this call — bounded, not paginated. Default {@link DEFAULT_PAYMENT_SCAN_LIMIT}. */
  paymentLimit?: number;
  /** Max `CUSTOMER_PAYMENT` ledger groups scanned for orphans this call — bounded, not paginated. Default {@link DEFAULT_ORPHAN_SCAN_LIMIT}. */
  orphanLimit?: number;
  /**
   * No authoritative tick-interval value exists anywhere in this repository
   * — `docs/DEPLOYMENT-ARCHITECTURE-V1.md` records `apps/tick-worker` (the
   * component that would call `POST /internal/tick` on a schedule) as
   * **not created**, so there is no real cron cadence to read a number from.
   * Omitting this parameter is therefore the honest default: every eligible
   * payment with no ledger group is reported `MISSING_CUSTOMER_PAYMENT_LEDGER`
   * outright, with no grace window applied. A caller who knows their actual
   * deployment's tick cadence may pass it here to get `IN_FLIGHT` treatment
   * for payments younger than it instead.
   */
  graceWindowMs?: number;
  /**
   * No cutover marker/date for the `CUSTOMER_PAYMENT` feature exists
   * anywhere in this repository (no deploy-date constant, no feature flag).
   * Omitting this parameter is the honest default: `LEGACY_NOT_APPLICABLE`
   * is never produced, and every pre-feature `SUCCESS` payment with no
   * ledger group is reported `MISSING_CUSTOMER_PAYMENT_LEDGER` instead — a
   * known, documented over-report rather than a guessed cutover date. A
   * caller who knows their real deployment date for this feature may pass
   * it here.
   */
  cutoverAt?: Date;
}

interface SuccessPaymentRow {
  id: string;
  order_id: string;
  amount_satang: number;
  succeeded_at: string | null;
}

interface PaymentTransactionRow {
  id: string;
  payment_id: string;
  amount_satang: number;
  provider_transaction_id: string;
  occurred_at: string;
}

interface LedgerEntryGroupRow {
  id: string;
  group_key: string;
  order_id: string | null;
  kind: string;
}

interface LedgerEntryRow {
  id: string;
  group_id: string;
  account: string;
  party_type: string | null;
  party_id: string | null;
  amount_satang: number;
}

interface OrderRow {
  id: string;
  customer_id: string;
}

interface ReconciliationCaseRow {
  payment_id: string | null;
  kind: string;
}

/**
 * `docs/SETTLEMENT_MODEL.md` § 11.1 — the locked `payment_transactions` ↔
 * `CUSTOMER_PAYMENT` reconciliation design, implemented exactly as designed:
 * **strictly read-only**. Every method here only ever calls `.select()`.
 * There is no INSERT, UPDATE, DELETE, or mutating RPC anywhere in this file
 * — the reconciliation scan competes with nothing and repairs nothing; a
 * `MISSING_CUSTOMER_PAYMENT_LEDGER` row is exactly the crash window
 * `PaymentEventProcessingService`'s own self-heal already exists to close on
 * its next tick, never something this service acts on.
 *
 * ## Model — payment-transaction-centric (§ 11.1 Model A)
 *
 * For each eligible `SUCCESS` payment, this reconstructs the exact
 * `group_key` `postCustomerPaymentLedger` would have used
 * (`payment:<paymentId>:<providerTransactionId>`) and looks it up directly —
 * never a fuzzy match, never by amount or `order_id` alone. `order_id` and
 * `party_id` are secondary checks, applied only once a group is found by its
 * exact key.
 *
 * ## Eligibility — reusing, not re-deriving, existing classification
 *
 * "Eligible" means: `payments.state = 'SUCCESS'`, and among that payment's
 * `payment_transactions` rows, the one with the **earliest `occurred_at`** —
 * the identical rule `recordTransactionAndComplete` already uses to tell a
 * self-heal retry from a genuine `SURPLUS_PAYMENT`. Any later transaction on
 * the same `payment_id` is a surplus by construction and is never the
 * eligible one.
 *
 * A refinement the original design note under-specified: a **`LATE_PAYMENT`**
 * event also leaves `payments.state = 'SUCCESS'` and a `payment_transactions`
 * row (`completeSuccessSideEffects` moves `payments` to `SUCCESS` before it
 * ever checks the order's state), yet correctly posts no `CUSTOMER_PAYMENT`
 * — the order moved on before this payment settled it. The earliest-
 * transaction rule alone cannot tell this apart from a genuine missing-ledger
 * bug, so this service additionally excludes any payment with an existing
 * `reconciliation_cases` row of `kind IN ('LATE_PAYMENT', 'SURPLUS_PAYMENT')`
 * from the eligible set entirely — reusing the ingest-time classification
 * `PaymentEventProcessingService.openCase` already recorded, rather than
 * re-deriving order-state history here.
 *
 * ## Bounded, not paginated
 *
 * Both passes (forward and orphan) take a `limit` and return at most that
 * many rows of their respective source table. There is no cursor and no
 * pagination convention elsewhere in this codebase to reuse — see
 * `ReconcileOptions`'s own doc comments. A production-scale sweep needs a
 * cursor added later; this is explicitly the smallest safe first version,
 * not a claim of completeness over an unbounded dataset.
 */
@Injectable()
export class PaymentReconciliationService {
  constructor(private readonly supabase: SupabaseService) {}

  async reconcile(options: ReconcileOptions = {}): Promise<{
    results: PaymentLedgerReconciliationResult[];
    scannedPaymentCount: number;
    scannedOrphanGroupCount: number;
  }> {
    const paymentLimit = options.paymentLimit ?? DEFAULT_PAYMENT_SCAN_LIMIT;
    const orphanLimit = options.orphanLimit ?? DEFAULT_ORPHAN_SCAN_LIMIT;

    // Sequential, not concurrent — matches this module's existing
    // convention (every other service here awaits one read at a time) and
    // keeps two independent bounded scans trivially easy to reason about;
    // neither is a hot path.
    const forward = await this.reconcileForward(paymentLimit, options.graceWindowMs, options.cutoverAt);
    const orphans = await this.reconcileOrphans(orphanLimit);

    return {
      results: [...forward.results, ...orphans.results],
      scannedPaymentCount: forward.scannedPaymentCount,
      scannedOrphanGroupCount: orphans.scannedOrphanGroupCount,
    };
  }

  /** Payment → ledger direction: every eligible `SUCCESS` payment must resolve to exactly one `CUSTOMER_PAYMENT` entry. */
  async reconcileForward(
    limit: number,
    graceWindowMs: number | undefined = undefined,
    cutoverAt: Date | undefined = undefined,
  ): Promise<{ results: PaymentLedgerReconciliationResult[]; scannedPaymentCount: number }> {
    const { data: payments, error: paymentsError } = await this.supabase.admin
      .from('payments')
      .select('id, order_id, amount_satang, succeeded_at')
      .eq('state', 'SUCCESS')
      .order('succeeded_at', { ascending: true })
      .limit(limit)
      .returns<SuccessPaymentRow[]>();

    if (paymentsError) {
      throw new Error(`payments read for reconciliation failed: ${paymentsError.message}`);
    }
    if (!payments || payments.length === 0) {
      return { results: [], scannedPaymentCount: 0 };
    }

    const paymentIds = payments.map((p) => p.id);
    const orderIds = [...new Set(payments.map((p) => p.order_id))];

    const { data: transactions, error: transactionsError } = await this.supabase.admin
      .from('payment_transactions')
      .select('id, payment_id, amount_satang, provider_transaction_id, occurred_at')
      .in('payment_id', paymentIds)
      .eq('direction', 'IN')
      .order('occurred_at', { ascending: true })
      .returns<PaymentTransactionRow[]>();

    if (transactionsError) {
      throw new Error(`payment_transactions read for reconciliation failed: ${transactionsError.message}`);
    }

    const { data: cases, error: casesError } = await this.supabase.admin
      .from('reconciliation_cases')
      .select('payment_id, kind')
      .in('payment_id', paymentIds)
      .in('kind', ['LATE_PAYMENT', 'SURPLUS_PAYMENT'])
      .returns<ReconciliationCaseRow[]>();

    if (casesError) {
      throw new Error(`reconciliation_cases read for reconciliation failed: ${casesError.message}`);
    }

    const { data: orders, error: ordersError } = await this.supabase.admin
      .from('orders')
      .select('id, customer_id')
      .in('id', orderIds)
      .returns<OrderRow[]>();

    if (ordersError) {
      throw new Error(`orders read for reconciliation failed: ${ordersError.message}`);
    }

    // Earliest `payment_transactions` row per `payment_id` — the eligible
    // one. `transactions` is already ordered by `occurred_at` ascending, so
    // the first row seen per `payment_id` is the earliest.
    const eligibleTransactionByPaymentId = new Map<string, PaymentTransactionRow>();
    for (const transaction of transactions ?? []) {
      if (!eligibleTransactionByPaymentId.has(transaction.payment_id)) {
        eligibleTransactionByPaymentId.set(transaction.payment_id, transaction);
      }
    }

    // Payments already correctly explained at ingest time (LATE_PAYMENT: the
    // order moved on before this payment settled; SURPLUS_PAYMENT: a later
    // transaction against an already-SUCCESS payment) — never expected to
    // fund a CUSTOMER_PAYMENT, excluded from the eligible set entirely.
    const excludedPaymentIds = new Set((cases ?? []).map((c) => c.payment_id).filter((id): id is string => id !== null));

    const customerIdByOrderId = new Map((orders ?? []).map((o) => [o.id, o.customer_id]));

    const eligible = payments.filter((p) => !excludedPaymentIds.has(p.id) && eligibleTransactionByPaymentId.has(p.id));

    if (eligible.length === 0) {
      return { results: [], scannedPaymentCount: payments.length };
    }

    const expectedGroupKeyByPaymentId = new Map<string, string>();
    for (const payment of eligible) {
      const transaction = eligibleTransactionByPaymentId.get(payment.id)!;
      expectedGroupKeyByPaymentId.set(payment.id, `payment:${payment.id}:${transaction.provider_transaction_id}`);
    }
    const expectedGroupKeys = [...expectedGroupKeyByPaymentId.values()];

    const { data: groups, error: groupsError } = await this.supabase.admin
      .from('ledger_entry_groups')
      .select('id, group_key, order_id, kind')
      .in('group_key', expectedGroupKeys)
      .returns<LedgerEntryGroupRow[]>();

    if (groupsError) {
      throw new Error(`ledger_entry_groups read for reconciliation failed: ${groupsError.message}`);
    }

    const groupByKey = new Map((groups ?? []).map((g) => [g.group_key, g]));
    const groupIds = (groups ?? []).map((g) => g.id);

    let entriesByGroupId = new Map<string, LedgerEntryRow[]>();
    if (groupIds.length > 0) {
      const { data: entries, error: entriesError } = await this.supabase.admin
        .from('ledger_entries')
        .select('id, group_id, account, party_type, party_id, amount_satang')
        .in('group_id', groupIds)
        .eq('account', 'CUSTOMER_PAYMENT')
        .returns<LedgerEntryRow[]>();

      if (entriesError) {
        throw new Error(`ledger_entries read for reconciliation failed: ${entriesError.message}`);
      }

      entriesByGroupId = new Map<string, LedgerEntryRow[]>();
      for (const entry of entries ?? []) {
        const existing = entriesByGroupId.get(entry.group_id) ?? [];
        existing.push(entry);
        entriesByGroupId.set(entry.group_id, existing);
      }
    }

    const results: PaymentLedgerReconciliationResult[] = eligible.map((payment) => {
      const transaction = eligibleTransactionByPaymentId.get(payment.id)!;
      const expectedGroupKey = expectedGroupKeyByPaymentId.get(payment.id)!;
      const customerId = customerIdByOrderId.get(payment.order_id) ?? null;
      const group = groupByKey.get(expectedGroupKey);

      const base = {
        paymentId: payment.id,
        providerTransactionId: transaction.provider_transaction_id,
        orderId: payment.order_id,
        expectedGroupKey,
        paymentAmountSatang: transaction.amount_satang,
        customerId,
      };

      if (!group) {
        if (cutoverAt && payment.succeeded_at && new Date(payment.succeeded_at) < cutoverAt) {
          return {
            ...base,
            status: 'LEGACY_NOT_APPLICABLE',
            ledgerAmountSatang: null,
            ledgerGroupId: null,
            ledgerEntryIds: null,
            detail: 'Payment succeeded before the configured cutoverAt — CUSTOMER_PAYMENT was not yet posted by design.',
          };
        }

        if (graceWindowMs !== undefined && payment.succeeded_at) {
          const ageMs = Date.now() - new Date(payment.succeeded_at).getTime();
          if (ageMs >= 0 && ageMs < graceWindowMs) {
            return {
              ...base,
              status: 'IN_FLIGHT',
              ledgerAmountSatang: null,
              ledgerGroupId: null,
              ledgerEntryIds: null,
              detail: `No ledger group found yet, within the ${graceWindowMs}ms grace window (age ${ageMs}ms) — may still be posting.`,
            };
          }
        }

        return {
          ...base,
          status: 'MISSING_CUSTOMER_PAYMENT_LEDGER',
          ledgerAmountSatang: null,
          ledgerGroupId: null,
          ledgerEntryIds: null,
          detail: `No ledger_entry_groups row found for group_key ${expectedGroupKey}.`,
        };
      }

      const entries = entriesByGroupId.get(group.id) ?? [];

      if (entries.length > 1) {
        return {
          ...base,
          status: 'DUPLICATE_CUSTOMER_PAYMENT',
          ledgerAmountSatang: null,
          ledgerGroupId: group.id,
          ledgerEntryIds: entries.map((e) => e.id),
          detail: `${entries.length} CUSTOMER_PAYMENT entries found under one group — expected exactly one.`,
        };
      }

      if (entries.length === 0) {
        return {
          ...base,
          status: 'MISSING_CUSTOMER_PAYMENT_LEDGER',
          ledgerAmountSatang: null,
          ledgerGroupId: group.id,
          ledgerEntryIds: [],
          detail: 'ledger_entry_groups row exists but carries no CUSTOMER_PAYMENT entry (crash-window shape).',
        };
      }

      const entry = entries[0]!;

      if (group.order_id !== payment.order_id) {
        return {
          ...base,
          status: 'PAYMENT_LEDGER_IDENTITY_MISMATCH',
          ledgerAmountSatang: entry.amount_satang,
          ledgerGroupId: group.id,
          ledgerEntryIds: [entry.id],
          detail: `ledger_entry_groups.order_id (${group.order_id}) does not match payments.order_id (${payment.order_id}).`,
        };
      }

      if (entry.party_type !== 'CUSTOMER' || entry.party_id !== customerId) {
        return {
          ...base,
          status: 'PAYMENT_LEDGER_IDENTITY_MISMATCH',
          ledgerAmountSatang: entry.amount_satang,
          ledgerGroupId: group.id,
          ledgerEntryIds: [entry.id],
          detail: `CUSTOMER_PAYMENT party (${entry.party_type}/${entry.party_id}) does not match orders.customer_id (${customerId}).`,
        };
      }

      if (entry.amount_satang !== transaction.amount_satang) {
        return {
          ...base,
          status: 'PAYMENT_LEDGER_AMOUNT_MISMATCH',
          ledgerAmountSatang: entry.amount_satang,
          ledgerGroupId: group.id,
          ledgerEntryIds: [entry.id],
          detail: `payment_transactions.amount_satang (${transaction.amount_satang}) != CUSTOMER_PAYMENT.amount_satang (${entry.amount_satang}).`,
        };
      }

      return {
        ...base,
        status: 'MATCH',
        ledgerAmountSatang: entry.amount_satang,
        ledgerGroupId: group.id,
        ledgerEntryIds: [entry.id],
        detail: null,
      };
    });

    return { results, scannedPaymentCount: payments.length };
  }

  /**
   * Ledger → payment direction, the cheap orphan sweep (§ 11.1's Model C
   * second direction, retained only for this). Deliberately does **not**
   * parse any `group_key` string — `ledger_entry_groups.kind` already tags
   * a `CUSTOMER_PAYMENT` group explicitly, and `order_id` is a real column
   * on both sides, so this joins via `order_id` (unique on `payments`)
   * rather than reconstructing or splitting the key.
   */
  async reconcileOrphans(
    limit: number,
  ): Promise<{ results: PaymentLedgerReconciliationResult[]; scannedOrphanGroupCount: number }> {
    const { data: groups, error: groupsError } = await this.supabase.admin
      .from('ledger_entry_groups')
      .select('id, group_key, order_id, kind')
      .eq('kind', 'CUSTOMER_PAYMENT')
      .order('occurred_at', { ascending: true })
      .limit(limit)
      .returns<LedgerEntryGroupRow[]>();

    if (groupsError) {
      throw new Error(`ledger_entry_groups read for orphan reconciliation failed: ${groupsError.message}`);
    }
    if (!groups || groups.length === 0) {
      return { results: [], scannedOrphanGroupCount: 0 };
    }

    const orderIds = [...new Set(groups.map((g) => g.order_id).filter((id): id is string => id !== null))];

    // Only a SUCCESS payment ever backs a CUSTOMER_PAYMENT group — any other
    // state found here (should not happen under current write paths) does
    // not count as a valid backing payment either.
    const { data: successPayments, error: paymentsError } = await this.supabase.admin
      .from('payments')
      .select('id, order_id, amount_satang, succeeded_at')
      .in('order_id', orderIds)
      .eq('state', 'SUCCESS')
      .returns<SuccessPaymentRow[]>();

    if (paymentsError) {
      throw new Error(`payments read for orphan reconciliation failed: ${paymentsError.message}`);
    }

    const { data: entries, error: entriesError } = await this.supabase.admin
      .from('ledger_entries')
      .select('id, group_id, account, party_type, party_id, amount_satang')
      .in(
        'group_id',
        groups.map((g) => g.id),
      )
      .eq('account', 'CUSTOMER_PAYMENT')
      .returns<LedgerEntryRow[]>();

    if (entriesError) {
      throw new Error(`ledger_entries read for orphan reconciliation failed: ${entriesError.message}`);
    }

    // `payments.order_id` is unique — at most one SUCCESS payment per order.
    const paymentByOrderId = new Map((successPayments ?? []).map((p) => [p.order_id, p]));

    const entriesByGroupId = new Map<string, LedgerEntryRow[]>();
    for (const entry of entries ?? []) {
      const existing = entriesByGroupId.get(entry.group_id) ?? [];
      existing.push(entry);
      entriesByGroupId.set(entry.group_id, existing);
    }

    const orphanResults: PaymentLedgerReconciliationResult[] = [];

    for (const group of groups) {
      const payment = group.order_id ? paymentByOrderId.get(group.order_id) : undefined;

      // A payment exists for this order and it reached SUCCESS — not an
      // orphan. Whether it fully matches (amount/identity) is already
      // decided by the forward pass; the orphan pass only asks "does a
      // valid backing payment exist at all."
      if (payment) {
        continue;
      }

      const entries = entriesByGroupId.get(group.id) ?? [];
      orphanResults.push({
        status: 'ORPHAN_CUSTOMER_PAYMENT',
        paymentId: null,
        providerTransactionId: null,
        orderId: group.order_id,
        expectedGroupKey: group.group_key,
        paymentAmountSatang: null,
        ledgerAmountSatang: entries[0]?.amount_satang ?? null,
        customerId: entries[0]?.party_id ?? null,
        ledgerGroupId: group.id,
        ledgerEntryIds: entries.map((e) => e.id),
        detail: `CUSTOMER_PAYMENT group for order_id ${group.order_id} has no SUCCESS payment.`,
      });
    }

    return { results: orphanResults, scannedOrphanGroupCount: groups.length };
  }
}
