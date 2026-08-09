# 04 — Payment

**Status: IN PROGRESS**

Payment architecture: state machine, flows, ledger model, driver payout handling, edge cases.

- [`BANHAO Payment Architecture.dc.html`](./BANHAO%20Payment%20Architecture.dc.html) — the current source of truth. Covers Phase 1 cash + PromptPay QR.

See root [AGENTS.md](../../AGENTS.md) for the non-negotiable rules that apply to any code touching payments (order/payment state separation, backend-confirmed payment events only, ledger auditability).
