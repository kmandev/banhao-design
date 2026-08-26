import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Button, colors, fontFamily, fontSize, radius, spacing } from '@banhao/ui';
import { Screen } from '../components/Screen';
import { useRiderOfferInbox } from '../hooks/useRiderOfferInbox';
import type { RiderOfferSummary } from '../domain/riderOffer';

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
    <Screen scroll testID="screen-offer-inbox">
      <View style={styles.header}>
        <Text style={styles.title}>งานที่เสนอ</Text>
        <Button label="รีเฟรช" variant="ghost" onPress={refresh} testID="button-refresh-offers" />
      </View>

      {actionError ? (
        <Text style={styles.actionError} testID="offer-action-error">
          {actionError}
        </Text>
      ) : null}

      {view.status === 'loading' ? (
        <View style={styles.centred} testID="offer-inbox-loading">
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.muted}>กำลังโหลดรายการงาน…</Text>
        </View>
      ) : null}

      {view.status === 'error' ? (
        <View style={styles.centred} testID="offer-inbox-error">
          <Text style={styles.errorTitle}>โหลดรายการงานไม่สำเร็จ</Text>
          <Text style={styles.muted}>{view.message}</Text>
          <Button label="ลองอีกครั้ง" onPress={refresh} testID="button-retry-offers" />
        </View>
      ) : null}

      {view.status === 'ready' && view.offers.length === 0 ? (
        <View style={styles.centred} testID="offer-inbox-empty">
          <Text style={styles.muted}>ยังไม่มีงาน</Text>
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
        </View>
      ) : null}
    </Screen>
  );
}

function OfferCard({
  offer,
  busy,
  disabled,
  onAccept,
  onDecline,
}: {
  offer: RiderOfferSummary;
  busy: boolean;
  disabled: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <View style={styles.card} testID={`offer-card-${offer.offerId}`}>
      <Text style={styles.cardTitle}>งานรอบที่ {offer.roundNo}</Text>
      <Text style={styles.cardDetail}>เสนอเมื่อ {formatTimestamp(offer.offeredAt)}</Text>
      <Text style={styles.cardDetail}>
        {offer.expiresAt ? `หมดเวลารับ ${formatTimestamp(offer.expiresAt)}` : 'ไม่ระบุเวลาหมดอายุ'}
      </Text>

      <View style={styles.cardActions}>
        <Button
          label="ปฏิเสธ"
          variant="secondary"
          loading={busy}
          disabled={disabled}
          onPress={onDecline}
          testID={`button-decline-${offer.offerId}`}
        />
        <Button
          label="รับงาน"
          loading={busy}
          disabled={disabled}
          onPress={onAccept}
          testID={`button-accept-${offer.offerId}`}
        />
      </View>
    </View>
  );
}

/**
 * Absolute local time — same convention `HomeScreen`'s `formatRecordedAt`
 * uses, for the same reason (DQ-G7-03): no relative "N นาทีที่แล้ว" that would
 * imply a freshness judgement this screen doesn't make.
 */
function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('th-TH');
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.xl, paddingBottom: spacing.sm, gap: spacing.sm },
  title: { fontSize: fontSize.h2, fontFamily: fontFamily.bold, color: colors.textPrimary },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  muted: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.textMuted, textAlign: 'center' },
  errorTitle: { fontFamily: fontFamily.semibold, fontSize: fontSize.xl, color: colors.textPrimary },
  actionError: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.md,
    color: colors.danger,
    paddingHorizontal: spacing.xs,
  },
  list: { gap: spacing.md },
  card: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  cardTitle: { fontFamily: fontFamily.semibold, fontSize: fontSize.lg, color: colors.textPrimary },
  cardDetail: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.textMuted },
  cardActions: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.xs },
});
