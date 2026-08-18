/**
 * Presentation for a failed catalog read (Phase C / C-9).
 *
 * UX-SPEC § 13 distinguishes two failures every screen must handle:
 *
 *   Offline / no network | `ไม่มีการเชื่อมต่ออินเทอร์เน็ต` | `ลองอีกครั้ง`
 *   Server error (500)   | `ระบบมีปัญหาชั่วคราว` + correlation id | `ลองอีกครั้ง`
 *
 * `useAsyncData` only exposes one `error` state with a message string, so
 * telling these apart happens here, from the message itself — no network-status
 * library is added for it. React Native's `fetch` throws "Network request
 * failed" when there is no connectivity at all (the web/Node equivalent is
 * "Failed to fetch"); anything else reaching this point is a genuine response
 * (or failure) from Supabase, not a connectivity problem.
 *
 * ## The correlation id is a real, unresolved mismatch — not filled in
 *
 * The spec's server-error copy names a "correlation id the user can quote".
 * That id is produced by the NestJS API's correlation-id middleware
 * (`apps/api/src/common/correlation`). Catalog reads never go through that API
 * — they are direct client → Supabase reads under RLS (DEC-APP-008) — so there
 * is no id to show. The spec was written with an API error envelope in mind;
 * direct reads are a different, also-approved architecture that predates a
 * correlation concept applying to them. This is documented here rather than
 * inventing a fake id, and stays open until a Product/Architecture decision
 * says what a direct-read failure should carry instead.
 */

export type LoadErrorKind = 'offline' | 'server';

const OFFLINE_MESSAGE_PATTERN =
  /network request failed|failed to fetch|internet connection appears to be offline/i;

export function classifyLoadError(message: string): LoadErrorKind {
  return OFFLINE_MESSAGE_PATTERN.test(message) ? 'offline' : 'server';
}

export interface LoadErrorPresentation {
  glyph: string;
  title: string;
  actionLabel: string;
}

const OFFLINE_PRESENTATION: LoadErrorPresentation = {
  glyph: '📡',
  title: 'ไม่มีการเชื่อมต่ออินเทอร์เน็ต',
  actionLabel: 'ลองอีกครั้ง',
};

const SERVER_PRESENTATION: LoadErrorPresentation = {
  glyph: '⚠️',
  title: 'ระบบมีปัญหาชั่วคราว',
  actionLabel: 'ลองอีกครั้ง',
};

/** UX-SPEC § 13 copy for the failure `message` classifies as. */
export function presentLoadError(message: string): LoadErrorPresentation {
  return classifyLoadError(message) === 'offline' ? OFFLINE_PRESENTATION : SERVER_PRESENTATION;
}
