import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';
import { hasMerchantAccess, type ActorCapabilities } from '../../common/types';
import { StorageService } from '../storage/storage.service';
import {
  InvalidObjectKeyInputError,
  menuItemImageObjectKey,
  parseMenuItemImageObjectKey,
} from '../storage/object-key';

interface MenuItemRow {
  id: string;
  restaurant_id: string;
}

/**
 * Menu item image upload — M-12, extending M-11's pattern to an entity whose
 * route has no `restaurantId` of its own.
 *
 * ## Authorization — why this service checks membership itself
 *
 * M-11's routes are nested under `restaurants/:restaurantId/...`, so
 * `@RestaurantScope()` (reading `restaurantId` straight from the path) is
 * sufficient on its own. M-12's routes are `menu-items/:menuItemId/...` —
 * there is no `restaurantId` in the URL at all, and `@RestaurantScope()`
 * denies unconditionally when its route parameter is missing (see
 * `RestaurantScopeGuard`), so it genuinely cannot be applied here. Neither
 * route below carries the decorator, and that is deliberate, not an
 * oversight — applying it would make every request fail, including
 * legitimate ones.
 *
 * What replaces it is not a new authorization model: `resolveRestaurantId`
 * calls `hasMerchantAccess`, the exact same function `RestaurantScopeGuard`
 * itself calls, at the point in the request where the answer to "which
 * restaurant does this resource belong to" actually becomes known — after
 * reading `menu_items.restaurant_id`. `@Roles('MERCHANT')` and
 * `SupabaseAuthGuard` still run unmodified as global guards; only the
 * *resource-level* check moves from a decorator to an explicit call, because
 * this resource's ownership isn't visible in its own URL.
 *
 * `capabilities` arrives as a plain argument (from `@CurrentUser()` in the
 * controller) rather than being re-resolved here, matching how M-11 trusts
 * its guard-verified `restaurantId` argument.
 */
@Injectable()
export class MenuItemImageService {
  private readonly logger = new Logger(MenuItemImageService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly supabase: SupabaseService,
  ) {}

  async requestUploadUrl(
    menuItemId: string,
    contentType: string,
    capabilities: ActorCapabilities,
  ): Promise<{ uploadUrl: string; objectKey: string }> {
    await this.resolveAuthorizedRestaurantId(menuItemId, capabilities);

    const objectKey = this.buildObjectKey(menuItemId, contentType, 'contentType');
    const uploadUrl = await this.storage.getSignedUploadUrl(objectKey, contentType);

    return { uploadUrl, objectKey };
  }

  /**
   * Step 2 — verifies the upload really happened, then persists the object
   * key (never a full URL) to `menu_items.image_url`.
   *
   * ## Why this can't recompute-and-compare the way M-11 does
   *
   * A restaurant cover key is fully deterministic — `restaurantId` + MIME
   * type is the *entire* key, so `completeUpload` can rebuild the exact
   * expected string and demand equality. A menu item image key also contains
   * a server-generated random UUID (`menuItemImageObjectKey`), which nothing
   * observable at complete-time can reproduce — recompute-and-compare is not
   * an available check here, by construction, not by oversight.
   *
   * What replaces it: `parseMenuItemImageObjectKey` proves the submitted key
   * is *exactly* the documented shape for *this* authorized `menuItemId` —
   * literal prefix, matching id, a syntactically valid UUID, an allow-listed
   * extension, nothing else appended (see that function's own comment for the
   * full shape it rejects). A key that passes parsing could only have come
   * from `menuItemImageObjectKey` itself for a genuine `menuItemId`, or from
   * a 122-bit guess. That alone is still not treated as proof of upload —
   * `StorageService.exists()` must independently confirm real bytes are
   * actually at that key before anything is written, exactly mirroring M-11's
   * "existence is the real proof" model. Structural validity narrows what
   * *shape* of key can matter; existence proves it was actually *used*.
   * Together they replace the single equality check M-11 relies on, with no
   * new persistence (no upload-session table) on either side.
   *
   * Naturally idempotent for the same reason M-11's `completeUpload` is:
   * calling this twice with the same, still-existing `objectKey` performs the
   * same `UPDATE ... SET image_url = X` both times.
   */
  async completeUpload(
    menuItemId: string,
    objectKey: string,
    capabilities: ActorCapabilities,
  ): Promise<{ imageUrl: string }> {
    await this.resolveAuthorizedRestaurantId(menuItemId, capabilities);

    const parsed = parseMenuItemImageObjectKey(objectKey, menuItemId);
    if (!parsed) {
      // Deliberately generic: reached by an arbitrary key, a path-traversal
      // attempt, a cross-menu-item key, or an unsupported extension alike —
      // none of those deserve a more specific answer than "not a valid key
      // for this item".
      throw new DomainError('VALIDATION_FAILED', {
        message: 'objectKey is not a valid image key for this menu item',
        details: { objectKey: ['does not match the expected key shape for this menu item'] },
      });
    }

    const uploaded = await this.storage.exists(objectKey);
    if (!uploaded) {
      throw new DomainError('NOT_FOUND', {
        message: 'No object was found at the expected key — upload it before completing',
      });
    }

    // Known, accepted orphan behaviour, identical to M-11's: a format
    // replacement (e.g. {uuid1}.jpg -> {uuid2}.webp) overwrites `image_url`
    // and leaves the previous object in R2, unreferenced. A same-uuid
    // re-upload has no orphan — the key is identical and R2 overwrites in
    // place. See `RestaurantCoverService.completeUpload` for the full
    // reasoning; this is preserved for consistency, not reconsidered here.
    const { data, error } = await this.supabase.admin
      .from('menu_items')
      .update({ image_url: objectKey })
      .eq('id', menuItemId)
      .select('id, image_url')
      .maybeSingle<{ id: string; image_url: string }>();

    if (error) {
      this.logger.error(`Menu item image update failed for ${menuItemId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Menu item image update failed' });
    }

    // Structurally shouldn't happen — `resolveAuthorizedRestaurantId` above
    // already proved the row exists moments earlier. Kept as a defensive
    // fallback for the theoretical race of a concurrent delete.
    if (!data) {
      throw new DomainError('NOT_FOUND', { message: 'Menu item not found' });
    }

    // Unlike M-11 (whose `imageUrl` field returns the bare object key), M-12's
    // own spec calls for the resolved public URL here — see this module's
    // README-equivalent note in the controller for why the two differ.
    return { imageUrl: this.storage.getPublicUrl(data.image_url) };
  }

  /**
   * Resolves `menuItemId` to its owning restaurant and proves `capabilities`
   * includes membership there — the resource-level check `@RestaurantScope()`
   * performs for M-11, done manually here for the reason explained above.
   *
   * A missing menu item and an existing one the caller isn't authorized for
   * produce the **same** error, deliberately: this must not let a merchant
   * learn whether a given id names someone else's real menu item.
   */
  private async resolveAuthorizedRestaurantId(
    menuItemId: string,
    capabilities: ActorCapabilities,
  ): Promise<string> {
    const { data, error } = await this.supabase.admin
      .from('menu_items')
      .select('id, restaurant_id')
      .eq('id', menuItemId)
      .maybeSingle<MenuItemRow>();

    if (error) {
      this.logger.error(`Menu item lookup failed for ${menuItemId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Menu item lookup failed' });
    }

    if (!data || !hasMerchantAccess(capabilities, data.restaurant_id)) {
      throw new DomainError('NOT_RESTAURANT_MEMBER');
    }

    return data.restaurant_id;
  }

  /** Wraps `menuItemImageObjectKey`, translating its error into the API's own contract. */
  private buildObjectKey(menuItemId: string, mimeType: string, field: string): string {
    try {
      return menuItemImageObjectKey(menuItemId, mimeType);
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
