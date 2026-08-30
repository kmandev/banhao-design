import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { driverColors, driverFontSize, fontFamily } from '@banhao/ui';

/**
 * T2.1 — the offer inbox's countdown (Driver App Redesign §D / R-05b–d).
 *
 * Derived from `expiresAt` and nothing else — no invented timer, no
 * fabricated window (§C3). Ticks locally once a second, clamps at `00:00`,
 * and never disables anything itself: Test I drives an accept on an expired
 * offer through the real buttons, so this component only ever displays a
 * value, it never gates one.
 */
export interface CountdownProps {
  /** `null` renders the "no expiry" treatment — the API treats a null expiry as expired. */
  expiresAt: string | null;
  testID?: string;
}

const NO_EXPIRY_LABEL = 'ไม่ระบุเวลา';

function secondsRemaining(expiresAt: string): number {
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 1000));
}

function format(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function Countdown({ expiresAt, testID = 'countdown' }: CountdownProps) {
  const [remaining, setRemaining] = useState(() => (expiresAt ? secondsRemaining(expiresAt) : 0));

  useEffect(() => {
    if (!expiresAt) return;
    setRemaining(secondsRemaining(expiresAt));

    const interval = setInterval(() => {
      setRemaining(secondsRemaining(expiresAt));
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  if (!expiresAt) {
    return (
      <Text style={[styles.value, styles.inactive]} testID={testID}>
        {NO_EXPIRY_LABEL}
      </Text>
    );
  }

  const expired = remaining <= 0;

  return (
    <Text
      style={[styles.value, expired && styles.inactive]}
      testID={testID}
      accessibilityLiveRegion="polite"
      accessibilityLabel={`เหลือเวลารับงาน ${remaining} วินาที`}
    >
      {format(remaining)}
    </Text>
  );
}

const styles = StyleSheet.create({
  value: {
    fontFamily: fontFamily.semibold,
    fontSize: driverFontSize.countdown,
    color: driverColors.onPrimary.text,
  },
  inactive: { color: driverColors.text.inactive },
});
