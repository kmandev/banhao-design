import { colors } from '@banhao/ui/theme';
import * as styles from '../lib/styles';

export function Spinner({ label }: { label?: string }) {
  return (
    <div style={styles.page} role="status" aria-live="polite">
      <div
        aria-hidden
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          border: `3px solid ${colors.border}`,
          borderTopColor: colors.primary,
          animation: 'banhao-spin 0.8s linear infinite',
        }}
      />
      {label ? <p style={{ ...styles.subtitle, marginTop: 16 }}>{label}</p> : null}
      <style>{'@keyframes banhao-spin { to { transform: rotate(360deg); } }'}</style>
    </div>
  );
}
