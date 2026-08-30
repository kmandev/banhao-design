import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Button, driverColors, driverFontSize, fontFamily, spacing } from '@banhao/ui';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LivePill } from '../components/LivePill';
import { OfferCard } from '../components/OfferCard';
import { Screen } from '../components/Screen';
import { Toast } from '../components/Toast';
import { useRiderOfferInbox } from '../hooks/useRiderOfferInbox';

/**
 * G-7.1 — the rider's offer inbox (V1.1 §9, `rider_assignment_attempts`).
 *
 * Foreground-only polling (TQ-002, POLLING) — see `useRiderOfferInbox` for the
 * fetch-on-focus / poll-while-focused / stop-on-blur mechanics. This screen
 * only renders what the hook already resolved.
 *
 * Renders exactly `RiderOfferSummary`'s fields. No restaurant, customer,
 * item, fee, distance or ETA exists in this read path — `domain/riderOffer.ts`
 * documents that as a deliberate privacy boundary, not a gap for this screen
 * to paper over with an invented value.
 *
 * Accept and decline both go through `RiderOfferActionsRepository`, which
 * calls the existing `POST /api/v1/rider/offers/:id/*` endpoints — never a
 * direct write to `rider_assignment_attempts`. G-7.2 (the assigned-order
 * screen) does not exist yet, so neither action navigates anywhere; both just
 * report the server's outcome and refresh this list.
 */
export function OfferInboxScreen() {
  const { view, refresh, busyOfferId, actionError, acceptOffer, declineOffer } = useRiderOfferInbox();

  return (
    <Screen
      scroll
      testID="screen-offer-inbox"
      footer={<Toast message={actionError} testID="offer-action-error" />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>งานที่เสนอ</Text>
        <Button label="รีเฟรช" variant="ghost" onPress={refresh} testID="button-refresh-offers" />
      </View>

      {view.status === 'loading' ? (
        <View style={styles.centred} testID="offer-inbox-loading">
          <ActivityIndicator color={driverColors.action.primary} />
          <Text style={styles.muted}>กำลังโหลดรายการงาน…</Text>
        </View>
      ) : null}

      {view.status === 'error' ? (
        <>
          {/* Same failed-read state as the ErrorState below it — not a
              separately-detected "offline" condition; no connectivity
              library is added (Redesign §D, ConnectionBanner). */}
          <ConnectionBanner visible testID="offer-inbox-connection-banner" />
          <ErrorState
            testID="offer-inbox-error"
            headline="โหลดรายการงานไม่สำเร็จ"
            detail="ตรวจสัญญาณอินเทอร์เน็ต แล้วกดลองอีกครั้ง"
            serverMessage={view.message}
            onRetry={refresh}
            retryTestID="button-retry-offers"
          />
        </>
      ) : null}

      {view.status === 'ready' && view.offers.length === 0 ? (
        <View testID="offer-inbox-empty" style={styles.emptyWrap}>
          <EmptyState icon="📭" headline="ยังไม่มีงาน" detail="เมื่อมีงานใหม่เข้ามา ระบบจะแสดงที่หน้านี้ทันที" />
          <LivePill />
        </View>
      ) : null}

      {view.status === 'ready' && view.offers.length > 0 ? (
        <View style={styles.list} testID="offer-inbox-list">
          {view.offers.map((offer) => (
            <OfferCard
              key={offer.offerId}
              offer={offer}
              busy={busyOfferId === offer.offerId}
              disabled={busyOfferId !== null && busyOfferId !== offer.offerId}
              onAccept={() => void acceptOffer(offer.offerId)}
              onDecline={() => void declineOffer(offer.offerId)}
            />
          ))}
          <LivePill label="อัปเดตอยู่ · ตรวจงานใหม่ทุก 15 วินาที" />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.xl, paddingBottom: spacing.sm, gap: spacing.sm },
  title: { fontSize: driverFontSize.screenTitle, fontFamily: fontFamily.bold, color: driverColors.text.primary },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  muted: {
    fontFamily: fontFamily.regular,
    fontSize: driverFontSize.body,
    color: driverColors.text.meta,
    textAlign: 'center',
  },
  emptyWrap: { gap: spacing.lg },
  list: { gap: spacing.md },
});
