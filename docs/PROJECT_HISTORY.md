# BANHAO Project History

## Known History

Evidence: `git log`, `git log --stat` (repository `banhao-design`, branch `main`).

### 2026-08-09 — Initial design drop (commit `7d0a7d5`, "add design")

Four `.dc.html` interactive design canvases (Customer App, Design System, Payment Architecture, Product Architecture), a `tracking-map.html` prototype, the `support.js` canvas runtime, and two annotated QA feedback screenshots were added to the repository in a single commit. 10 files, 4,541 insertions.

### 2026-08-09 — First repository restructuring (commit `f3939d6`, "create structure project files")

The flat `design/` folder was reorganized into a `docs/` / `design/` / `assets/` / `specs/` / `archive/` structure during an AI-assisted session (Claude Code). All original files were preserved and moved with `git mv`; every rename was verified 100% content-identical (no design content modified). Root `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, and per-directory `README.md` stubs were added, plus a `.gitignore`. 42 files changed, 6,042 insertions.

### 2026-08-09 — AI project memory system created (this session)

`docs/AI_CONTEXT.md`, `PROJECT_HISTORY.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `ROADMAP.md`, `CURRENT_STATUS.md`, `TODO.md`, `CHANGELOG.md`, and `ai/README.md`, `ai/SESSION_LOG/`, `ai/PROMPTS/AI_AUDIT.md` were created so that multiple AI agents (Claude Code, ChatGPT, Gemini, Codex, Cursor, or others) can pick up work on this repository without losing context. See `ai/SESSION_LOG/2026-08-09.md` for the full session record.

## Reconstructed History

Both `7d0a7d5` and `f3939d6` are authored by the same git user (`kman <kman@gmail.com>`), roughly 21 minutes apart (11:36:42 → 11:57:06 local commit time per `git log`), suggesting the initial design drop and the first reorganization happened within the same working session.

`.gitignore` was edited after `f3939d6` to add `.DS_Store?`, `*.swp`, `*.swo`, `.idea/`, `.vscode/` on top of the two entries the AI session originally wrote (`.DS_Store`, `Thumbs.db`) — this happened outside any AI session tracked in `ai/SESSION_LOG/` as of this writing, so it's recorded here as an inferred, undated edit rather than in the Known History section above.

## Unknown History

- **Conversation history unavailable in repository.** Any design discussion, iteration, or decision-making that produced the four `.dc.html` canvases before the first commit is not recorded anywhere in this repo.
- No repository evidence exists for *why* อำเภอบุณฑริก was chosen as the launch area, *why* Phase order is Food → Parcel → Ride → Shopping, or *why* PromptPay specifically was chosen as the target payment method (beyond it being named in every canvas header as the Phase 1 payment method). These are treated as given product facts from the originating project brief, not decisions this history can independently source or date.
- No information exists about who commissioned the initial design work or what tool/process produced the `.dc.html` canvases beyond the internal `dc-runtime` tool referenced in `support.js`'s build comment.
