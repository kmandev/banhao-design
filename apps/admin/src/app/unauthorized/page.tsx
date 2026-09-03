'use client';

import { useAuth } from '../../hooks/useAuth';
import { copy } from '../../lib/copy';
import * as styles from '../../lib/styles';

/**
 * S-01's refusal state.
 *
 * A signed-in account with no `platform_staff` grant lands here. It deliberately
 * says nothing about what exists behind the gate — no case count, no queue
 * depth — matching the Admin design package's own rule that an unauthorized
 * visitor learns nothing about the system's contents.
 */
export default function UnauthorizedPage() {
  const { signOut } = useAuth();

  return (
    <div style={styles.centred}>
      <div style={styles.card}>
        <h1 style={styles.title}>{copy.forbiddenTitle}</h1>
        <p style={styles.subtitle}>{copy.forbiddenBody}</p>
        <button type="button" style={styles.ghostButton} onClick={() => void signOut()}>
          {copy.signOut}
        </button>
      </div>
    </div>
  );
}
