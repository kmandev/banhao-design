import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Button, driverColors, driverFontSize, fontFamily, radius, spacing } from '@banhao/ui';
import { Countdown } from './Countdown';

/**
 * T2.1 — the reusable offer card (Driver App Redesign §D / §C3, R-05b–d).
 * Wired into `OfferInboxScreen` as of T2.2, replacing that screen's former
 * inline card of the same shape.
 *
 * Three visual states, all driven by `expiresAt` and the two flags the offer
 * inbox hook already exposes — no state of its own:
 * - **live** — `!busy`, not expired.
 * - **acting** — `busy` (this card's own accept/decline is in flight).
 * - **expired** — `expiresAt` has passed. Buttons stay enabled: the server
 *   decides expiry, and an accept-after-expiry is a legitimate flow the
 *   client must not pre-empt (R-05d).
 */

export interface OfferCardOffer {
  offerId: string;
  roundNo: number;
  offeredAt: string;
  expiresAt: string | null;
}

export interface OfferCardProps {
  offer: OfferCardOffer;
  /** This card's own accept/decline is in flight. */
  busy?: boolean;
  /** A different card's action is in flight — dims and disables this one. */
  disabled?: boolean;
  onAccept: () => void;
  onDecline: () => void;
  testID?: string;
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() <= Date.now();
}

export function OfferCard({ offer, busy = false, disabled = false, onAccept, onDecline, testID }: OfferCardProps) {
  const id = testID ?? `offer-card-${offer.offerId}`;
  const expired = isExpired(offer.expiresAt);

  return (
    <View
      style={[styles.card, expired && styles.expiredCard, disabled && !busy && styles.dimmed]}
      testID={id}
    >
      <View style={[styles.header, expired ? styles.headerExpired : styles.headerLive]}>
        {busy ? (
          <View style={styles.actingRow}>
            <ActivityIndicator color={driverColors.onPrimary.text} />
            <Text style={styles.headerLabelLive}>กำลังส่งคำขอรับงาน</Text>
          </View>
        ) : (
          <>
            <Text style={expired ? styles.headerLabelExpired : styles.headerLabelLive}>
              {expired ? 'หมดเวลารับ' : 'งานใหม่'}
            </Text>
            <Countdown expiresAt={offer.expiresAt} testID={`${id}-countdown`} />
          </>
        )}
      </View>

      <View style={styles.body}>
        <Text style={styles.title}>งานรอบที่ {offer.roundNo}</Text>

        {expired ? (
          <Text style={styles.note}>งานนี้เลยเวลารับแล้ว จะหายไปจากรายการเมื่อระบบอัปเดตรอบถัดไป</Text>
        ) : null}

        <View style={styles.actions}>
          <Button
            label="ปฏิเสธ"
            variant="secondary"
            size="lg"
            loading={busy}
            disabled={disabled}
            onPress={onDecline}
            testID={`button-decline-${offer.offerId}`}
            style={styles.declineButton}
          />
          <Button
            label="รับงาน"
            size="lg"
            loading={busy}
            disabled={disabled}
            onPress={onAccept}
            testID={`button-accept-${offer.offerId}`}
            style={styles.acceptButton}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xxl,
    backgroundColor: driverColors.surface.card,
    borderWidth: 2,
    borderColor: driverColors.action.primary,
    overflow: 'hidden',
  },
  expiredCard: { borderWidth: 1.5, borderColor: driverColors.border.neutral },
  dimmed: { opacity: 0.45 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  headerLive: { backgroundColor: driverColors.action.primary },
  headerExpired: { backgroundColor: driverColors.state.blockedSurface },
  headerLabelLive: {
    fontFamily: fontFamily.bold,
    fontSize: driverFontSize.body,
    color: driverColors.onPrimary.text,
  },
  headerLabelExpired: {
    fontFamily: fontFamily.bold,
    fontSize: driverFontSize.body,
    color: driverColors.text.secondary,
  },
  actingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

  body: { padding: spacing.lg, gap: spacing.md },
  title: { fontFamily: fontFamily.bold, fontSize: driverFontSize.cardTitle, color: driverColors.text.primary },
  note: {
    fontFamily: fontFamily.regular,
    fontSize: driverFontSize.supporting,
    color: driverColors.text.secondary,
    backgroundColor: driverColors.surface.inset,
    borderRadius: radius.xl,
    padding: spacing.md,
  },

  actions: { flexDirection: 'row', gap: spacing.sm },
  declineButton: { flex: 0.34 },
  acceptButton: { flex: 1 },
});
