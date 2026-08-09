# AGENTS.md

Rules for any AI coding agent (or human) working in this repository.

## Source of truth

- Treat this repository as the single source of truth for BANHAO product design, architecture, and process.
- Read the relevant documentation in `docs/` and the relevant `.dc.html` canvas in `design/` **before** modifying code or design files. Don't guess at intent from filenames alone.
- Do not invent business rules. If a flow, edge case, or policy isn't documented, ask or flag it — don't assume a plausible-sounding default and ship it as if it were specified.

## Payments — non-negotiable

- Do not change payment behavior without updating [`docs/04-payment`](docs/04-payment/) in the same change.
- **Order State and Payment State must remain separate.** An order's lifecycle (placed, preparing, out for delivery, delivered, cancelled) and a payment's lifecycle (pending, authorized, captured, failed, refunded) are distinct state machines. Never collapse them into one field or infer one from the other.
- Never implement payment confirmation based only on client-side state. A client saying "payment done" is not proof of payment.
- Payment confirmation must come from trusted backend/provider events (e.g. a verified PromptPay/provider webhook or a backend poll of provider status) — never from a client callback, redirect parameter, or UI state alone.
- Use auditable ledger concepts for financial transactions: every money movement should be an appended, immutable record (not just a mutable balance field), so state can be reconstructed and audited after the fact.

## Secrets & credentials

- Never store secrets in Git — no API keys, tokens, passwords, or provider credentials in commits, including in example/test files.
- Never hardcode payment provider credentials anywhere in the codebase. Use environment/config injection instead.

## Design assets

- Do not delete existing design assets. If something is superseded, move it to `archive/` instead of deleting it.
- The `.dc.html` files each depend on a local `support.js` in the same directory — if you move or copy a `.dc.html` file, bring its `support.js` with it (or verify the existing copy still resolves).

## Working style

- Prefer small, reviewable changes over large sweeping ones.
- Update documentation in the same change when architecture, payment behavior, or product scope changes — don't let docs drift from reality.
