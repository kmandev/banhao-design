import { StyleSheet, Text, View } from 'react-native';
import {
  Card,
  SectionHeader,
  StateView,
  colors,
  fontFamily,
  fontSize,
  spacing,
} from '@banhao/ui';
import { Screen } from '../components/Screen';
import { useAsyncData } from '../hooks/useAsyncData';
import { repositories } from '../repositories';

/** 17 แจ้งเตือน. */
export function NotificationsScreen() {
  const state = useAsyncData(() => repositories.notifications.listNotifications());

  return (
    <Screen scroll testID="screen-notifications">
      <SectionHeader title="แจ้งเตือน" />

      {state.status === 'loading' ? (
        <StateView kind="loading" title="กำลังโหลด…" />
      ) : state.status === 'error' ? (
        <StateView
          kind="error"
          glyph="📡"
          title="โหลดแจ้งเตือนไม่สำเร็จ"
          message={state.message}
          actionLabel="ลองใหม่"
          onAction={state.reload}
        />
      ) : state.data.length === 0 ? (
        <StateView
          kind="empty"
          glyph="🔔"
          title="ยังไม่มีแจ้งเตือน"
          message="ความเคลื่อนไหวของออเดอร์จะแสดงที่นี่"
          testID="state-notifications-empty"
        />
      ) : (
        state.data.map((n) => (
          <Card key={n.id} style={[styles.card, !n.read && styles.cardUnread]}>
            <View style={styles.row}>
              <Text style={styles.glyph}>{n.glyph}</Text>
              <View style={styles.body}>
                <Text style={styles.title}>{n.title}</Text>
                <Text style={styles.text}>{n.body}</Text>
                <Text style={styles.time}>{n.time}</Text>
              </View>
              {!n.read ? <View style={styles.dot} accessibilityLabel="ยังไม่ได้อ่าน" /> : null}
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {},
  // Unread rows get the design's warm tint rather than a heavier treatment.
  cardUnread: { backgroundColor: colors.primarySoft, borderColor: colors.surfaceAccent },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  glyph: { fontFamily: fontFamily.regular, fontSize: 24 },
  body: { flex: 1, gap: 3 },
  title: { fontSize: fontSize.lg, fontFamily: fontFamily.semibold, color: colors.textPrimary },
  text: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.textMuted, lineHeight: 20 },
  time: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textSubtle },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginTop: 6 },
});
