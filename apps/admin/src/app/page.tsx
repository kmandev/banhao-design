import { colors, spacing } from '@banhao/ui/theme';

/**
 * Admin — foundation only.
 *
 * Deliberately has no dashboard, live map, approval queue, or reconciliation
 * UI. Those depend on domain schema and decisions that are still open.
 */
export default function Home() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surface,
        padding: spacing.xl,
      }}
    >
      <h1 style={{ color: colors.primary, letterSpacing: '0.16em', margin: 0 }}>BANHAO</h1>
      <p style={{ color: colors.textMuted, marginTop: spacing.xs }}>บ้านเฮา · Admin</p>
      <p style={{ color: colors.textPrimary, marginTop: spacing.xl, fontSize: 14 }}>
        Application foundation. No admin features are implemented yet.
      </p>
    </main>
  );
}
