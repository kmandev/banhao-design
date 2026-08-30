import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, driverColors, driverFontSize, fontFamily, radius, spacing } from '@banhao/ui';
import { ErrorState } from '../components/ErrorState';
import { ListRow } from '../components/ListRow';
import { Screen } from '../components/Screen';
import { StateCard } from '../components/StateCard';
import { useAsyncData } from '../hooks/useAsyncData';
import { useAuth } from '../hooks/useAuth';
import { useHomeOfferCount } from '../hooks/useHomeOfferCount';
import { useRiderAvailability } from '../hooks/useRiderAvailability';
import { isApproved } from '../domain/riderProfile';
import { repositories } from '../repositories';
import type { RiderStackParamList } from '../navigation/types';
import { StatusScreen } from './StatusScreen';

type Nav = NativeStackNavigationProp<RiderStackParamList>;

/**
 * R-03 หน้าหลัก + R-04 เปิด/ปิดรับงาน — the rider's home and the availability
 * control.
 *
 * This screen is the first consumer of anything in Phase G. Turning the toggle
 * on is what puts a row into `BroadcastDispatchStrategy`'s candidate pool, and
 * therefore what makes the whole already-built dispatch chain — offers,
 * accept, decline, arrival, pickup, en-route — reachable at all.
 *
 * ## What is deliberately not here
 *
 * No earnings, no money of any kind, no map, no proof photo, no failure or
 * cancellation control. Earnings are **BQ-029, `OPEN`** and cannot be rendered
 * without inventing a formula.
 *
 * No assigned-order or delivery detail either: this screen only **links** to
 * the two screens that own those reads. `RiderDeliveryRepository` and
 * `RiderOrderViewRepository` (G6.3) are consumed by `ActiveDeliveryScreen`
 * (G-7.2) — neither is imported here, so the งานที่กำลังทำ row carries no
 * badge or count of its own.
 *
 * **T2.4 / DG-05.** `RiderOfferInboxRepository` (G6.4) *is* now read here too
 * — `useHomeOfferCount` calls its `listPendingOffers()` once per Home focus,
 * purely for the งานที่เสนอ row's informational count badge. This is
 * DG-05's own approved recommendation, not a second poller: no timer, no
 * interval, and it reuses the exact query `OfferInboxScreen` already runs
 * rather than adding a new read path. A failed count read renders no badge
 * — it never becomes a Home-level error state.
 *
 * ## The approval gate
 *
 * A rider who is not `APPROVED` gets `StatusScreen`, which contains no toggle
 * at all — DEC-UX-006. The branch is on the rider record read fresh from the
 * server on every mount, never on anything cached in the session
 * (DEC-APP-004: a revoked grant must take effect on the next read).
 */
export function HomeScreen() {
  const { signOut } = useAuth();
  const navigation = useNavigation<Nav>();
  const profileState = useAsyncData(() => repositories.riderProfile.getOwnProfile(), []);

  const profile = profileState.status === 'success' ? profileState.data : null;
  const approved = isApproved(profile);

  // Availability is not read for a rider who cannot be offered work — there is
  // no screen to show it on, and no reason to query for it.
  const availability = useRiderAvailability(approved);

  // T2.4 / DG-05 — informational only, one read per focus, no timer. Same
  // approved-gate as availability above.
  const offerCount = useHomeOfferCount(approved);

  if (profileState.status === 'loading') {
    return (
      <Screen testID="screen-home">
        <View style={styles.centred} testID="home-loading">
          <ActivityIndicator color={driverColors.action.primary} />
          <Text style={styles.muted}>กำลังโหลดสถานะไรเดอร์…</Text>
        </View>
      </Screen>
    );
  }

  if (profileState.status === 'error') {
    // A failed read is never rendered as "not approved" — that would tell an
    // approved rider something false about their own account.
    return (
      <Screen testID="screen-home">
        <ErrorState
          testID="home-error"
          headline="โหลดสถานะไรเดอร์ไม่สำเร็จ"
          detail="ตรวจการเชื่อมต่ออินเทอร์เน็ต แล้วลองอีกครั้ง"
          serverMessage={profileState.message}
          onRetry={profileState.reload}
          retryTestID="button-retry-profile"
        />
      </Screen>
    );
  }

  if (!approved) {
    return (
      <StatusScreen
        status={profile?.status ?? null}
        fullName={profile?.fullName ?? null}
        onSignOut={() => void signOut()}
      />
    );
  }

  return (
    <Screen scroll testID="screen-home">
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>หน้าหลัก</Text>
          <Text style={styles.name}>{profile?.fullName}</Text>
        </View>
        <Pressable
          style={styles.refreshButton}
          onPress={() => {
            profileState.reload();
            availability.refresh();
          }}
          accessibilityRole="button"
          accessibilityLabel="รีเฟรชสถานะ"
          testID="button-refresh"
        >
          <Text style={styles.refreshGlyph}>↻</Text>
        </Pressable>
      </View>

      <AvailabilityPanel controller={availability} />

      <ListRow
        icon="🛵"
        title="งานที่กำลังทำ"
        onPress={() => navigation.navigate('ActiveDelivery')}
        trailing="›"
        testID="button-view-active-delivery"
      />

      <ListRow
        icon="📋"
        title="งานที่เสนอ"
        subtitle={offerSubtitle(offerCount)}
        onPress={() => navigation.navigate('OfferInbox')}
        trailing="›"
        badge={offerCount !== null && offerCount > 0 ? offerCount : undefined}
        testID="button-view-offers"
      />

      <Button label="ออกจากระบบ" variant="secondary" onPress={() => void signOut()} testID="button-sign-out" />
    </Screen>
  );
}

/** The R-04 control, plus everything the rider needs to know about why it did or did not work. */
function AvailabilityPanel({
  controller,
}: {
  controller: ReturnType<typeof useRiderAvailability>;
}) {
  const { view, busy, actionError, goOnline, goOffline } = controller;

  if (view.status === 'loading') {
    return (
      <View style={styles.centred} testID="availability-loading">
        <ActivityIndicator color={driverColors.action.primary} />
        <Text style={styles.muted}>กำลังโหลดสถานะรับงาน…</Text>
      </View>
    );
  }

  if (view.status === 'error') {
    return (
      <ErrorState
        testID="availability-error"
        headline="โหลดสถานะรับงานไม่สำเร็จ"
        serverMessage={view.message}
        onRetry={controller.refresh}
        retryTestID="button-retry-availability"
      />
    );
  }

  const { isOnline, locationRecordedAt } = view.availability;

  // Presence, not freshness — DEC-037's eligibility predicate is "has a
  // location", and no staleness rule is decided. See `domain/riderAvailability.ts`.
  const hasPosition = locationRecordedAt !== null;

  const detail = isOnline
    ? hasPosition
      ? 'ระบบจะส่งงานใหม่มาให้เมื่อมีงานเข้า'
      : // Structurally unreachable while `goOnline` refuses to set the flag
        // without a recorded position, but stated rather than assumed: if the
        // server ever holds this pair, the rider is online and undispatchable
        // and has a right to know.
        'เปิดรับงานอยู่ แต่ยังไม่มีตำแหน่งล่าสุด — กดรีเฟรชสถานะ'
    : 'ยังไม่ได้เปิดรับงาน จะไม่มีงานใหม่ส่งมา';

  const action = isOnline ? (
    <Button
      label="ปิดรับงาน"
      variant="secondary"
      size="lg"
      loading={busy}
      onPress={() => void goOffline()}
      testID="button-go-offline"
    />
  ) : (
    <Button label="เปิดรับงาน" size="lg" loading={busy} onPress={() => void goOnline()} testID="button-go-online" />
  );

  return (
    <View style={styles.panel} testID="availability-panel">
      <StateCard variant={isOnline ? 'online' : 'offline'} headline={isOnline ? 'กำลังรับงาน' : 'ปิดรับงาน'} detail={detail} action={action} busy={busy} />

      <Text style={styles.locationNote} testID="location-state">
        {hasPosition
          ? `ตำแหน่งล่าสุดที่ระบบบันทึกไว้ ${formatRecordedAt(locationRecordedAt)}`
          : 'ระบบยังไม่มีตำแหน่งของคุณ'}
      </Text>

      {actionError ? (
        <View style={styles.actionErrorBox}>
          <Text style={styles.actionError} testID="availability-action-error">
            {actionError}
          </Text>
        </View>
      ) : null}

      <Text style={styles.privacyNote}>
        ระบบบันทึกเฉพาะตำแหน่งล่าสุดเมื่อคุณกดเปิดรับงานหรือกดรีเฟรชเท่านั้น ไม่มีการติดตามขณะปิดแอป
      </Text>
    </View>
  );
}

/**
 * T2.4 / DG-05 — the offer row's subtitle. `null` (not yet known, or the
 * read failed) renders no subtitle at all rather than asserting a count that
 * might be wrong; `0` and `>0` are both real, distinct answers.
 */
function offerSubtitle(count: number | null): string | undefined {
  if (count === null) return undefined;
  return count > 0 ? `${count} งานรอการตอบรับ` : 'ไม่มีงานรอการตอบรับ';
}

/**
 * `location_updated_at` as a plain local timestamp.
 *
 * Not a relative "5 นาทีที่แล้ว": relative phrasing reads as a freshness
 * judgement, and DEC-037 makes no freshness rule. An absolute time states the
 * fact without implying the position has expired.
 */
function formatRecordedAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('th-TH');
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  title: { fontSize: driverFontSize.screenTitle, fontFamily: fontFamily.bold, color: driverColors.text.primary },
  name: { fontFamily: fontFamily.regular, fontSize: driverFontSize.body, color: driverColors.text.meta },
  refreshButton: {
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: driverColors.border.default,
    backgroundColor: driverColors.surface.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshGlyph: { fontFamily: fontFamily.regular, fontSize: driverFontSize.cardTitle, color: driverColors.text.primary },

  panel: { gap: spacing.md },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  muted: {
    fontFamily: fontFamily.regular,
    fontSize: driverFontSize.body,
    color: driverColors.text.meta,
    textAlign: 'center',
  },
  locationNote: {
    fontFamily: fontFamily.regular,
    fontSize: driverFontSize.supporting,
    color: driverColors.text.meta,
    paddingHorizontal: spacing.xs,
  },
  actionErrorBox: {
    backgroundColor: driverColors.state.dangerSurface,
    borderWidth: 1,
    borderColor: driverColors.border.danger,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  actionError: {
    fontFamily: fontFamily.medium,
    fontSize: driverFontSize.supporting,
    color: driverColors.onDanger.body,
  },
  privacyNote: {
    fontFamily: fontFamily.regular,
    fontSize: driverFontSize.caption,
    color: driverColors.text.faint,
    paddingHorizontal: spacing.xs,
  },
});
