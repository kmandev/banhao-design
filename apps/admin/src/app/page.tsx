'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SupervisorCaseListResponse } from '@banhao/validation';
import { ConsoleShell } from '../components/ConsoleShell';
import { supervisorCaseRepository } from '../repositories/supervisorCases';
import { ageLabel, copy, escalationLabel } from '../lib/copy';
import * as styles from '../lib/styles';

/**
 * S-02 — กล่องงาน, the operations inbox.
 *
 * Success is an empty inbox, so this screen is built for someone who opens it
 * when notified and closes it again: one table, ordered newest first, with the
 * age and the reason visible without opening anything.
 *
 * Two things it deliberately does not have. There is no severity ranking —
 * "what will hurt soonest" needs thresholds nobody has approved (BQ-013,
 * UX-Q-006), and inventing an ordering would be inventing the policy behind it.
 * And there is no bulk action, no assign and no snooze: the only thing a
 * supervisor can do to a case is open it and close it with a reason.
 */
function Inbox() {
  const router = useRouter();
  const [data, setData] = useState<SupervisorCaseListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    supervisorCaseRepository
      .list()
      .then(setData)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : copy.errorTitle))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  if (loading) return <p style={styles.subtitle}>{copy.loading}</p>;

  if (error) {
    return (
      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>{copy.errorTitle}</h2>
        {/* Empty and broken are different states and must not look alike. */}
        <button type="button" style={styles.ghostButton} onClick={load}>
          {copy.retry}
        </button>
      </div>
    );
  }

  const cases = data?.cases ?? [];

  return (
    <>
      <div>
        <h1 style={styles.title}>{copy.inboxTitle}</h1>
        <p style={styles.subtitle}>{copy.inboxSubtitle}</p>
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ ...styles.panel, flex: 1 }}>
          <p style={styles.meta}>{copy.countOpen}</p>
          <strong style={{ fontSize: 24 }} data-testid="count-open">
            {data?.window.openInWindow ?? 0}
          </strong>
        </div>
        <div style={{ ...styles.panel, flex: 1 }}>
          <p style={styles.meta}>{copy.countResolved}</p>
          <strong style={{ fontSize: 24 }} data-testid="count-resolved">
            {data?.window.resolvedInWindow ?? 0}
          </strong>
        </div>
      </div>
      {/* The counts are of this page, and the caption says so rather than
          implying a system-wide total the endpoint never computed. */}
      <p style={styles.meta}>{copy.windowNote}</p>

      {cases.length === 0 ? (
        <div style={styles.panel}>
          <p style={styles.subtitle}>{copy.inboxEmpty}</p>
        </div>
      ) : (
        <div style={styles.panel}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>{copy.columnSeverity}</th>
                <th style={styles.th}>{copy.columnSubject}</th>
                <th style={styles.th}>{copy.columnReason}</th>
                <th style={styles.th}>{copy.columnAge}</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((row) => (
                <tr
                  key={row.caseId}
                  data-testid="case-row"
                  style={{ cursor: 'pointer' }}
                  onClick={() => router.push(`/cases?id=${encodeURIComponent(row.caseId)}`)}
                >
                  <td style={styles.td}>
                    <span style={styles.chip(row.state === 'OPEN' ? 'open' : 'resolved')}>
                      {row.state === 'OPEN' ? copy.stateOpen : copy.stateResolved}
                    </span>
                  </td>
                  <td style={styles.td}>
                    <div>{escalationLabel(row.escalation)}</div>
                    <div style={styles.meta}>
                      {row.subjectType} · {row.subjectId.slice(0, 8)}
                    </div>
                  </td>
                  <td style={styles.td}>{row.reason}</td>
                  <td style={styles.td}>{ageLabel(row.raisedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function InboxPage() {
  return (
    <ConsoleShell>
      <Inbox />
    </ConsoleShell>
  );
}
