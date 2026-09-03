import type { OperationalEvent } from './ai-ops.types';

/** The `outbox` columns this slice reads. Read-only — AI Operations never writes or claims an outbox row. */
export interface OutboxRowForNormalization {
  id: unknown;
  aggregate_type: unknown;
  aggregate_id: unknown;
  event_type: unknown;
  created_at: unknown;
}

/**
 * The event types this slice recognizes.
 *
 * `PaymentSucceeded` is the shipped event that marks the moment an order
 * becomes `PAID` — which is exactly when the merchant-acceptance clock starts.
 * It is written by `PaymentEventProcessingService.writePaymentSucceededOutboxEvent`
 * with `aggregate_type: 'order'`. No new event type is introduced by this
 * slice, and no domain service is modified to emit one.
 */
const RECOGNIZED_EVENT_TYPES = new Set(['PaymentSucceeded']);

const RECOGNIZED_AGGREGATE_TYPES = new Set(['order', 'delivery']);

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
  /** The action name this slice's dedupe key is built from — also the `audit_logs.action` value. */
  static readonly MERCHANT_ACCEPTANCE_ACTION = 'AI_OPS_MERCHANT_ACCEPTANCE_TIMEOUT';

  normalize(row: OutboxRowForNormalization): OperationalEvent | null {
    const sourceEventId = asUuid(row.id);
    const aggregateId = asUuid(row.aggregate_id);
    const occurredAt = asIsoTimestamp(row.created_at);

    if (!sourceEventId || !aggregateId || !occurredAt) {
      return null;
    }

    if (typeof row.event_type !== 'string' || !RECOGNIZED_EVENT_TYPES.has(row.event_type)) {
      return null;
    }

    if (typeof row.aggregate_type !== 'string' || !RECOGNIZED_AGGREGATE_TYPES.has(row.aggregate_type)) {
      return null;
    }

    return {
      sourceEventId,
      eventType: row.event_type,
      aggregateType: row.aggregate_type as 'order' | 'delivery',
      aggregateId,
      occurredAt,
      dedupeKey: `${EventNormalizer.MERCHANT_ACCEPTANCE_ACTION}:${aggregateId}`,
    };
  }
}
