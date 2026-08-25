import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Button, colors, fontFamily, fontSize, spacing } from '@banhao/ui';
import { Screen } from '../components/Screen';
import { StatusStrip } from '../components/StatusStrip';
import { useAsyncData } from '../hooks/useAsyncData';
import { useAuth } from '../hooks/useAuth';
import { useRiderAvailability } from '../hooks/useRiderAvailability';
import { isApproved } from '../domain/riderProfile';
import { repositories } from '../repositories';
import { StatusScreen } from './StatusScreen';

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
 * No offers, no assigned order, no earnings, no money of any kind, no
 * restaurant or customer detail, no map, no delivery action, no proof photo,
 * no failure or cancellation control. Offers are Phase G-7.1; the assigned
 * order is G-7.2; earnings are **BQ-029, `OPEN`** and cannot be rendered
 * without inventing a formula. `RiderOfferInboxRepository` and
 * `RiderOrderViewRepository` exist (G6.4 / G6.3) and are deliberately not
 * imported.
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
  const profileState = useAsyncData(() => repositories.riderProfile.getOwnProfile(), []);

  const profile = profileState.status === 'success' ? profileState.data : null;
  const approved = isApproved(profile);

  // Availability is not read for a rider who cannot be offered work — there is
  // no screen to show it on, and no reason to query for it.
  const availability = useRiderAvailability(approved);

  if (profileState.status === 'loading') {
    return (
      <Screen testID="screen-home">
        <View style={styles.centred} testID="home-loading">
          <ActivityIndicator color={colors.primary} />
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
        <View style={styles.centred} testID="home-error">
          <Text style={styles.errorTitle}>โหลดสถานะไรเดอร์ไม่สำเร็จ</Text>
          <Text style={styles.muted}>{profileState.message}</Text>
          <Button label="ลองอีกครั้ง" onPress={profileState.reload} testID="button-retry-profile" />
        </View>
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
        <Text style={styles.title}>หน้าหลัก</Text>
        <Text style={styles.name}>{profile?.fullName}</Text>
      </View>

      <AvailabilityPanel controller={availability} />

      <Button
        label="รีเฟรชสถานะ"
        variant="ghost"
        onPress={() => {
          profileState.reload();
          availability.refresh();
        }}
        testID="button-refresh"
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
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.muted}>กำลังโหลดสถานะรับงาน…</Text>
      </View>
    );
  }

  if (view.status === 'error') {
    return (
      <View style={styles.centred} testID="availability-error">
        <Text style={styles.errorTitle}>โหลดสถานะรับงานไม่สำเร็จ</Text>
        <Text style={styles.muted}>{view.message}</Text>
        <Button label="ลองอีกครั้ง" onPress={controller.refresh} testID="button-retry-availability" />
      </View>
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

  return (
    <View style={styles.panel} testID="availability-panel">
      <StatusStrip variant={isOnline ? 'online' : 'offline'} detail={detail} />

      <Text style={styles.locationNote} testID="location-state">
        {hasPosition
          ? `ตำแหน่งล่าสุดที่ระบบบันทึกไว้ ${formatRecordedAt(locationRecordedAt)}`
          : 'ระบบยังไม่มีตำแหน่งของคุณ'}
      </Text>

      {isOnline ? (
        <Button
          label="ปิดรับงาน"
          variant="secondary"
          loading={busy}
          onPress={() => void goOffline()}
          testID="button-go-offline"
        />
      ) : (
        <Button
          label="เปิดรับงาน"
          loading={busy}
          onPress={() => void goOnline()}
          testID="button-go-online"
        />
      )}

      {actionError ? (
        <Text style={styles.actionError} testID="availability-action-error">
          {actionError}
        </Text>
      ) : null}

      <Text style={styles.privacyNote}>
        ระบบบันทึกเฉพาะตำแหน่งล่าสุดเมื่อคุณกดเปิดรับงานหรือกดรีเฟรชเท่านั้น ไม่มีการติดตามขณะปิดแอป
      </Text>
    </View>
  );
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
  header: { paddingTop: spacing.xl, paddingBottom: spacing.sm, gap: spacing.xs },
  title: { fontSize: fontSize.h2, fontFamily: fontFamily.bold, color: colors.textPrimary },
  name: { fontFamily: fontFamily.regular, fontSize: fontSize.lg, color: colors.textMuted },

  panel: { gap: spacing.md },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  muted: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.textMuted,
    textAlign: 'center',
  },
  errorTitle: { fontFamily: fontFamily.semibold, fontSize: fontSize.xl, color: colors.textPrimary },
  locationNote: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.textMuted,
    paddingHorizontal: spacing.xs,
  },
  actionError: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.md,
    color: colors.danger,
    paddingHorizontal: spacing.xs,
  },
  privacyNote: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textSubtle,
    paddingHorizontal: spacing.xs,
  },
});
