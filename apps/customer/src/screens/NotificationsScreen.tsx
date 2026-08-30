import { useState } from 'react';
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

  // H-5B — locally-confirmed reads, layered over `state.data` rather than a
  // copy of it: the list itself still comes straight from the load, so a
  // `reload()` after a real change is never fighting stale local state, and
  // there is no render where this lags behind a fresh `state.data` (which a
  // `useEffect`-synced copy would produce for one frame on every load).
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(new Set());

  /**
   * Marks read only once the API confirms it — a failure leaves `readIds`
   * untouched, which is what "preserve current visual state" means here: an
   * already-unread card just stays unread, no revert to invent and no new
   * failure UX (H-5B's product lock: no toast/global error system for this
   * action).
   */
  async function handlePress(id: string, alreadyRead: boolean): Promise<void> {
    if (alreadyRead) return;
    try {
      await repositories.notifications.markNotificationRead(id);
      setReadIds((current) => new Set(current).add(id));
    } catch {
      // Swallowed deliberately — see the function's own comment above.
    }
  }

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
        state.data.map((n) => {
          const read = n.read || readIds.has(n.id);
          return (
            <Card
              key={n.id}
              onPress={() => void handlePress(n.id, read)}
              testID={`notification-card-${n.id}`}
              style={[styles.card, !read && styles.cardUnread]}
            >
              <View style={styles.row}>
                <Text style={styles.glyph}>{n.glyph}</Text>
                <View style={styles.body}>
                  <Text style={styles.title}>{n.title}</Text>
                  <Text style={styles.text}>{n.body}</Text>
                  <Text style={styles.time}>{n.time}</Text>
                </View>
                {!read ? <View style={styles.dot} accessibilityLabel="ยังไม่ได้อ่าน" /> : null}
              </View>
            </Card>
          );
        })
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
