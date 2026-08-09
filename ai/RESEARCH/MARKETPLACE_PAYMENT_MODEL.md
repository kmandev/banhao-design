# Marketplace Payment Model Analysis

BANHAO is a three-sided marketplace, not a simple online store:

```
Customer
    ↓ pays
BANHAO (platform)
    ↓ splits
Merchant (gets paid for food)      Driver (gets paid for delivery)
```

This document analyzes what that implies, grounded in what's already documented in `docs/04-payment` and `ai/KNOWLEDGE/`. It does not choose a payment provider or settlement mechanism — see `ai/RESEARCH/PAYMENT_RESEARCH.md` for provider options, and Q-001/Q-002 for the still-open decisions.

## Where money goes (as already documented)

From `docs/ARCHITECTURE.md` § Ledger Model and the underlying `docs/04-payment` canvas:

- **PromptPay QR payment:** money goes from customer → payment provider → (eventually) platform-controlled account, then must be split out to merchant and driver.
- **Cash payment:** money goes from customer → driver directly. The driver is then holding platform money temporarily (DEC-004) — a liability, not driver income — until it's remitted to the platform (or netted against what the platform owes the driver for delivery fees).

## Platform fee

Documented as a real line item in the ledger examples (`docs/04-payment` § "04 — LEDGER": "รายได้บ้านเฮา" / "ค่าธรรมเนียมแพลตฟอร์ม" appear in both the driver-earnings and merchant-earnings breakdowns), but **no specific fee percentage or formula is documented anywhere** — this is a genuine gap, not an oversight in this research. See Q-010 (new, added by this research task).

## Merchant settlement

Documented in `docs/04-payment` ("ร้านค้า · รายได้และรอบโอน" section): merchants see a table of paid-and-awaiting-transfer orders (order ID, payment method, gross amount, fee, net amount) and a transfer-round history. Notably: **cash orders do not enter a transfer round at all**, because the merchant already received cash from the driver at handoff — the platform instead deducts its fee from the *next* transfer round. This is an already-documented design decision (not new to this research) with a real implication: the settlement engine needs to support "fee owed but no transfer needed" as a state, not just "transfer pending."

## Driver settlement

Documented in `docs/04-payment` ("ไรเดอร์ · เก็บเงินสดและรายได้" section): drivers see today's earnings (delivery fees + bonuses) separately from cash collected on the platform's behalf (DEC-004/REQ-001), a running "must remit" cash balance, and a transfer-round history. The document also states — without giving the actual number — that there's a cash-remittance limit past which the system stops assigning new jobs to that driver (Q-004, already open).

## What this implies for payment provider capability (informs, doesn't decide, `ai/RESEARCH/PAYMENT_RESEARCH.md`)

- The provider (or the application logic layered on top of a simpler provider) needs to support routing money to **multiple recipients** per order-cohort — not just "customer pays platform," but eventually "platform pays merchant" and "platform pays driver" on a schedule (the "รอบโอน" / transfer rounds).
- This is commonly called **marketplace payments**, **split payments**, or **sub-merchant/multi-party payouts** in the payment industry — whether a chosen provider supports this natively, or whether BANHAO's own backend needs to calculate splits and initiate separate payout transfers through a simpler payment gateway, is an open technical/vendor question (`ai/RESEARCH/PAYMENT_RESEARCH.md` researches specific providers' capability here).
- Cash handling is **not** a payment-gateway concern at all — it's purely an internal ledger/reconciliation problem (a driver owes the platform money, tracked entirely in BANHAO's own database), which is one reason CON-003 (ledger must balance to zero) and TR-005/TR-006 (`ai/RESEARCH/TECHNOLOGY_REQUIREMENTS.md`) matter regardless of which payment provider is chosen for the digital-payment side.

## Reconciliation

Documented in `docs/04-payment` ("แอดมิน · ภาพรวมการเงินและการกระทบยอด" / Admin finance & reconciliation section): the admin's daily-use screen is explicitly a reconciliation view, not a revenue chart — two balance checks are shown as examples: (online payments + cash collected by drivers = total sales) and (merchant payouts + driver payouts + platform revenue + refunds = total sales). Both must read "ตรงกัน ✓" (matched). This is the concrete, UI-level expression of CON-003.

## Refunds and chargebacks

Refund rules are documented at the *order* level (`docs/ARCHITECTURE.md` § Order State Machine — auto-refund before `PREPARING`, shop-confirmed during `PREPARING`, support-center-only after `PICKED_UP`) and the *payment* level (`REFUND_PENDING → REFUND_PROCESSING → REFUNDED`, webhook-only for the final state, per CON-002). **Chargebacks specifically (a customer disputing a charge with their bank/card issuer, as opposed to requesting a refund through BANHAO) are not mentioned anywhere in the repository** — this is a genuine gap. See Q-011 (new).

## Accounting/tax touchpoint

The ledger model (balances to zero per order, with merchant/driver/platform-fee/refund line items) is structurally close to what a bookkeeping system would need, but no repository content addresses actual accounting treatment (revenue recognition, VAT handling per transaction, driver 1099-equivalent reporting). This is explicitly a compliance/legal area — see `ai/RESEARCH/THAILAND_COMPLIANCE.md`.

## Summary — what's solid vs. what's open

| Aspect | Status |
|---|---|
| Order/Payment state separation | Solid — CON-001, fully specified |
| Webhook-only confirmation | Solid — CON-002, fully specified |
| Ledger balances to zero | Solid — CON-003, fully specified |
| Cash-as-liability model | Solid — DEC-004, fully specified |
| Merchant transfer-round mechanics | Solid — documented in `docs/04-payment` |
| Driver transfer-round mechanics | Solid — documented in `docs/04-payment` |
| Exact platform fee amount/formula | **Open** — Q-010 |
| Cash-remittance limit number | **Open** — Q-004 (pre-existing) |
| Chargeback handling | **Open** — Q-011 |
| Which provider supports marketplace payouts | **Open** — researched in `ai/RESEARCH/PAYMENT_RESEARCH.md`, decision is Q-001 |
| Legal marketplace/settlement model | **Open** — Q-002 (pre-existing) |
