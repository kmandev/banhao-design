# Changelog

All notable changes to this repository are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Changed

- Reorganized the repository into a long-term structure: `docs/`, `design/`, `assets/`, `specs/`, `archive/`.
  - Moved the four `.dc.html` design canvases into their subject-specific folders (`design/customer/`, `design/design-system/`, `docs/04-payment/`, `docs/05-architecture/`).
  - Moved `tracking-map.html` to `design/tracking/`.
  - Moved the two annotated QA screenshots from `design/uploads/` to `assets/screenshots/`.
  - Duplicated `support.js` (the shared canvas runtime) alongside each `.dc.html` file so every canvas stays self-contained without editing its markup.
  - Added root `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, and this `CHANGELOG.md`.
  - No design content was modified; no files were deleted.

## [0.1.0] — 2026-08-09

### Added

- Initial design drop: Customer App, Design System, Payment Architecture, and Product Architecture canvases; tracking-map prototype; two QA feedback screenshots.
