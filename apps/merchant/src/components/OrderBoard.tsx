'use client';

import { useState } from 'react';
import { useOrderBoard } from '../hooks/useOrderBoard';
import { useOrderActions } from '../hooks/useOrderActions';
import type { MerchantOrderRealtimeStatus } from '../hooks/useOrderRealtime';
import { BOARD_COLUMNS, groupOrdersByColumn, type BoardColumnId } from '../lib/orderBoardDisplay';
import { OrderCard } from './OrderCard';

/**
 * The Order Board (M-2.6) — design
 * `docs/design/BANHAO M-2.6 Merchant Order Board.dc.html`.
 *
 * Consumes `useOrderBoard(restaurantId)` (M-2.5) exclusively: no direct
 * Supabase access, no second repository, no second Realtime subscription,
 * no polling. `restaurantId` is expected to already be a membership-verified
 * value (`useRestaurantScope`'s `currentRestaurantId`, passed down from
 * `dashboard/page.tsx`) — this component neither reads `localStorage` nor
 * re-derives scope.
 *
 * State → column mapping and every piece of Thai copy are exactly the
 * design's §06/§07 "SPECIFIED" list; see `../lib/orderBoardDisplay` for the
 * derivations and their citations. Rejection, accept/start/ready mutations,
 * the order-detail panel, and everything else the design's own "OUT OF
 * SCOPE FOR M-2.6" box lists are not implemented here.
 *
 * ## No ticking timer
 *
 * `now` is read once per render (`Date.now()`), not from a `setInterval` —
 * M-2.6's own rules forbid introducing a timer here, the same as M-2.5's
 * data layer forbids one for fetching. See `orderBoardDisplay.ts`'s module
 * doc comment for the fidelity trade-off this implies against the design's
 * "ticks client-side" language.
 *
 * ## Tablet breakpoint
 *
 * 768–1024px collapses to two columns (`ใหม่ · รอตอบรับ`, `กำลังทำ`) plus a
 * bottom tray for `พร้อมให้ไรเดอร์รับ` — the one column with no merchant
 * action (UX-SPEC §6). Implemented with a CSS media query, not a resize
 * listener (no new client-side machinery, same technique `Spinner.tsx`
 * already uses for its keyframes). The tray's manual expand/collapse is a
 * plain click toggle; the design's "auto-expands once for 5 seconds" tray
 * behaviour is explicitly tagged a DESIGN CHOICE, not SPECIFIED (§07), and
 * implementing it would need a timer — so it is intentionally omitted here.
 * Below 768px, the same tablet layout is kept as a floor rather than
 * building an unspecified third layout (§07 marks anything under 768px
 * "NOT DECIDED... a safety net, not a proposed mobile workflow").
 */

function isDegraded(status: MerchantOrderRealtimeStatus): boolean {
  return status !== 'IDLE' && status !== 'CONNECTING' && status !== 'SUBSCRIBED';
}

function ColumnHeader({
  title,
  statesLabel,
  count,
  accent,
  badgeBackground,
  badgeColor,
}: {
  title: string;
  statesLabel: string;
  count: number | null;
  accent: string;
  badgeBackground: string;
  badgeColor: string;
}) {
  return (
    <>
      <div style={{ height: 4, background: accent }} aria-hidden />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 16px',
          borderBottom: '1px solid #F1E9DE',
        }}
      >
        <h2 style={{ fontSize: 15.5, fontWeight: 700, margin: 0 }}>{title}</h2>
        {count !== null ? (
          <div
            style={{
              minWidth: 26,
              height: 26,
              padding: '0 8px',
              borderRadius: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: "'IBM Plex Mono',monospace",
              fontSize: 13,
              fontWeight: 600,
              background: badgeBackground,
              color: badgeColor,
            }}
          >
            {count}
          </div>
        ) : null}
        <div style={{ flex: 1 }} />
        <div
          style={{
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: 10.5,
            color: '#A2968A',
            textAlign: 'right',
            lineHeight: 1.5,
          }}
        >
          {statesLabel}
        </div>
      </div>
    </>
  );
}

const COLUMN_ACCENT: Record<BoardColumnId, { accent: string; badgeBackground: string; badgeColor: string }> = {
  NEW: { accent: '#E4572E', badgeBackground: '#FDEEE7', badgeColor: '#C2431F' },
  PREPARING: { accent: '#B98418', badgeBackground: '#FBF1DC', badgeColor: '#9A7810' },
  READY: { accent: '#0F8B5F', badgeBackground: '#EAF6EF', badgeColor: '#0F8B5F' },
};

function BoardSkeletonColumn({ title, accent }: { title: string; accent: string }) {
  return (
    <div style={{ borderRadius: 18, background: '#fff', border: '1px solid #EAE1D6', overflow: 'hidden' }}>
      <div style={{ height: 4, background: accent }} aria-hidden />
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #F1E9DE' }}>
        <h2 style={{ fontSize: 15.5, fontWeight: 700, margin: 0 }}>{title}</h2>
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="banhao-board-skeleton-block" style={{ height: 80, borderRadius: 12 }} />
        <div className="banhao-board-skeleton-block" style={{ height: 80, borderRadius: 12 }} />
      </div>
    </div>
  );
}

function BoardError({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div
      role="alert"
      style={{
        borderRadius: 20,
        border: '1px solid #E2D8CB',
        background: '#F6F0E7',
        minHeight: 296,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
      }}
    >
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <div
          aria-hidden
          style={{
            width: 52,
            height: 52,
            borderRadius: 16,
            background: '#FBEAEA',
            color: '#D93A3A',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 26,
            fontWeight: 700,
            margin: '0 auto 16px',
          }}
        >
          !
        </div>
        <div style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.5 }}>โหลดออเดอร์ไม่สำเร็จ</div>
        <div style={{ fontSize: 14, color: '#5A4E42', lineHeight: 1.7, marginTop: 8 }}>
          ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง ถ้ายังไม่ได้ ให้ติดต่อผู้ดูแลระบบ
        </div>
        {message ? (
          <div style={{ fontSize: 12, color: '#A2968A', marginTop: 8 }}>{message}</div>
        ) : null}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onRetry}
            style={{
              height: 56,
              padding: '0 26px',
              borderRadius: 16,
              background: '#E4572E',
              color: '#fff',
              border: 'none',
              fontSize: 16,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ลองใหม่อีกครั้ง
          </button>
        </div>
      </div>
    </div>
  );
}

function ConnectionBanner({ tone, text }: { tone: 'reconnecting' | 'error'; text: string }) {
  const palette =
    tone === 'reconnecting'
      ? { background: '#FDF3E6', border: '#F0DFC4', color: '#8A6412' }
      : { background: '#FBEAEA', border: '#EFCFCF', color: '#B32B2B' };

  return (
    <div
      role="status"
      style={{
        background: palette.background,
        borderBottom: `1px solid ${palette.border}`,
        borderRadius: '20px 20px 0 0',
        padding: '12px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          border: `2.5px solid ${palette.color}55`,
          borderTopColor: palette.color,
          display: 'inline-block',
          flex: '0 0 auto',
        }}
        className="banhao-board-spin"
      />
      <div style={{ fontSize: 14, fontWeight: 700, color: palette.color }}>{text}</div>
    </div>
  );
}

export interface OrderBoardProps {
  restaurantId: string | null;
}

export function OrderBoard({ restaurantId }: OrderBoardProps) {
  const { orders, loading, error, realtimeStatus, refetch } = useOrderBoard(restaurantId);
  // M-2.7. Per-card, never global: `isPending`/`errorFor` are asked about one
  // order at a time, so a command on one card leaves every other card fully
  // interactive and never draws a board-wide overlay.
  const actions = useOrderActions();
  const [trayExpanded, setTrayExpanded] = useState(false);
  // Read once per render — not a ticking clock. See the module doc comment.
  const now = Date.now();

  const grouped = groupOrdersByColumn(orders);
  const hasAnyOrders = orders.length > 0;
  const degraded = isDegraded(realtimeStatus);

  return (
    <div>
      <style>{`
        .banhao-board-skeleton-block {
          background: linear-gradient(90deg, #F4EDE3 25%, #FAF5EE 50%, #F4EDE3 75%);
          background-size: 320px 100%;
          animation: banhao-board-shimmer 1.3s linear infinite;
        }
        @keyframes banhao-board-shimmer { 0% { background-position: -320px 0; } 100% { background-position: 320px 0; } }
        .banhao-board-spin { animation: banhao-board-spin .9s linear infinite; }
        @keyframes banhao-board-spin { to { transform: rotate(360deg); } }
        .banhao-board-columns {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          padding: 20px;
          align-items: start;
        }
        .banhao-board-ready-toggle { display: none; }
        .banhao-board-ready-body { display: flex; flex-direction: column; gap: 12px; padding: 14px; }
        .banhao-order-action-spinner { animation: banhao-board-spin .9s linear infinite; }
        @media (max-width: 1024px) {
          .banhao-board-columns { grid-template-columns: repeat(2, 1fr); }
          /*
            Design §05 (SPECIFIED): "Touch targets rise to 56px throughout"
            at the 768–1024px tablet breakpoint, matching the design's own
            tablet card markup (56px) against its desktop board markup (52px).
            Carried as a custom property rather than a height rule because
            OrderCard sets its height inline, and an inline style wins over a
            stylesheet declaration — the variable is the one channel that can
            reach it. Cards rendered outside this board keep the 52px fallback.

            Note for review: the design is internally inconsistent about the
            desktop value — §01 anatomy and the §06 accessibility list both say
            56px on desktop too, while the §02 desktop board markup renders
            52px. This follows the markup, which is what M-2.6 implemented and
            what was visually verified. Resolving that is a design question,
            not an M-2.7 decision, and is reported rather than settled here.
          */
          .banhao-board-columns { --banhao-action-height: 56px; }
          .banhao-board-column--ready {
            grid-column: 1 / -1;
            border-radius: 18px;
            box-shadow: 0 -8px 30px rgba(31,26,22,.10);
          }
          .banhao-board-ready-toggle { display: flex; }
          .banhao-board-ready-body { display: none; flex-direction: row; overflow-x: auto; }
          .banhao-board-ready-body.is-expanded { display: flex; }
        }
      `}</style>

      {loading ? (
        <div style={{ borderRadius: 20, border: '1px solid #E2D8CB', background: '#F6F0E7', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, padding: 20 }}>
            {BOARD_COLUMNS.map((column) => (
              <BoardSkeletonColumn key={column.id} title={column.title} accent={COLUMN_ACCENT[column.id].accent} />
            ))}
          </div>
          <div
            style={{
              padding: '0 16px 18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              fontSize: 13,
              color: '#7A6E64',
            }}
          >
            <span
              className="banhao-board-spin"
              aria-hidden
              style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                border: '2.5px solid #E2D8CB',
                borderTopColor: '#E4572E',
                display: 'inline-block',
              }}
            />
            กำลังโหลดออเดอร์
          </div>
        </div>
      ) : error && !hasAnyOrders ? (
        <BoardError message={error} onRetry={refetch} />
      ) : (
        <div style={{ borderRadius: 20, border: '1px solid #E2D8CB', background: '#F6F0E7', overflow: 'hidden' }}>
          {degraded ? (
            <ConnectionBanner tone="reconnecting" text="การเชื่อมต่อหลุด · กำลังเชื่อมต่อใหม่" />
          ) : null}
          {error && hasAnyOrders ? (
            <ConnectionBanner tone="error" text={`อัปเดตล่าสุดล้มเหลว · ${error}`} />
          ) : null}

          <div className="banhao-board-columns">
            {BOARD_COLUMNS.map((column) => {
              const columnOrders = grouped[column.id];
              const { accent, badgeBackground, badgeColor } = COLUMN_ACCENT[column.id];
              const isReady = column.id === 'READY';

              return (
                <div
                  key={column.id}
                  className={isReady ? 'banhao-board-column--ready' : undefined}
                  style={{ borderRadius: 18, background: '#fff', border: '1px solid #EAE1D6', overflow: 'hidden' }}
                >
                  <ColumnHeader
                    title={column.title}
                    statesLabel={column.statesLabel}
                    count={columnOrders.length}
                    accent={accent}
                    badgeBackground={badgeBackground}
                    badgeColor={badgeColor}
                  />

                  {/*
                    READY is the one column with no merchant action
                    (UX-SPEC §6), so at the 768–1024px tablet breakpoint it
                    becomes a collapsed-by-default tray instead of a plain
                    column — SPECIFIED, design §05. This toggle row is
                    CSS-hidden at desktop width (`.banhao-board-ready-toggle`)
                    and is the tablet tray's summary bar; there is exactly
                    ONE body element below holding this column's cards
                    (`.banhao-board-ready-body`), shown unconditionally at
                    desktop width and gated by `trayExpanded` only at tablet
                    width — never a second, duplicate render of the same
                    orders for the two breakpoints.
                  */}
                  {isReady ? (
                    <button
                      type="button"
                      data-testid="ready-tray-toggle"
                      className="banhao-board-ready-toggle"
                      onClick={() => setTrayExpanded((expanded) => !expanded)}
                      aria-expanded={trayExpanded}
                      aria-label={`${column.title} — ${trayExpanded ? 'ปิดรายการ' : 'เปิดดูรายการ'}`}
                      style={{
                        width: '100%',
                        alignItems: 'center',
                        gap: 12,
                        padding: '0 16px',
                        height: 48,
                        background: 'none',
                        border: 'none',
                        borderBottom: '1px solid #F1E9DE',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ fontSize: 13, color: '#7A6E64' }}>รอไรเดอร์มารับ · ไม่ต้องกดอะไร</span>
                      <span style={{ flex: 1 }} />
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{trayExpanded ? 'ปิด ▼' : 'เปิดดู ▲'}</span>
                    </button>
                  ) : null}

                  <div
                    className={isReady ? `banhao-board-ready-body${trayExpanded ? ' is-expanded' : ''}` : undefined}
                    style={isReady ? undefined : { display: 'flex', flexDirection: 'column', gap: 12, padding: 14 }}
                  >
                    {columnOrders.length === 0 ? (
                      <div style={{ padding: '34px 16px', textAlign: 'center' }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#7A6E64', lineHeight: 1.6 }}>
                          {column.emptyCopy}
                        </div>
                      </div>
                    ) : (
                      columnOrders.map((order) => (
                        <OrderCard
                          key={order.id}
                          order={order}
                          now={now}
                          onAction={actions.runAction}
                          pending={actions.isPending(order)}
                          actionError={actions.errorFor(order)}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
