# Repository Strategy Analysis

## Options considered

### Single repository (this repository, `banhao-design`, continues to hold everything)

Design, docs, memory system, and (eventually) all application code for all four surfaces live in one Git repository.

**Pros:** One clone, one place to search, one PR can span a backend change + the docs update it requires (matching the `CONTRIBUTING.md` rule that payment/architecture changes must update their docs in the same change). Matches how this project has operated so far — the AI Memory System (`ai/`) already assumes a single repository as "the shared project memory" (`ai/README.md`).

**Cons:** As real application code is added (backend + 4 frontends + shared packages), the repository grows large and CI times can grow with it unless scoped carefully (e.g. only running tests for what changed).

### Monorepo (formalized, with a build tool)

Same single-repository idea, but explicitly organized with a monorepo build tool (e.g. a workspace/package-manager feature, plus a task runner that understands the dependency graph between packages) so that shared packages (API types, design tokens) and independent apps coexist cleanly with fast, scoped builds.

**Pros:** All the single-repository benefits above, plus: shared type/contract packages become first-class (directly supports TR-002/CON-001 — the Order/Payment state values can be defined once and imported everywhere), scoped CI (only rebuild/retest what changed), and a natural home for `specs/` and `design/` to sit next to the code they describe, continuing this repository's existing structure (`docs/`, `design/`, `specs/`, `ai/`).

**Cons:** Requires adopting monorepo tooling with its own configuration and learning curve; very large monorepos can eventually need investment in caching/remote build infrastructure (not a near-term concern at BANHAO's current scale — see `ai/RESEARCH/SCALE_MODEL.md`).

### Multiple repositories (one per app/service)

Backend, Customer App, Merchant Web, Driver App, Admin Web each get their own repository.

**Pros:** Smallest possible repository per team/AI-session context; simplest permission boundaries if different people/teams eventually own different surfaces; each repo's CI is inherently scoped to just that app.

**Cons:** Directly works against the AI Memory System's core premise — `ai/README.md` and `ai/MEMORY.md` describe a *single* shared project memory that any AI agent can read to understand the whole project; splitting into multiple repos would require either duplicating the memory system across repos (drift risk) or building cross-repo tooling to keep it synchronized, which this task's constraints (`31. ห้ามเพิ่ม database... ใช้ Markdown, Git, Directory Structure เท่านั้น`, from the AI Memory System v2 task) did not anticipate. Shared type contracts (Order/Payment states) would need to be published as versioned packages and consumed across repos, adding a release/versioning step to what CON-001 needs to stay in sync.

## Analysis for BANHAO specifically

Two things are already true and load-bearing:

1. This repository already *is* the single source of truth for product/design/documentation/memory (`docs/AI_CONTEXT.md` § Project Identity: "Treat this repository as the single source of truth"). Splitting into multiple repos before application code even exists would fragment something that's explicitly designed to be unified.
2. CON-001 and REQ-002 both depend on every client agreeing on the same Order/Payment state definitions. A monorepo with a shared types package makes "all four apps agree on the state machine" a compile-time/type-level guarantee; separate repos make it a discipline/process guarantee (weaker, more failure-prone, especially relevant since much of this project's development is AI-assisted and benefits from compiler-level guardrails over process-level ones).

This suggests a **monorepo built on this existing repository** is the strongest-fitting option of the three, once application code begins — continuing the existing single-repository pattern but formalizing it with monorepo tooling once there's more than documentation to manage. This is an analysis, not a decision; the Product Owner may weigh team/hiring/tooling preferences differently. See `ai/KNOWLEDGE/PROPOSALS.md` for the formal (non-binding) proposal record.

## AI coding workflow consideration

A monorepo also fits how this project has already been operating: every AI session so far has needed the full picture (design + architecture + memory) to work correctly (see `ai/README.md`'s context-loading levels). A single repository keeps that true as application code is added — see `ai/RESEARCH/AI_DEVELOPMENT_WORKFLOW.md`.
