import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, fontSize, radius, spacing } from '@banhao/ui';
import { Screen } from '../components/Screen';
import { ErrorState } from '../components/ErrorState';
import { useAsyncData } from '../hooks/useAsyncData';
import { fetchRiderEarnings } from '../repositories/riderEarnings';

/**
 * DEC-073 / DEC-070 Q5 — the rider's earnings: each delivery of the week and
 * what it earned (80% of the delivery fee, at least ฿12), whether BANHAO has
 * transferred it, everything still owed, and recent transfers. Read-only; no
 * design artifact exists (R-13 earnings), so a plain list.
 */
function baht(satang: number): string {
  const value = satang / 100;
  return `฿${Number.isInteger(value) ? value.toLocaleString('th-TH') : value.toFixed(2)}`;
}

export function currentMonday(now: Date = new Date()): string {
  const bkk = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const sinceMonday = (bkk.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate() - sinceMonday)).toISOString().slice(0, 10);
}

function shiftWeek(weekStart: string, weeks: number): string {
  return new Date(new Date(`${weekStart}T00:00:00Z`).getTime() + weeks * 7 * 86400000).toISOString().slice(0, 10);
}

export function EarningsScreen() {
  const [week, setWeek] = useState(currentMonday());
  const load = useCallback(() => fetchRiderEarnings(week), [week]);
  const state = useAsyncData(load, [week]);

  return (
    <Screen scroll testID="screen-earnings">
      <View style={styles.weekRow}>
        <Pressable onPress={() => setWeek(shiftWeek(week, -1))} testID="earnings-prev" style={styles.weekButton}>
          <Text style={styles.weekButtonText}>← ก่อนหน้า</Text>
        </Pressable>
        <Text style={styles.weekLabel}>
          {state.status === 'success' ? `${state.data.period.weekStart} – ${state.data.period.weekEnd}` : week}
        </Text>
        <Pressable onPress={() => setWeek(shiftWeek(week, 1))} testID="earnings-next" style={styles.weekButton}>
          <Text style={styles.weekButtonText}>ถัดไป →</Text>
        </Pressable>
      </View>

      {state.status === 'loading' ? <ActivityIndicator style={{ marginTop: spacing.xl }} /> : null}
      {state.status === 'error' ? <ErrorState headline="โหลดรายได้ไม่สำเร็จ" onRetry={state.reload} /> : null}

      {state.status === 'success' ? (
        <View style={{ gap: spacing.md }}>
          <View style={styles.totals}>
            <View style={styles.totalCard} testID="earnings-week-total">
              <Text style={styles.totalLabel}>สัปดาห์นี้</Text>
              <Text style={styles.totalValue}>{baht(state.data.weekTotalSatang)}</Text>
            </View>
            <View style={styles.totalCard} testID="earnings-outstanding">
              <Text style={styles.totalLabel}>รอโอน</Text>
              <Text style={styles.totalValue}>{baht(state.data.outstandingSatang)}</Text>
            </View>
          </View>
          <Text style={styles.note}>ต่องาน = 80% ของค่าส่ง ขั้นต่ำ ฿12 · โอนสัปดาห์ละครั้ง</Text>

          {state.data.lines.length === 0 ? (
            <Text style={styles.empty} testID="earnings-empty">ยังไม่มีงานที่ส่งสำเร็จในสัปดาห์นี้</Text>
          ) : (
            state.data.lines.map((line) => (
              <View key={line.id} style={styles.line} testID={`earnings-line-${line.id}`}>
                <View>
                  <Text style={styles.lineTitle}>{line.orderNumber ?? 'งานส่ง'}</Text>
                  <Text style={styles.lineMeta}>{line.paid ? 'โอนแล้ว' : 'รอโอน'}</Text>
                </View>
                <Text style={styles.lineAmount}>{baht(line.amountSatang)}</Text>
              </View>
            ))
          )}

          <Text style={styles.section}>การโอนล่าสุด</Text>
          {state.data.payouts.length === 0 ? (
            <Text style={styles.empty}>ยังไม่มีการโอน</Text>
          ) : (
            state.data.payouts.map((p) => (
              <View key={`${p.paidOn}-${p.bankReference}`} style={styles.line}>
                <View>
                  <Text style={styles.lineTitle}>{p.paidOn}</Text>
                  <Text style={styles.lineMeta}>{p.items} งาน · อ้างอิง {p.bankReference}</Text>
                </View>
                <Text style={styles.lineAmount}>{baht(p.totalSatang)}</Text>
              </View>
            ))
          )}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  weekRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  weekButton: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  weekButtonText: { fontFamily: fontFamily.semibold, fontSize: fontSize.md, color: colors.textPrimary },
  weekLabel: { fontFamily: fontFamily.semibold, fontSize: fontSize.md, color: colors.textPrimary },
  totals: { flexDirection: 'row', gap: spacing.md },
  totalCard: { flex: 1, backgroundColor: colors.surfaceRaised, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  totalLabel: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted },
  totalValue: { fontFamily: fontFamily.bold, fontSize: fontSize.xl, color: colors.textPrimary },
  note: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted },
  empty: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.textMuted },
  section: { fontFamily: fontFamily.semibold, fontSize: fontSize.lg, color: colors.textPrimary, marginTop: spacing.md },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  lineTitle: { fontFamily: fontFamily.semibold, fontSize: fontSize.md, color: colors.textPrimary },
  lineMeta: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted },
  lineAmount: { fontFamily: fontFamily.bold, fontSize: fontSize.lg, color: colors.textPrimary },
});
