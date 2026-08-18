import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';
import { StorageService } from '../storage/storage.service';
import {
  InvalidObjectKeyInputError,
  mimeTypeForExtension,
  restaurantCoverObjectKey,
} from '../storage/object-key';

/**
 * Restaurant cover image upload — M-11, the first real consumer of
 * `StorageService`.
 *
 * **Authorization happens entirely before this service is called.**
 * `restaurantId` arrives here only after `SupabaseAuthGuard` (verified JWT),
 * `RolesGuard` (`@Roles('MERCHANT')`) and `RestaurantScopeGuard`
 * (`@RestaurantScope()`, DEC-033 per-restaurant membership) have all passed —
 * see `RestaurantCoverController`. This service does not re-check who the
 * caller is; it trusts the guarded `restaurantId` the same way
 * `AddressesService` trusts a guard-verified `userId`.
 *
 * **No upload-session table.** The object key is deterministic
 * (`restaurantCoverObjectKey`), so "did the upload really happen" is answered
 * by asking R2 directly (`StorageService.exists`) rather than by persisting
 * session state — R2 is already the source of truth for whether the bytes
 * arrived, and a presigned URL's own short expiry (`getSignedUploadUrl`,
 * default 300s) is the only "session" this flow needs. A client cannot fake
 * completion for content it never uploaded: `completeUpload` recomputes the
 * expected key from the *server-verified* `restaurantId` and the extension on
 * the client's own submitted key, and only proceeds if that recomputed key is
 * byte-for-byte the one the client sent **and** an object genuinely exists
 * there. There is nothing a client could submit that both matches its own
 * restaurant's key shape and points at data it didn't legitimately upload —
 * `@RestaurantScope()` already confines every key to the caller's own
 * restaurant, so this can never resolve to another tenant's object.
 */
@Injectable()
export class RestaurantCoverService {
  private readonly logger = new Logger(RestaurantCoverService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly supabase: SupabaseService,
  ) {}

  /**
   * Step 1 — authorizes and issues a presigned `PUT` URL.
   *
   * `contentType` is the only client input that participates in shaping the
   * key, and it is validated by `restaurantCoverObjectKey`'s own allow-list
   * (`InvalidObjectKeyInputError` on anything else) — the same check
   * `completeUpload` will re-derive against later, so the two can never
   * disagree about what counts as a valid format.
   */
  async requestUploadUrl(
    restaurantId: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; objectKey: string }> {
    const objectKey = this.buildObjectKey(restaurantId, contentType, 'contentType');
    const uploadUrl = await this.storage.getSignedUploadUrl(objectKey, contentType);

    return { uploadUrl, objectKey };
  }

  /**
   * Step 2 — verifies the upload really happened, then persists the object
   * key (never a full URL) to `restaurants.image_url`.
   *
   * Naturally idempotent: calling this twice with the same, still-valid
   * `objectKey` performs the same `UPDATE ... SET image_url = X` both times —
   * the second call changes nothing that the first did not already set.
   */
  async completeUpload(restaurantId: string, objectKey: string): Promise<{ imageUrl: string }> {
    const extension = objectKey.split('.').pop() ?? '';
    const mimeType = mimeTypeForExtension(extension);

    if (!mimeType) {
      throw new DomainError('VALIDATION_FAILED', {
        message: 'objectKey has an unrecognised or missing extension',
        details: { objectKey: ['unrecognised extension'] },
      });
    }

    // The only source of truth for "the expected key" — never the client's
    // `objectKey` itself. `restaurantId` here is the guard-verified value;
    // `mimeType` was just derived from the client's key, not asserted by it.
    const expectedKey = this.buildObjectKey(restaurantId, mimeType, 'objectKey');

    if (expectedKey !== objectKey) {
      // Deliberately generic: this is reached by an arbitrary/foreign key, a
      // path-traversal attempt, or a cross-restaurant key alike, and none of
      // those deserve a more specific answer than "that is not your key".
      throw new DomainError('VALIDATION_FAILED', {
        message: 'objectKey does not match the authorized restaurant and format',
        details: { objectKey: ['does not match the expected key for this restaurant'] },
      });
    }

    const uploaded = await this.storage.exists(expectedKey);
    if (!uploaded) {
      throw new DomainError('NOT_FOUND', {
        message: 'No object was found at the expected key — upload it before completing',
      });
    }

    // Known, accepted orphan behaviour (not a bug, not deferred to a
    // background job): if the merchant previously uploaded `cover.jpg` and
    // now uploads `cover.webp`, this UPDATE overwrites `image_url` and the
    // old `cover.jpg` object is left in R2, unreferenced. Deleting it here
    // would require first reading the prior value (a second round trip) and
    // would put a second, unrelated failure mode — a delete error — inside
    // this request's success path for a cleanup that is not load-bearing.
    // Same-format re-uploads (`cover.webp` → `cover.webp`) have no orphan at
    // all: the key is identical and the object is simply overwritten.
    const { data, error } = await this.supabase.admin
      .from('restaurants')
      .update({ image_url: expectedKey })
      .eq('id', restaurantId)
      .select('id, image_url')
      .maybeSingle<{ id: string; image_url: string }>();

    if (error) {
      this.logger.error(`Restaurant cover update failed for ${restaurantId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Restaurant cover update failed' });
    }

    // Structurally shouldn't happen — `RestaurantScopeGuard` already proved
    // membership exists, and `restaurant_members.restaurant_id` foreign-keys
    // `restaurants(id)`, so a membership cannot outlive its restaurant. Kept
    // as a defensive fallback for the theoretical race of a concurrent delete.
    if (!data) {
      throw new DomainError('NOT_FOUND', { message: 'Restaurant not found' });
    }

    return { imageUrl: data.image_url };
  }

  /** Wraps `restaurantCoverObjectKey`, translating its error into the API's own contract. */
  private buildObjectKey(restaurantId: string, mimeType: string, field: string): string {
    try {
      return restaurantCoverObjectKey(restaurantId, mimeType);
    } catch (error) {
      if (error instanceof InvalidObjectKeyInputError) {
        throw new DomainError('VALIDATION_FAILED', {
          message: error.message,
          details: { [field]: [error.message] },
        });
      }
      throw error;
    }
  }
}
