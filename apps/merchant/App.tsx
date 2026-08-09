import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { createApiClient } from '@banhao/api-client';
import { colors, spacing } from '@banhao/ui';

/**
 * Merchant App — foundation only.
 *
 * Deliberately has no ordering, cart, checkout, or map UI. Its purpose right
 * now is to prove the shared packages resolve and the API is reachable, so
 * feature work can start from a known-good base.
 */

const api = createApiClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
});

type ApiState = { kind: 'loading' } | { kind: 'ok' } | { kind: 'error'; message: string };

export default function App() {
  const [state, setState] = useState<ApiState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;

    api
      .health()
      .then(() => {
        if (!cancelled) setState({ kind: 'ok' });
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ kind: 'error', message: error.message });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <Text style={styles.brand}>BANHAO</Text>
      <Text style={styles.subtitle}>บ้านเฮา · Merchant</Text>
      <Text style={styles.status}>
        {state.kind === 'loading' && 'Connecting to API…'}
        {state.kind === 'ok' && 'API reachable ✓'}
        {state.kind === 'error' && `API unreachable: ${state.message}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    padding: spacing.lg,
  },
  brand: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 4,
    color: colors.primary,
  },
  subtitle: {
    marginTop: spacing.xs,
    fontSize: 15,
    color: colors.textMuted,
  },
  status: {
    marginTop: spacing.xl,
    fontSize: 14,
    color: colors.textPrimary,
    textAlign: 'center',
  },
});
