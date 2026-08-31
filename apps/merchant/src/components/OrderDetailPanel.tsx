'use client';

import { useEffect, useRef } from 'react';
import type { MerchantOrderSummary } from '../domain/order';
import type { MerchantOrderDetail, MerchantOrderItem } from '../domain/orderDetail';
import { useOrderDetail } from '../hooks/useOrderDetail';
import {
  elapsedSeconds,
  formatBahtFixed,
  formatClockTime,
  formatElapsedShort,
  presentOrderCard,
} from '../lib/orderBoardDisplay';
import {
  formatMerchantPhone,
  formatOptionLabel,
  formatPriceDelta,
  formatQuantity,
  orderHistoryActorLabel,
  orderHistoryStateLabel,
  paymentMethodDetailLine,
  telHref,
} from '../lib/orderDetailDisplay';
import { CHIP_STYLES } from './OrderCard';

/**
 * The Order Detail Panel (M-04) — design
 * `docs/design/BANHAO M-04 Merchant Order Detail Panel.dc.html`.
 *
 * A read-only drawer over the board: identity → recipient → items → money →
 * history, in that fixed order (M04-D02). It issues no command — the primary
 * action stays on the card (M04-D09) — and owns no data fetching of its own
 * beyond `useOrderDetail(order)`, which is itself layered on the board's
 * existing Realtime state (see that hook's doc comment).
 *
 * `order` is the live `MerchantOrderSummary` for whichever card is open, or
 * `null` when closed — this component returns `null` in the latter case, so
 * `OrderBoard` can render it unconditionally rather than wrapping it in its
 * own `{selected ? ... : null}`. The header chip renders from `order`
 * (`presentOrderCard`, the same function `OrderCard` uses) so the panel can
 * never show a state the board itself disagrees with (F-04) — never from
 * the fetched `detail`, which carries no `state` field at all.
 */

export interface OrderDetailPanelProps {
  order: MerchantOrderSummary | null;
  /** Render-time clock, ms — passed down from `OrderBoard`, never a timer this component owns. */
  now: number;
  onClose: () => void;
}

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

function PanelHeader({
  order,
  now,
  onClose,
}: {
  order: MerchantOrderSummary;
  now: number;
  onClose: () => void;
}) {
  const presentation = presentOrderCard(order, now);
  const chipStyle = presentation ? CHIP_STYLES[presentation.chipTone] : undefined;
  const headingId = `order-detail-heading-${order.id}`;
  const clock = formatClockTime(order.placedAt) ?? '--:--';
  const elapsed = formatElapsedShort(elapsedSeconds(order.placedAt, now));

  return (
    <div
      style={{
        background: '#fff',
        borderBottom: '1px solid #EAE1D6',
        padding: '18px 20px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2
            id={headingId}
            style={{ margin: 0, fontFamily: "'IBM Plex Mono',monospace", fontSize: 19, fontWeight: 600 }}
          >
            #{order.orderNumber}
          </h2>
          {presentation && chipStyle ? (
            <div aria-live="polite">
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  padding: '4px 9px',
                  borderRadius: 8,
                  ...chipStyle,
                }}
              >
                {presentation.chipLabel}
              </span>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono',monospace",
                  fontSize: 10.5,
                  color: '#A2968A',
                  marginLeft: 8,
                }}
              >
                {presentation.stateCode}
              </span>
            </div>
          ) : null}
        </div>
        <div style={{ fontSize: 12.5, color: '#7A6E64', marginTop: 6 }}>
          สั่งเมื่อ {clock} · {elapsed}ที่แล้ว
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="ปิดหน้าต่างรายละเอียด"
        className="banhao-detail-close"
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          border: '1px solid #E9E0D5',
          background: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          color: '#5A4E42',
          flex: '0 0 auto',
          cursor: 'pointer',
        }}
      >
        ✕
      </button>
    </div>
  );
}

function RegionCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ borderRadius: 16, border: '1px solid #EAE1D6', background: '#fff', padding: 16 }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.12em', color: '#A2968A', marginBottom: 10 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function RecipientRegion({ order, detail }: { order: MerchantOrderSummary; detail: MerchantOrderDetail }) {
  const phone = formatMerchantPhone(detail.recipientPhoneSnapshot);
  return (
    <RegionCard label="ผู้รับ">
      <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.55 }}>{order.recipientNameSnapshot}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
        <a
          href={telHref(detail.recipientPhoneSnapshot)}
          className="banhao-detail-phone"
          style={{
            height: 44,
            padding: '0 14px',
            borderRadius: 12,
            border: '1px solid #E9E0D5',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: 15,
            fontWeight: 600,
            color: '#1F1A16',
          }}
        >
          {phone}
        </a>
        <span style={{ fontSize: 12, color: '#7A6E64', lineHeight: 1.55 }}>
          แตะเพื่อโทร · <span style={{ fontFamily: "'IBM Plex Mono',monospace" }}>tel:</span>
        </span>
      </div>
      <div style={{ fontSize: 13.5, lineHeight: 1.7, color: '#5A4E42', marginTop: 12 }}>
        {detail.deliveryAddressSnapshot}
      </div>
      {detail.deliveryLandmark ? (
        <div style={{ fontSize: 12.5, lineHeight: 1.7, color: '#7A6E64', marginTop: 4 }}>
          จุดสังเกต · {detail.deliveryLandmark}
        </div>
      ) : null}
    </RegionCard>
  );
}

function ItemRow({ item }: { item: MerchantOrderItem }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 15, fontWeight: 600, minWidth: 30 }}>
          {formatQuantity(item.quantity)}
        </div>
        <div style={{ flex: 1, fontSize: 15, fontWeight: 600, lineHeight: 1.55 }}>{item.nameSnapshot}</div>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 15, fontWeight: 600 }}>
          {formatBahtFixed(item.lineTotalSatang)}
        </div>
      </div>
      {item.quantity > 1 ? (
        <div style={{ paddingLeft: 40, marginTop: 2, fontSize: 12, color: '#A2968A' }}>
          {formatBahtFixed(item.unitPriceSatang)} × {item.quantity}
        </div>
      ) : null}
      {item.options.length > 0 ? (
        <ul style={{ listStyle: 'none', margin: '5px 0 0', padding: 0 }}>
          {item.options.map((option) => (
            <li
              key={option.id}
              style={{ display: 'flex', alignItems: 'baseline', gap: 10, paddingLeft: 40, marginTop: 5 }}
            >
              <div style={{ flex: 1, fontSize: 13, lineHeight: 1.6, color: '#7A6E64' }}>
                {formatOptionLabel(option.groupNameSnapshot, option.optionNameSnapshot)}
              </div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: '#7A6E64' }}>
                {formatPriceDelta(option.priceDeltaSatang)}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {item.note ? (
        <div
          style={{
            margin: '8px 0 0 40px',
            padding: '8px 10px',
            borderRadius: 10,
            background: '#FDF3E6',
            border: '1px solid #F0DFC4',
            fontSize: 12.5,
            lineHeight: 1.65,
            color: '#8A6412',
          }}
        >
          หมายเหตุ · {item.note}
        </div>
      ) : null}
    </div>
  );
}

function ItemsRegion({ items }: { items: MerchantOrderItem[] }) {
  return (
    <div style={{ borderRadius: 16, border: '1px solid #EAE1D6', background: '#fff', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.12em', color: '#A2968A' }}>รายการอาหาร</div>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5, color: '#A2968A' }}>
          {items.length} รายการ
        </div>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {items.map((item) => (
          <li key={item.id}>
            <ItemRow item={item} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function MoneyRegion({ detail }: { detail: MerchantOrderDetail }) {
  const rows = [
    { label: 'ยอดรวมอาหาร', value: formatBahtFixed(detail.subtotalSatang) },
    { label: 'ค่าส่ง', value: formatBahtFixed(detail.deliveryFeeSatang) },
    { label: 'ค่าบริการ', value: formatBahtFixed(detail.serviceFeeSatang) },
    ...(detail.discountSatang > 0
      ? [{ label: 'ส่วนลด', value: `−${formatBahtFixed(detail.discountSatang)}` }]
      : []),
  ];

  return (
    <RegionCard label="ยอดชำระ">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((row) => (
          <div
            key={row.label}
            style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', fontSize: 13.5, color: '#5A4E42' }}
          >
            <div>{row.label}</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{row.value}</div>
          </div>
        ))}
        <div style={{ height: 1, background: '#F1E9DE', margin: '4px 0' }} />
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>ยอดสุทธิ</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 19, fontWeight: 600 }}>
            {formatBahtFixed(detail.grandTotalSatang)}
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: '#A2968A', lineHeight: 1.6, marginTop: 2 }}>
          {paymentMethodDetailLine(detail.paymentMethod)}
        </div>
      </div>
    </RegionCard>
  );
}

function HistoryRegion({ detail }: { detail: MerchantOrderDetail }) {
  return (
    <RegionCard label="ประวัติสถานะ">
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
        {detail.statusHistory.map((entry, index) => {
          const label = orderHistoryStateLabel(entry.toState);
          const isLast = index === detail.statusHistory.length - 1;
          return (
            <li key={entry.id} style={{ display: 'flex', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 14, flex: '0 0 14px' }}>
                <div
                  aria-hidden
                  style={{ width: 10, height: 10, borderRadius: '50%', marginTop: 5, background: '#E4572E' }}
                />
                {!isLast ? <div style={{ flex: 1, width: 2, background: '#F1E9DE' }} /> : null}
              </div>
              <div style={{ paddingBottom: 16, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.5 }}>{label ?? entry.toState}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: '#7A6E64' }}>
                    {formatClockTime(entry.occurredAt) ?? '--:--'}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: '#A2968A', marginTop: 3 }}>
                  {orderHistoryActorLabel(entry.actorType)} ·{' '}
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{entry.toState}</span>
                </div>
                {entry.reason ? (
                  <div style={{ fontSize: 12.5, color: '#5A4E42', marginTop: 4 }}>{entry.reason}</div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </RegionCard>
  );
}

function DetailSkeleton() {
  const skeleton = [
    { label: 'ผู้รับ', bars: ['55%', '40%'] },
    { label: 'รายการอาหาร', bars: ['80%', '62%', '72%'] },
    { label: 'ยอดชำระ', bars: ['48%', '48%', '35%'] },
    { label: 'ประวัติสถานะ', bars: ['66%', '58%'] },
  ];

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }} aria-hidden>
      {skeleton.map((region) => (
        <div key={region.label} style={{ borderRadius: 16, border: '1px solid #EAE1D6', background: '#fff', padding: 16 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.12em', color: '#CFC3B6', marginBottom: 10 }}>
            {region.label}
          </div>
          {region.bars.map((width, i) => (
            <div
              key={i}
              className="banhao-board-skeleton-block"
              style={{ height: 12, borderRadius: 6, marginBottom: 8, width }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function DetailError({ message, onRetry, onClose }: { message: string | null; onRetry: () => void; onClose: () => void }) {
  return (
    <div role="alert" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '28px 24px' }}>
      <div style={{ textAlign: 'center', maxWidth: 320 }}>
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
        <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.5 }}>โหลดรายละเอียดไม่สำเร็จ</div>
        <div style={{ fontSize: 13.5, color: '#5A4E42', lineHeight: 1.7, marginTop: 8 }}>
          ออเดอร์ยังอยู่บนกระดานตามปกติ · ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง
        </div>
        {message ? <div style={{ fontSize: 12, color: '#A2968A', marginTop: 8 }}>{message}</div> : null}
        <button
          type="button"
          onClick={onRetry}
          style={{
            height: 52,
            width: '100%',
            marginTop: 18,
            borderRadius: 14,
            background: '#E4572E',
            color: '#fff',
            border: 'none',
            fontSize: 15,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          ลองใหม่อีกครั้ง
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{
            height: 44,
            width: '100%',
            marginTop: 8,
            borderRadius: 14,
            background: 'none',
            border: 'none',
            color: '#7A6E64',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          ปิดหน้าต่าง
        </button>
      </div>
    </div>
  );
}

export function OrderDetailPanel({ order, now, onClose }: OrderDetailPanelProps) {
  const { detail, loading, error, refetch } = useOrderDetail(order);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Focus enters the panel container on open — not the close button — so a
  // screen reader announces which order opened before any control (design §06).
  useEffect(() => {
    if (order) panelRef.current?.focus();
  }, [order]);

  // Escape closes; Tab is trapped inside the panel while it is open.
  useEffect(() => {
    if (!order) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const container = panelRef.current;
      if (!container) return;
      const focusable = getFocusable(container);
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [order, onClose]);

  if (!order) return null;

  const headingId = `order-detail-heading-${order.id}`;

  return (
    <>
      <style>{`
        .banhao-detail-panel { width: 520px; }
        @media (max-width: 1024px) {
          .banhao-detail-panel { width: min(88vw, 640px); max-width: 88%; }
          .banhao-detail-close { width: 56px !important; height: 56px !important; }
          .banhao-detail-phone { height: 56px !important; }
        }
      `}</style>

      {/*
        Scrim — closes on click, per design §06: "there is nothing to lose,
        and BANHAO uses no confirm-to-discard pattern anywhere."

        The design's own markup offsets the scrim/drawer 72px down, to leave
        a *shared* header row (restaurant identity + connection pill) inside
        the same bordered panel uncovered. In this app that row does not
        exist inside `OrderBoard`'s own panel — M-03 built the connection
        pill/bell/count as a separate card above it (`BoardHeaderBar`), and
        restaurant identity lives in `AppShell`'s header, a different
        component entirely, outside `OrderBoard`'s DOM altogether. DEC-UX-005
        ("restaurant scope visible at every moment") is therefore already
        satisfied without an offset: `AppShell`'s header is structurally
        outside this component and the scrim below can never reach it. This
        covers the full `OrderBoard` subtree (`BoardHeaderBar` included)
        instead of carrying the design's literal 72px number — see
        `OrderBoard.tsx`'s module doc comment (M-04 §, contradiction C-01).
      */}
      <div
        onClick={onClose}
        aria-hidden
        style={{ position: 'absolute', inset: 0, background: 'rgba(31,26,22,.32)', zIndex: 1 }}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        data-testid="order-detail-panel"
        className="banhao-detail-panel"
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          background: '#FBF7F1',
          borderLeft: '1px solid #E2D8CB',
          boxShadow: '-18px 0 48px rgba(31,26,22,.18)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          zIndex: 2,
          outline: 'none',
        }}
      >
        <PanelHeader order={order} now={now} onClose={onClose} />

        {loading ? (
          <div style={{ flex: 1, overflow: 'hidden' }} aria-busy="true">
            <DetailSkeleton />
          </div>
        ) : error && !detail ? (
          <DetailError message={error} onRetry={refetch} onClose={onClose} />
        ) : detail ? (
          <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <RecipientRegion order={order} detail={detail} />
            <ItemsRegion items={detail.items} />
            <MoneyRegion detail={detail} />
            {/*
              Design §08 "missing": history is "structurally impossible" to
              be empty for an order created through the real order-creation
              path (`create_order` writes the `CREATED` row in the same
              transaction) — but this read is honest about what it actually
              gets back, and pre-existing fixture/test data written outside
              that path can legitimately have none. Per the design's own
              rule for this case, the whole section is omitted rather than
              rendered as an empty box.
            */}
            {detail.statusHistory.length > 0 ? <HistoryRegion detail={detail} /> : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
