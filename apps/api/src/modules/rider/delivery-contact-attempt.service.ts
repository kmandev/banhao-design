import { Injectable, Logger } from '@nestjs/common';
import {
  DELIVERY_CONTACT_ATTEMPTS_REQUIRED,
  type RiderContactAttemptResponse,
} from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';

/** `deliveries`, the columns the eligibility read needs. */
interface DeliveryRow {
  id: string;
  state: string;
  rider_id: string | null;
}

/** `delivery_contact_attempts`, as inserted and read back. */
interface ContactAttemptRow {
  id: string;
  attempt_no: number;
  attempted_at: string;
}

/**
 * The one delivery state in which a customer contact attempt makes sense.
 *
 * DEC-053 § 2's flow is *arrive → attempt contact → wait → operator resolves*.
 * An attempt recorded before the rider reached the customer would be evidence
 * of nothing, and one recorded after the delivery ended would be evidence
 * about a closed delivery. `ARRIVED` (DEC-054) is the whole window.
 */
const CONTACTABLE_DELIVERY_STATE = 'ARRIVED';

/** Postgres unique-violation. The cap's enforcement, surfaced as a retry signal. */
const UNIQUE_VIOLATION = '23505';

/**
 * `POST /api/v1/rider/deliveries/:id/contact-attempt` — BQ-017 Slice #2.
 *
 * The rider records that they tried to reach the customer at the door. One
 * append-only row per attempt, at most two per delivery (DEC-053 § 3).
 *
 * ## This service declares nothing
 *
 * It records an operational fact and returns a count. It does **not** fail the
 * delivery, mark the customer unreachable, choose a cause, touch the order,
 * start or extend a timer, or move any state at all. DEC-053 § 2 makes the
 * operator the failure authority precisely so that a rider never determines a
 * financial outcome — recording the second attempt satisfies one of the
 * operator's preconditions and resolves nothing by itself.
 *
 * ## The cap of two is the database's, not this service's
 *
 * `delivery_contact_attempts` admits `attempt_no` 1 or 2 only (CHECK) and at
 * most one row per `(delivery_id, attempt_no)` (unique constraint), so
 * `count <= 2` is structural. This service derives the *next* ordinal and
 * inserts it; it never decides whether the cap is intact.
 *
 * That distinction is what makes the concurrent case safe. Two simultaneous
 * requests on a delivery with one attempt both derive `2`; exactly one INSERT
 * wins, the other raises `23505`, and {@link recordAttempt} re-derives against
 * the row the winner just committed — which now yields `3`, refused as
 * `CONFLICT`. A `SELECT count(*)` + `if (count < 2)` + `INSERT` would instead
 * let both through and leave three attempts on the delivery. Same discipline
 * as `OfferAcceptanceService`'s round key and `ledger_entry_groups.group_key`:
 * the unique constraint is the sole authority (DEC-028).
 *
 * The retry is bounded to one extra pass, because after a collision the true
 * count can only be 2 — the ceiling — so a second collision is impossible.
 *
 * ## Two genuine attempts are two rows, deliberately
 *
 * Nothing here deduplicates. DEC-053 counts attempts, and two calls a minute
 * apart are two pieces of evidence an operator will read. There is no
 * client-supplied idempotency key: none exists anywhere else in this module,
 * and inventing one would collapse real evidence. What *is* bounded is the
 * total, which is the invariant that matters.
 *
 * ## The eligibility read is a read, and says so
 *
 * Ownership and state are established by a `SELECT` before the INSERT, because
 * nothing is being transitioned — this is the same
 * decides-an-authorization-not-a-transition shape
 * `DeliveryProofService.assertUploadable` already documents as the one
 * legitimate place in this module for it. A delivery that moves between this
 * read and the insert can therefore receive an attempt recorded moments after
 * it left `ARRIVED`. That is an append-only evidence row on a delivery the
 * rider genuinely was at, not a state change, and the operator's own
 * preconditions are re-checked at failure time against live state regardless.
 */
@Injectable()
export class DeliveryContactAttemptService {
  private readonly logger = new Logger(DeliveryContactAttemptService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async recordContactAttempt(
    user: AuthenticatedUser,
    deliveryId: string,
  ): Promise<RiderContactAttemptResponse> {
    // `@Roles('RIDER')` already refused anyone without an APPROVED rider row
    // (see `RiderController`'s own note on this), so this narrows the type and
    // fails closed if the route is ever wired without the decorator.
    const rider = user.capabilities.rider;
    if (!rider) {
      throw new DomainError('FORBIDDEN', { message: 'Not a rider' });
    }
    const riderId = rider.riderId;

    await this.assertContactable(deliveryId, riderId);

    const attempt = await this.recordAttempt(deliveryId, riderId);

    return {
      deliveryId,
      attemptNo: attempt.attempt_no,
      attemptedAt: attempt.attempted_at,
      attemptsRecorded: attempt.attempt_no,
      attemptsRequired: DELIVERY_CONTACT_ATTEMPTS_REQUIRED,
      riderId,
    };
  }

  /**
   * Proves the caller is the rider currently assigned to this delivery **and**
   * that the delivery is at the customer's door.
   *
   * A missing delivery and one belonging to another rider produce the same
   * error deliberately: this must not let a rider learn whether a given id
   * names a real delivery. Same reasoning
   * `DeliveryProofService.assertUploadable` applies.
   */
  private async assertContactable(deliveryId: string, riderId: string): Promise<void> {
    const { data, error } = await this.supabase.admin
      .from('deliveries')
      .select('id, state, rider_id')
      .eq('id', deliveryId)
      .maybeSingle<DeliveryRow>();

    if (error) {
      this.logger.error(`Delivery lookup failed for contact attempt ${deliveryId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Delivery lookup failed' });
    }

    if (!data || data.rider_id !== riderId) {
      throw new DomainError('NOT_ASSIGNED_RIDER', { details: { deliveryId } });
    }

    if (data.state !== CONTACTABLE_DELIVERY_STATE) {
      throw new DomainError('INVALID_TRANSITION', {
        details: { deliveryId, from: data.state, expected: CONTACTABLE_DELIVERY_STATE },
      });
    }
  }

  /**
   * Derives the next ordinal and inserts it, letting the unique constraint
   * settle any concurrent tie.
   *
   * `attempt` is the pass number, not the attempt number: pass 0 is the
   * ordinary path, pass 1 is the single re-derivation a `23505` earns. A
   * second collision cannot happen — after one, the delivery holds both
   * ordinals and the re-derived next is `3`, which is refused before any
   * INSERT is issued.
   */
  private async recordAttempt(
    deliveryId: string,
    riderId: string,
    pass = 0,
  ): Promise<ContactAttemptRow> {
    const recorded = await this.countAttempts(deliveryId);

    if (recorded >= DELIVERY_CONTACT_ATTEMPTS_REQUIRED) {
      throw new DomainError('CONFLICT', {
        message: `A delivery may record at most ${DELIVERY_CONTACT_ATTEMPTS_REQUIRED} customer contact attempts`,
        details: {
          deliveryId,
          attemptsRecorded: recorded,
          attemptsRequired: DELIVERY_CONTACT_ATTEMPTS_REQUIRED,
        },
      });
    }

    const { data, error } = await this.supabase.admin
      .from('delivery_contact_attempts')
      .insert({ delivery_id: deliveryId, rider_id: riderId, attempt_no: recorded + 1 })
      .select('id, attempt_no, attempted_at')
      .maybeSingle<ContactAttemptRow>();

    if (error?.code === UNIQUE_VIOLATION) {
      if (pass > 0) {
        // Unreachable by the argument in this method's doc comment. Refused
        // rather than looped, so a future schema change that broke that
        // argument surfaces as an error instead of a spin.
        this.logger.error(
          `Contact attempt for delivery ${deliveryId} collided twice on (delivery_id, attempt_no) — ` +
            `the cap constraints no longer bound the retry`,
        );
        throw new DomainError('CONFLICT', {
          message: 'Contact attempt could not be recorded',
          details: { deliveryId },
        });
      }

      this.logger.warn(
        `Contact attempt ${recorded + 1} for delivery ${deliveryId} lost a concurrent insert; re-deriving`,
      );
      return this.recordAttempt(deliveryId, riderId, pass + 1);
    }

    if (error || !data) {
      this.logger.error(
        `Contact attempt insert failed for delivery ${deliveryId} (rider ${riderId}): ${error?.message ?? 'no row returned'}`,
      );
      throw new DomainError('INTERNAL_ERROR', { message: 'Contact attempt could not be recorded' });
    }

    return data;
  }

  /** How many attempts this delivery already holds. Never the cap's authority — see the header. */
  private async countAttempts(deliveryId: string): Promise<number> {
    const { count, error } = await this.supabase.admin
      .from('delivery_contact_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('delivery_id', deliveryId);

    if (error) {
      this.logger.error(`Contact attempt count failed for delivery ${deliveryId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Contact attempt could not be recorded' });
    }

    return count ?? 0;
  }
}
