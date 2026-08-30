import * as styles from '../lib/styles';

interface ErrorStateProps {
  title: string;
  message?: string;
  retryLabel?: string;
  onRetry?: () => void;
}

/**
 * Shared shape for the 500 / network-failure states the M-1 brief asks for.
 * Deliberately does not claim an operation succeeded — it is only ever shown
 * when something is known to have failed.
 */
export function ErrorState({ title, message, retryLabel = 'ลองอีกครั้ง', onRetry }: ErrorStateProps) {
  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>{title}</h1>
        {message ? <p style={styles.subtitle}>{message}</p> : null}
        {onRetry ? (
          <button type="button" style={styles.button(false)} onClick={onRetry}>
            {retryLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function NetworkErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <ErrorState
      title="ไม่มีการเชื่อมต่ออินเทอร์เน็ต"
      message="ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง"
      onRetry={onRetry}
    />
  );
}
