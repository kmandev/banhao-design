import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

/** `payments`, the column this reversal needs — the exact amount `postCustomerPaymentLedger` originally posted (DEC-059 clause A). */
interface PaymentRow {
  order_id: string;
  amount_satang: number;
}

/** `orders`, the columns this reversal needs. */
interface OrderRow {
  customer_id: string;
  restaurant_id: string;
  service_fee_satang: number;
}

/** `ledger_entries`, the columns needed to read back the original recognized commission. */
interface LedgerEntryRow {
  account: string;
  party_id: string | null;
  amount_satang: number;
}

/** An anomaly this service cannot safely resolve on its own — thrown, never swallowed, so the caller's existing retry/audit path (`RefundEventProcessingService.processOne`) surfaces it. */
class LedgerReversalAnomaly extends Error {}

/**
 * Q-020 Slice 3 — refund ledger reversal (DEC-049 architecture, DEC-059
 * policy). Posts the three components DEC-059 §G locks as universal for a
 * full refund — `CUSTOMER_PAYMENT`, `SERVICE_FEE_REVENUE`,
 * `MERCHANT_COMMISSION` — each as its own independent, append-only reversal
 * group, never combined and never zero-summed against each other (DEC-049
 * clause 2/3).
 *
 * ## Two layers, permanently distinct (DEC-049 clause 1)
 *
 * `refunds.state` is the mutable process record `RefundEventProcessingService`
 * already owns. `ledger_entry_groups`/`ledger_entries` are append-only
 * accounting facts. This service only ever `INSERT`s — it never `UPDATE`s or
 * `DELETE`s a ledger row, matching the `reject_mutation` trigger both tables
 * already carry for every role, including `service_role`.
 *
 * ## Amount sourcing — original recognized facts, never recomputed
 *
 * - `CUSTOMER_PAYMENT`: `payments.amount_satang` — the same value
 *   `PaymentEventProcessingService.postCustomerPaymentLedger` used to post
 *   the original entry (DEC-059 clause A). Read fresh from `payments`, never
 *   from `refunds.amount_satang` (which happens to equal it under Slice 1's
 *   full-refund-only rule, but DEC-059 names `payments.amount_satang`
 *   specifically as the source of truth).
 * - `SERVICE_FEE_REVENUE`: `orders.service_fee_satang` — the immutable
 *   snapshot `create_order()` captured, never a current pricing constant
 *   (DEC-059 clause B, restating DEC-048/DEC-049 clause 8).
 * - `MERCHANT_COMMISSION`: read back from the **original posted
 *   `ledger_entries`** row itself (the `PLATFORM_REVENUE` entry in the
 *   order's own `MERCHANT_COMMISSION` group), never recomputed via
 *   `calculateFoodSubtotalCommissionSatang`. DEC-059 clause C is explicit
 *   that this must survive a future commission-rate change unchanged — the
 *   only way to guarantee that is to read the historical fact rather than
 *   re-derive it from current order data with the current (possibly
 *   different, future) rate.
 *
 * ## Independent groups, DEC-049's insert-first/self-heal pattern
 *
 * Each component is its own `group_key`, anchored on the **local refund
 * identity** (DEC-049 clause 6) — `refund:<component>:<refundId>` — never a
 * provider identifier. Insert is attempted first; a
 * `ledger_entry_groups_group_key_key` unique violation means the group
 * already exists (a duplicate/at-least-once redelivery of the same
 * `REFUNDED` transition, or a crash between the group insert and its entries
 * insert), so the existing group is read back and its entries are
 * reconciled: any entry that is missing is inserted (self-heal); any entry
 * that already exists is verified byte-for-byte against what this refund
 * would post and, on any mismatch, this throws rather than mutating or
 * duplicating anything (Step 14/24 — fail closed on an accounting anomaly,
 * never "fix" a historical row).
 *
 * ## Idempotency under at-least-once processing
 *
 * `RefundEventProcessingService.transitionRefund`'s own guarded `UPDATE` may
 * match zero rows on a redelivery of an already-`REFUNDED` refund — this
 * service's own correctness never depends on that call having actually
 * changed a row. Calling `postReversals` any number of times for the same
 * refund produces exactly one reversal group per component, because
 * `group_key` uniqueness — not a prior read, not a caller-tracked flag — is
 * the sole concurrency and idempotency authority, exactly the established
 * precedent the four live payment-side groups already use.
 *
 * ## No Stripe/network call
 *
 * This service reads and writes Supabase only. Nothing here calls the
 * payment provider — Slice 2 already established finality before this runs.
 */
@Injectable()
export class RefundLedgerReversalService {
  private readonly logger = new Logger(RefundLedgerReversalService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Posts all three DEC-059 §G universal full-refund reversal groups for one
   * `REFUNDED` refund. Called only once the caller has confirmed
   * `refunds.state = REFUNDED` (Step 4/9) — this method itself does not
   * re-check `refunds.state`, matching the existing codebase's own division
   * of concerns (`postCommissionLedger` et al. trust their caller's own
   * guarded transition the same way).
   */
  async postReversals(refundId: string, paymentId: string): Promise<void> {
    const { data: payment, error: paymentError } = await this.supabase.admin
      .from('payments')
      .select('order_id, amount_satang')
      .eq('id', paymentId)
      .maybeSingle<PaymentRow>();

    if (paymentError) {
      throw new Error(`payments read for refund ${refundId} ledger reversal failed: ${paymentError.message}`);
    }
    if (!payment) {
      throw new Error(`payments read for refund ${refundId} ledger reversal found no row for ${paymentId}`);
    }

    const { data: order, error: orderError } = await this.supabase.admin
      .from('orders')
      .select('customer_id, restaurant_id, service_fee_satang')
      .eq('id', payment.order_id)
      .maybeSingle<OrderRow>();

    if (orderError) {
      throw new Error(`orders read for refund ${refundId} ledger reversal failed: ${orderError.message}`);
    }
    if (!order) {
      throw new Error(`orders read for refund ${refundId} ledger reversal found no row for ${payment.order_id}`);
    }

    const { merchantId, commissionSatang } = await this.readOriginalCommission(refundId, payment.order_id);

    // Independent groups (DEC-049 clause 2) — one component's throw does not
    // prevent the others from being attempted on the next retry, because
    // each is individually idempotent via its own group_key.
    await this.reverseMerchantCommission(refundId, payment.order_id, merchantId, commissionSatang);
    await this.reverseCustomerPayment(refundId, payment.order_id, order.customer_id, payment.amount_satang);
    await this.reverseServiceFee(refundId, payment.order_id, order.service_fee_satang);
  }

  /**
   * Reads the order's own original `MERCHANT_COMMISSION` group — never
   * `calculateFoodSubtotalCommissionSatang` — per this file's own class doc
   * comment. DEC-028/`payments_order_id_key` guarantee at most one payment,
   * and therefore at most one original commission group, per order.
   */
  private async readOriginalCommission(
    refundId: string,
    orderId: string,
  ): Promise<{ merchantId: string; commissionSatang: number }> {
    const { data: group, error: groupError } = await this.supabase.admin
      .from('ledger_entry_groups')
      .select('id')
      .eq('order_id', orderId)
      .eq('kind', 'MERCHANT_COMMISSION')
      .is('refund_id', null)
      .maybeSingle<{ id: string }>();

    if (groupError) {
      throw new Error(`original MERCHANT_COMMISSION group read failed for order ${orderId}: ${groupError.message}`);
    }
    if (!group) {
      throw new LedgerReversalAnomaly(
        `refund ${refundId}: no original MERCHANT_COMMISSION ledger_entry_groups row found for order ${orderId} — cannot determine the recognized commission amount to reverse.`,
      );
    }

    const { data: entries, error: entriesError } = await this.supabase.admin
      .from('ledger_entries')
      .select('account, party_id, amount_satang')
      .eq('group_id', group.id)
      .returns<LedgerEntryRow[]>();

    if (entriesError) {
      throw new Error(`original MERCHANT_COMMISSION entries read failed for order ${orderId}: ${entriesError.message}`);
    }

    const revenueEntry = (entries ?? []).find((entry) => entry.account === 'PLATFORM_REVENUE');
    const payableEntry = (entries ?? []).find((entry) => entry.account === 'MERCHANT_PAYABLE');

    if (!revenueEntry || !payableEntry || !payableEntry.party_id) {
      throw new LedgerReversalAnomaly(
        `refund ${refundId}: original MERCHANT_COMMISSION group ${group.id} for order ${orderId} is missing its expected PLATFORM_REVENUE/MERCHANT_PAYABLE entries — cannot determine the recognized commission amount or merchant to reverse.`,
      );
    }

    return { merchantId: payableEntry.party_id, commissionSatang: revenueEntry.amount_satang };
  }

  /** `CUSTOMER_PAYMENT` reversal — DEC-049 clause 2/DEC-059 clause A. Single entry, independent group, negative. */
  private async reverseCustomerPayment(
    refundId: string,
    orderId: string,
    customerId: string,
    paymentAmountSatang: number,
  ): Promise<void> {
    await this.postIndependentGroup({
      refundId,
      orderId,
      groupKey: `refund:customer_payment:${refundId}`,
      kind: 'CUSTOMER_PAYMENT_REFUND',
      expectedEntries: [
        { account: 'CUSTOMER_PAYMENT', partyType: 'CUSTOMER', partyId: customerId, amountSatang: -paymentAmountSatang },
      ],
    });
  }

  /** `SERVICE_FEE_REVENUE` reversal — DEC-048/DEC-049 clause 2/DEC-059 clause B. Single entry, independent group, negative, same `PLATFORM_REVENUE` account the original recognition used. */
  private async reverseServiceFee(
    refundId: string,
    orderId: string,
    serviceFeeSatang: number,
  ): Promise<void> {
    await this.postIndependentGroup({
      refundId,
      orderId,
      groupKey: `refund:service_fee:${refundId}`,
      kind: 'SERVICE_FEE_REVENUE_REFUND',
      expectedEntries: [
        { account: 'PLATFORM_REVENUE', partyType: 'PLATFORM', partyId: null, amountSatang: -serviceFeeSatang },
      ],
    });
  }

  /**
   * `MERCHANT_COMMISSION` reversal — DEC-059 clause C, the one new lock this
   * decision adds. The exact accounting inverse of the original two-entry
   * group (`insertCommissionEntries`): each original entry is negated, so
   * original + reversal sums to zero per account/party — `MERCHANT_PAYABLE`
   * is credited back (the commission no longer reduces what the merchant is
   * owed) and `PLATFORM_REVENUE` is debited (the commission is no longer
   * recognized as platform revenue). Independent group, never combined with
   * `CUSTOMER_PAYMENT`/`SERVICE_FEE_REVENUE`.
   */
  private async reverseMerchantCommission(
    refundId: string,
    orderId: string,
    merchantId: string,
    commissionSatang: number,
  ): Promise<void> {
    await this.postIndependentGroup({
      refundId,
      orderId,
      groupKey: `refund:commission:${refundId}`,
      kind: 'MERCHANT_COMMISSION_REFUND',
      expectedEntries: [
        { account: 'MERCHANT_PAYABLE', partyType: 'MERCHANT', partyId: merchantId, amountSatang: commissionSatang },
        { account: 'PLATFORM_REVENUE', partyType: 'PLATFORM', partyId: null, amountSatang: -commissionSatang },
      ],
    });
  }

  /**
   * The shared insert-first/self-heal/content-verify shape every reversal
   * group above uses — DEC-049 clause 7, extended (Step 14/24) with a
   * per-entry content check the four live payment-side postings have never
   * needed: those are posted exactly once per their own immutable
   * `provider_transaction_id`, where a refund's `REFUNDED` transition can, in
   * principle, be reprocessed by more than one redelivered event, so this
   * service verifies rather than assumes.
   */
  private async postIndependentGroup(spec: {
    refundId: string;
    orderId: string;
    groupKey: string;
    kind: string;
    expectedEntries: Array<{
      account: string;
      partyType: 'CUSTOMER' | 'MERCHANT' | 'PLATFORM';
      partyId: string | null;
      amountSatang: number;
    }>;
  }): Promise<void> {
    const { data: inserted, error: insertError } = await this.supabase.admin
      .from('ledger_entry_groups')
      .insert({ group_key: spec.groupKey, order_id: spec.orderId, refund_id: spec.refundId, kind: spec.kind })
      .select('id')
      .maybeSingle<{ id: string }>();

    if (!insertError) {
      if (!inserted) {
        throw new Error(`ledger_entry_groups insert for ${spec.groupKey} returned no row`);
      }
      await this.insertEntries(inserted.id, spec.expectedEntries);
      return;
    }

    if (!isUniqueViolation(insertError)) {
      throw new Error(`ledger_entry_groups insert failed for ${spec.groupKey}: ${insertError.message}`);
    }

    // Already exists — a redelivered REFUNDED transition (self-heal), or a
    // crash between this group's own insert and its entries insert. Read it
    // back and reconcile rather than assuming either shape.
    await this.reconcileExistingGroup(spec);
  }

  private async reconcileExistingGroup(spec: {
    refundId: string;
    orderId: string;
    groupKey: string;
    kind: string;
    expectedEntries: Array<{
      account: string;
      partyType: 'CUSTOMER' | 'MERCHANT' | 'PLATFORM';
      partyId: string | null;
      amountSatang: number;
    }>;
  }): Promise<void> {
    const { data: existingGroup, error: groupReadError } = await this.supabase.admin
      .from('ledger_entry_groups')
      .select('id, order_id, refund_id, kind')
      .eq('group_key', spec.groupKey)
      .maybeSingle<{ id: string; order_id: string; refund_id: string | null; kind: string }>();

    if (groupReadError) {
      throw new Error(`ledger_entry_groups read-back failed for ${spec.groupKey}: ${groupReadError.message}`);
    }
    if (!existingGroup) {
      throw new Error(`ledger_entry_groups read-back found no row for ${spec.groupKey} after a unique conflict`);
    }

    // Step 14 — verify identity before touching anything. A group_key
    // collision on a different order/refund/kind would mean group_key
    // itself failed to anchor uniquely, which this file's own deterministic
    // `refund:<component>:<refundId>` construction should make impossible —
    // checked anyway, and fails closed rather than assuming.
    if (existingGroup.order_id !== spec.orderId || existingGroup.refund_id !== spec.refundId || existingGroup.kind !== spec.kind) {
      throw new LedgerReversalAnomaly(
        `refund ${spec.refundId}: ledger_entry_groups ${spec.groupKey} exists with conflicting identity ` +
          `(order_id=${existingGroup.order_id}, refund_id=${existingGroup.refund_id ?? 'null'}, kind=${existingGroup.kind}) ` +
          `— expected order_id=${spec.orderId}, refund_id=${spec.refundId}, kind=${spec.kind}. No mutation performed.`,
      );
    }

    const { data: existingEntries, error: entriesReadError } = await this.supabase.admin
      .from('ledger_entries')
      .select('account, party_id, amount_satang')
      .eq('group_id', existingGroup.id)
      .returns<LedgerEntryRow[]>();

    if (entriesReadError) {
      throw new Error(`ledger_entries read failed for ${spec.groupKey}: ${entriesReadError.message}`);
    }

    const missing: typeof spec.expectedEntries = [];

    for (const expected of spec.expectedEntries) {
      const matchByAccount = (existingEntries ?? []).find((entry) => entry.account === expected.account);

      if (!matchByAccount) {
        missing.push(expected);
        continue;
      }

      // Step 14/24 — content integrity. An entry with the right account but
      // the wrong party or amount is a financial anomaly, never something
      // this service "fixes" by overwriting a historical, append-only row.
      if (matchByAccount.party_id !== expected.partyId || matchByAccount.amount_satang !== expected.amountSatang) {
        throw new LedgerReversalAnomaly(
          `refund ${spec.refundId}: ledger_entries for group ${spec.groupKey} account ${expected.account} ` +
            `has party_id=${matchByAccount.party_id ?? 'null'}/amount_satang=${matchByAccount.amount_satang}, ` +
            `expected party_id=${expected.partyId ?? 'null'}/amount_satang=${expected.amountSatang}. No mutation performed.`,
        );
      }
    }

    if (missing.length === 0) {
      // Already fully posted and verified correct — the expected, common
      // idempotent-redelivery outcome.
      return;
    }

    this.logger.warn(
      `refund ${spec.refundId}: ledger_entry_groups ${spec.groupKey} exists with ${missing.length} of ` +
        `${spec.expectedEntries.length} expected entries missing — self-healing (crash-window recovery, Step 13/15).`,
    );
    await this.insertEntries(existingGroup.id, missing);
  }

  private async insertEntries(
    groupId: string,
    entries: Array<{
      account: string;
      partyType: 'CUSTOMER' | 'MERCHANT' | 'PLATFORM';
      partyId: string | null;
      amountSatang: number;
    }>,
  ): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const { error } = await this.supabase.admin.from('ledger_entries').insert(
      entries.map((entry) => ({
        group_id: groupId,
        account: entry.account,
        party_type: entry.partyType,
        party_id: entry.partyId,
        amount_satang: entry.amountSatang,
      })),
    );

    if (error) {
      throw new Error(`ledger_entries insert failed for group ${groupId}: ${error.message}`);
    }
  }
}

function isUniqueViolation(error: { code?: string; message: string }): boolean {
  return error.code === '23505' || error.message.includes('duplicate key');
}
