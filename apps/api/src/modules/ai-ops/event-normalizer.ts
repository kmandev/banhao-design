import { PLAYBOOK_ACTIONS, type OperationalEvent, type PlaybookId } from './ai-ops.types';

/** The `outbox` columns this slice reads. Read-only — AI Operations never writes or claims an outbox row. */
export interface OutboxRowForNormalization {
  id: unknown;
  aggregate_type: unknown;
  aggregate_id: unknown;
  event_type: unknown;
  created_at: unknown;
}

/**
 * The shipped `outbox` event types AI Operations recognizes, each mapped to
 * the playbook whose dedupe key it carries.
 *
 * Both are events the domain already writes. No new event type is introduced
 * and no domain service is modified to emit one:
 *
 * - `PaymentSucceeded` (`aggregate_type: 'order'`) is written by
 *   `PaymentEventProcessingService.writePaymentSucceededOutboxEvent` and marks
 *   the moment an order becomes `PAID` — exactly when the merchant-acceptance
 *   clock starts under DEC-019.
 * - `OrderNoRiderFound` (`aggregate_type: 'delivery'`) is written by
 *   `NoRiderEscalationService` when a delivery crosses DEC-022's 5-minute
 *   notice window still searching. It is the shipped signal that a broadcast
 *   is not converting.
 *
 * The mapped playbook is used only to derive the dedupe key. Routing itself
 * stays in {@link PlaybookRouter} — this stage decides *what happened*, never
 * *what to do about it*.
 */
const RECOGNIZED_EVENTS: Readonly<Record<string, { aggregateType: 'order' | 'delivery'; playbook: PlaybookId }>> =
  Object.freeze({
    PaymentSucceeded: { aggregateType: 'order', playbook: 'MERCHANT_ACCEPTANCE_TIMEOUT' },
    OrderNoRiderFound: { aggregateType: 'delivery', playbook: 'NO_RIDER_TRIAGE' },
  });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_RE.test(value) ? value : null;
}

function asIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : value;
}

/**
 * Phase J — stage 1. Turns a shipped `outbox` row into a normalized
 * {@link OperationalEvent}, or refuses it.
 *
 * Deterministic and total: every input either produces exactly one event or
 * `null`. There is no model call here, no I/O, and no policy — this stage
 * decides *what happened*, never *what to do about it*.
 *
 * A `null` return is not an error to swallow. The caller escalates it as
 * `ESC-UNKNOWN`: a malformed or unrecognized operational event is precisely
 * the case DEC-040 §5 says must fail closed rather than be guessed at.
 */
export class EventNormalizer {
  /** The action name the merchant-acceptance playbook audits and dedupes under. */
  static readonly MERCHANT_ACCEPTANCE_ACTION = PLAYBOOK_ACTIONS.MERCHANT_ACCEPTANCE_TIMEOUT;

  /** The action name the no-rider triage playbook audits and dedupes under. */
  static readonly NO_RIDER_TRIAGE_ACTION = PLAYBOOK_ACTIONS.NO_RIDER_TRIAGE;

  normalize(row: OutboxRowForNormalization): OperationalEvent | null {
    const sourceEventId = asUuid(row.id);
    const aggregateId = asUuid(row.aggregate_id);
    const occurredAt = asIsoTimestamp(row.created_at);

    if (!sourceEventId || !aggregateId || !occurredAt) {
      return null;
    }

    if (typeof row.event_type !== 'string') {
      return null;
    }

    const recognized = Object.prototype.hasOwnProperty.call(RECOGNIZED_EVENTS, row.event_type)
      ? RECOGNIZED_EVENTS[row.event_type]
      : undefined;

    if (!recognized) {
      return null;
    }

    // The aggregate type is checked against the one this event type is known
    // to carry, not against a permissive set: an `OrderNoRiderFound` row
    // claiming to be about an order is malformed, and guessing which half is
    // right is exactly what this stage must not do.
    if (row.aggregate_type !== recognized.aggregateType) {
      return null;
    }

    return {
      sourceEventId,
      eventType: row.event_type,
      aggregateType: recognized.aggregateType,
      aggregateId,
      occurredAt,
      dedupeKey: `${PLAYBOOK_ACTIONS[recognized.playbook]}:${aggregateId}`,
    };
  }
}
