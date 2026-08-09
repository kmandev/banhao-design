# Contributing

## Branch naming

`<type>/<short-description>`, e.g. `docs/payment-refund-flow`, `design/driver-app-onboarding`, `fix/tracking-map-pin-color`.

Common `<type>` values: `feat`, `fix`, `docs`, `design`, `chore`, `refactor`.

## Commit conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <summary>`.

Examples:
- `docs(payment): add refund state to ledger doc`
- `design(customer): add empty-cart state to screen 09`
- `fix(tracking): correct driver pin color`

Keep the summary in the imperative mood and under ~70 characters. Explain *why* in the commit body when the reason isn't obvious from the diff.

## Documentation requirements

- Any change to payment behavior must update [`docs/04-payment`](docs/04-payment/) in the same PR — see [AGENTS.md](AGENTS.md).
- Any change to product scope, sitemap, or the order state machine must update [`docs/05-architecture`](docs/05-architecture/).
- New UI surfaces (driver, merchant, admin) should get both a `design/<surface>/` canvas and a matching `docs`/`specs` update once they move past sitemap stage.
- Don't leave a folder's `README.md` status stale — update `TODO` / `IN PROGRESS` / `DONE` when you change what lives in that folder.

## Pull request expectations

- Keep PRs small and reviewable — one logical change per PR.
- Describe *why*, not just *what*, in the PR description.
- Never delete existing design assets in a PR; move superseded ones to `archive/` instead.
- Flag any PR that touches payment logic explicitly in the description, and confirm order state and payment state remain separate (see [AGENTS.md](AGENTS.md)).
- No secrets, API keys, or provider credentials in any commit.
