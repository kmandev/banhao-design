'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type {
  SupervisorCaseDetailResponse,
  SupervisorCaseOutcome,
} from '@banhao/validation';
import { SUPERVISOR_CASE_OUTCOMES } from '@banhao/validation';
import { ConsoleShell } from '../../components/ConsoleShell';
import { supervisorCaseRepository } from '../../repositories/supervisorCases';
import { ApiClientError } from '../../lib/apiClient';
import { ageLabel, copy, escalationLabel } from '../../lib/copy';
import * as styles from '../../lib/styles';

/**
 * S-03 (incident detail) and S-06 (close case), on one screen.
 *
 * A dynamic route segment would need `generateStaticParams` under this app's
 * static export, so the case id travels as a query parameter — the same shape
 * the merchant app's OTP screen already uses, rather than giving up static
 * export for one route.
 *
 * ## What this screen deliberately cannot do
 *
 * There is no cancel, no fail, no reassign, no redispatch, no pause and no
 * refund control — **absent, not disabled**. Each depends on a business
 * decision that is open (BQ-013, UX-Q-006, OD-04, BQ-015, Q-032), and the
 * detail response's `blockedBy` names the one that applies so the screen can
 * say *why* it offers nothing rather than looking unfinished. Rendering a
 * greyed-out "ยกเลิกออเดอร์" here would imply a capability the platform does
 * not have and has not decided to have.
 *
 * The one action is closing the case with a reason, which writes an audit row
 * and changes no domain state whatsoever.
 */
const OUTCOME_LABELS: Record<SupervisorCaseOutcome, string> = {
  RESOLVED: copy.outcomeResolved,
  NO_ACTION_NEEDED: copy.outcomeNoAction,
  AWAITING_POLICY: copy.outcomeAwaitingPolicy,
};

function CaseDetail() {
  const router = useRouter();
  const params = useSearchParams();
  const caseId = params.get('id') ?? '';

  const [detail, setDetail] = useState<SupervisorCaseDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [outcome, setOutcome] = useState<SupervisorCaseOutcome>('RESOLVED');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!caseId) {
      setLoading(false);
      setError(copy.errorTitle);
      return;
    }

    setLoading(true);
    setError(null);

    supervisorCaseRepository
      .detail(caseId)
      .then(setDetail)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : copy.errorTitle))
      .finally(() => setLoading(false));
  }, [caseId]);

  useEffect(load, [load]);

  async function onResolve() {
    if (reason.trim().length === 0) {
      // Mirrors `audit_logs_operator_reason_check` (DEC-032): a blank reason
      // cannot reach the database, so it must not reach the button either.
      setSubmitError(copy.reasonHint);
      return;
    }

    setSubmitError(null);
    setSubmitting(true);

    try {
      await supervisorCaseRepository.resolve(caseId, { outcome, reason: reason.trim() });
      load();
    } catch (cause) {
      // A case someone else already closed is a conflict, not a failure to
      // retry: re-reading shows who closed it and why.
      if (cause instanceof ApiClientError && cause.status === 409) {
        setSubmitError(copy.alreadyResolved);
        load();
      } else {
        setSubmitError(cause instanceof Error ? cause.message : copy.errorTitle);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p style={styles.subtitle}>{copy.loading}</p>;

  if (error || !detail) {
    return (
      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>{copy.errorTitle}</h2>
        <button type="button" style={styles.ghostButton} onClick={load}>
          {copy.retry}
        </button>
      </div>
    );
  }

  const resolved = detail.case.state === 'RESOLVED';

  return (
    <>
      <button type="button" style={styles.ghostButton} onClick={() => router.push('/')}>
        ← {copy.back}
      </button>

      <div>
        <span style={styles.chip(resolved ? 'resolved' : 'open')}>
          {resolved ? copy.stateResolved : copy.stateOpen}
        </span>
        <h1 style={{ ...styles.title, marginTop: 8 }}>{escalationLabel(detail.case.escalation)}</h1>
        <p style={styles.meta}>
          {detail.case.action} · {detail.case.escalation} · {ageLabel(detail.case.raisedAt)}
        </p>
      </div>

      <section style={styles.panel}>
        <h2 style={styles.sectionTitle}>{copy.whatHappened}</h2>
        <p style={{ margin: 0 }}>{detail.case.reason}</p>
      </section>

      <section style={styles.panel}>
        <h2 style={styles.sectionTitle}>{copy.subject}</h2>
        <p style={styles.meta}>{copy.subjectLive}</p>
        {detail.subject.type === 'unavailable' ? (
          <p style={styles.subtitle}>{copy.subjectUnavailable}</p>
        ) : (
          <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: 8, margin: 0 }}>
            {Object.entries(detail.subject)
              .filter(([key]) => key !== 'type')
              .map(([key, value]) => (
                <div key={key} style={{ display: 'contents' }}>
                  <dt style={styles.meta}>{key}</dt>
                  <dd style={{ margin: 0 }}>{String(value)}</dd>
                </div>
              ))}
          </dl>
        )}
      </section>

      <section style={styles.panel}>
        <h2 style={styles.sectionTitle}>{copy.evidence}</h2>
        {/* Ids, states and counts as the pipeline recorded them — no prompt
            text, no model reasoning, no PII copied out of its source table
            (DEC-040 § 8 and the design package § 12). */}
        <pre style={styles.evidenceBlock}>{JSON.stringify(detail.evidence, null, 2)}</pre>
      </section>

      <section style={styles.panel}>
        <h2 style={styles.sectionTitle}>{copy.timeline}</h2>
        <table style={styles.table}>
          <tbody>
            {detail.timeline.map((entry, index) => (
              <tr key={`${entry.at}-${index}`}>
                <td style={styles.td}>{new Date(entry.at).toLocaleString('th-TH')}</td>
                <td style={styles.td}>{entry.actorType}</td>
                <td style={styles.td}>{entry.what}</td>
                <td style={styles.td}>{entry.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {detail.blockedBy ? (
        <section style={{ ...styles.panel, borderStyle: 'dashed' }} data-testid="blocked-notice">
          <h2 style={styles.sectionTitle}>{copy.blockedTitle}</h2>
          {/* The dependency is stated, not hidden — an operator must know the
              step exists and is not yet decided. */}
          <p style={styles.subtitle}>{detail.blockedBy}</p>
        </section>
      ) : null}

      {resolved ? (
        <section style={styles.panel} data-testid="resolution">
          <h2 style={styles.sectionTitle}>{copy.resolvedBy}</h2>
          <p style={{ margin: 0 }}>
            {OUTCOME_LABELS[detail.case.resolution?.outcome ?? 'RESOLVED']} ·{' '}
            {detail.case.resolution?.staffRole}
          </p>
          <p style={styles.subtitle}>{detail.case.resolution?.reason}</p>
        </section>
      ) : (
        <section style={styles.panel}>
          <h2 style={styles.sectionTitle}>{copy.resolveTitle}</h2>

          <label style={styles.label} htmlFor="outcome">
            {copy.outcomeLabel}
          </label>
          <select
            id="outcome"
            style={styles.input}
            value={outcome}
            onChange={(event) => setOutcome(event.target.value as SupervisorCaseOutcome)}
          >
            {SUPERVISOR_CASE_OUTCOMES.map((value) => (
              <option key={value} value={value}>
                {OUTCOME_LABELS[value]}
              </option>
            ))}
          </select>

          <label style={{ ...styles.label, marginTop: 12 }} htmlFor="reason">
            {copy.reasonLabel}
          </label>
          <textarea
            id="reason"
            style={styles.textarea}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <p style={styles.meta}>{copy.reasonHint}</p>

          {submitError ? <p style={styles.errorText}>{submitError}</p> : null}

          <button
            type="button"
            style={styles.button(submitting || reason.trim().length === 0)}
            disabled={submitting || reason.trim().length === 0}
            onClick={() => void onResolve()}
          >
            {submitting ? copy.submitting : copy.submit}
          </button>
        </section>
      )}
    </>
  );
}

export default function CaseDetailPage() {
  return (
    <ConsoleShell>
      <Suspense fallback={<p style={styles.subtitle}>{copy.loading}</p>}>
        <CaseDetail />
      </Suspense>
    </ConsoleShell>
  );
}
