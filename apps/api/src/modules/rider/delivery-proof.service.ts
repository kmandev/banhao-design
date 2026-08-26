import { Injectable, Logger } from '@nestjs/common';
import type { RiderProofUploadUrlResponse } from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';
import { StorageService } from '../storage/storage.service';
import { deliveryProofObjectKey, InvalidObjectKeyInputError } from '../storage/object-key';

/** `deliveries`, the three columns the authorization read needs. */
interface DeliveryRow {
  id: string;
  state: string;
  rider_id: string | null;
}

/**
 * The one state a proof photo may be uploaded for.
 *
 * POD is a precondition of the existing `EN_ROUTE -> DELIVERED` transition,
 * not a state of its own (the POD UX design §B, and the deployed
 * `deliveries.state` CHECK, which has no `ARRIVED` or `POD_CAPTURED`). So a
 * presign is issued only while the rider is genuinely out delivering — never
 * for a delivery they have not picked up, and never for one already closed.
 */
const PROOF_UPLOADABLE_STATE = 'EN_ROUTE';

/**
 * `POST /api/v1/rider/deliveries/:id/proof/upload-url` — POD, Phase G-7.2
 * Phase 2.
 *
 * Third instance of the upload pattern `RestaurantCoverService` (M-11) and
 * `MenuItemImageService` (M-12) already established, with two deliberate
 * differences:
 *
 * 1. **The audience check is assigned-rider, not restaurant membership.**
 *    M-12 resolves a menu item to its restaurant and calls `hasMerchantAccess`;
 *    this resolves a delivery to its rider and compares it to the caller's own
 *    `capabilities.rider.riderId`. Same shape, different relation.
 * 2. **There is a state check as well as an ownership check.** A cover image
 *    can be replaced at any time; a proof photo is evidence of a handover that
 *    is happening right now, so a presign is refused for a delivery that is
 *    not `EN_ROUTE`. That closes "upload a photo to a delivery I closed last
 *    week" without needing a separate rule at completion time.
 *
 * ## There is no `complete` step here, and that is the point
 *
 * M-11 and M-12 both pair a presign with their own `complete` endpoint that
 * persists the key. POD does not: the completion **is** the delivered command
 * (`DeliveryCompletionService`), which writes `proof_photo_path` in the same
 * guarded UPDATE that moves `EN_ROUTE -> DELIVERED`. Folding them removes both
 * bad states a separate `complete` would admit — a photo recorded against a
 * delivery that never completed, and a delivery that completed with no photo.
 * See the POD UX design §B, "Why the upload is not its own endpoint pair".
 *
 * ## What this service never does
 *
 * It never writes anything. A presign is an authorization to PUT one object,
 * not a record that anything happened — nothing in the database changes here,
 * and a rider who requests ten presigns and uploads nothing has left ten
 * authorizations to expire and no state behind. It never accepts an object key
 * from the caller, never returns a public URL (proof objects live in the
 * private bucket, which has none), and never touches order, payment, ledger,
 * assignment or availability state.
 *
 * ## Accepted orphans
 *
 * A retake uploads a second object and the first becomes unreferenced; an
 * abandoned flow leaves one with no row pointing at it. Both are accepted and
 * documented, exactly as M-11 and M-12 already accept the same thing. No
 * cleanup job is specified here, and inventing one is out of scope.
 */
@Injectable()
export class DeliveryProofService {
  private readonly logger = new Logger(DeliveryProofService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly storage: StorageService,
  ) {}

  async requestUploadUrl(
    user: AuthenticatedUser,
    deliveryId: string,
    contentType: string,
  ): Promise<RiderProofUploadUrlResponse> {
    // `@Roles('RIDER')` already refused anyone without an APPROVED rider row;
    // this narrows the type and fails closed if the route is ever wired
    // without the decorator.
    const rider = user.capabilities.rider;
    if (!rider) {
      throw new DomainError('FORBIDDEN', { message: 'Not a rider' });
    }

    await this.assertUploadable(deliveryId, rider.riderId);

    const objectKey = this.buildObjectKey(deliveryId, contentType);

    // The private bucket, explicitly. A proof photo in the public bucket would
    // be fetchable by anyone holding its key — see `StorageService`'s
    // `BucketKind`.
    const uploadUrl = await this.storage.getSignedUploadUrl(
      objectKey,
      contentType,
      undefined,
      'private',
    );

    return { uploadUrl, objectKey };
  }

  /**
   * Proves the caller is the rider currently assigned to this delivery **and**
   * that the delivery is in the one state a proof photo belongs to.
   *
   * A read rather than a guarded UPDATE, because nothing is being transitioned
   * — this is the one place in the rider module where a `SELECT` legitimately
   * decides something, and it decides only whether to *issue an
   * authorization*, never whether a state change happened. The delivered
   * command re-establishes both facts in its own guarded `WHERE` clause
   * regardless of what was decided here, so a delivery that moves between the
   * presign and the completion is caught there, not trusted from this read.
   *
   * A missing delivery and one belonging to another rider produce the **same**
   * error, deliberately: this must not let a rider learn whether a given id
   * names a real delivery. That mirrors `MenuItemImageService`'s own
   * indistinguishable `NOT_RESTAURANT_MEMBER`.
   */
  private async assertUploadable(deliveryId: string, riderId: string): Promise<void> {
    const { data, error } = await this.supabase.admin
      .from('deliveries')
      .select('id, state, rider_id')
      .eq('id', deliveryId)
      .maybeSingle<DeliveryRow>();

    if (error) {
      this.logger.error(`Delivery lookup failed for proof presign ${deliveryId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Delivery lookup failed' });
    }

    if (!data || data.rider_id !== riderId) {
      throw new DomainError('NOT_ASSIGNED_RIDER', { details: { deliveryId } });
    }

    if (data.state !== PROOF_UPLOADABLE_STATE) {
      throw new DomainError('INVALID_TRANSITION', {
        details: { deliveryId, from: data.state, to: 'DELIVERED' },
      });
    }
  }

  /** Wraps `deliveryProofObjectKey`, translating its error into the API's own contract. */
  private buildObjectKey(deliveryId: string, contentType: string): string {
    try {
      return deliveryProofObjectKey(deliveryId, contentType);
    } catch (error) {
      if (error instanceof InvalidObjectKeyInputError) {
        throw new DomainError('VALIDATION_FAILED', {
          message: error.message,
          details: { contentType: [error.message] },
        });
      }
      throw error;
    }
  }
}
