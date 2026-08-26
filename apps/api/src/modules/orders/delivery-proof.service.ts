import { Injectable, Logger } from '@nestjs/common';
import type { DeliveryProofResponse } from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';
import { StorageService } from '../storage/storage.service';
import { POD_RETENTION_DAYS } from '../rider/pod-retention-policy';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `deliveries`, the three columns this read needs — never `rider_id` or `rider_earning_satang` (POD-C-06). */
interface DeliveryProofRow {
  delivered_at: string | null;
  proof_photo_path: string | null;
}

/**
 * `GET /api/v1/orders/:id/delivery-proof` — POD, Plan §8.3, resolving the one
 * gap DEC-039 explicitly left open ("the customer read endpoint … is
 * explicitly a separate task").
 *
 * Deliberately **not** a direct client read of `deliveries` through
 * `deliveries_select_customer` (POD-C-06): that policy is table-wide and
 * would hand the client `rider_id` and `rider_earning_satang` to obtain one
 * nullable text column. This service selects only `delivered_at` and
 * `proof_photo_path`, resolves the order's ownership itself, and returns a
 * signed URL minted per request — never the raw key, never a public URL.
 *
 * ## Foreign-order privacy
 *
 * A caller who is not the order's own customer gets the same `NOT_FOUND` a
 * missing order id would produce (`OrdersService.customerCancel`'s own
 * pattern) — the order's existence, its delivery's existence, and whether a
 * proof photo exists are all folded into one indistinguishable response.
 *
 * ## Retention
 *
 * `POD_RETENTION_DAYS` (DEC-039, 90 days from `delivered_at`) is checked
 * against the row this service already read, **before** a signed URL is
 * minted — not a substitute for `ProofPhotoRetentionService`'s own purge (the
 * object may still exist in R2 between ticks), but a second, independent
 * refusal so this endpoint never hands out a link to a photo past its
 * approved retention window even if the purge tick has not run yet.
 */
@Injectable()
export class DeliveryProofService {
  private readonly logger = new Logger(DeliveryProofService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly storage: StorageService,
  ) {}

  async getProof(user: AuthenticatedUser, orderId: string): Promise<DeliveryProofResponse | null> {
    await this.assertOwnOrder(orderId, user.id);

    const delivery = await this.readDelivery(orderId);
    if (!delivery || !delivery.proof_photo_path || !delivery.delivered_at) {
      return null;
    }

    if (this.isPastRetention(delivery.delivered_at)) {
      return null;
    }

    const exists = await this.storage.exists(delivery.proof_photo_path, 'private');
    if (!exists) {
      return null;
    }

    const photoUrl = await this.storage.getSignedDownloadUrl(delivery.proof_photo_path);

    return {
      photoUrl,
      // Same instant, same column — see the class doc.
      capturedAt: delivery.delivered_at,
      deliveredAt: delivery.delivered_at,
    };
  }

  /**
   * A missing order and one belonging to another customer produce the
   * **same** error — the caller must not learn whether a given id names a
   * real order. Mirrors `OrdersService.customerCancel`'s `NOT_FOUND`.
   */
  private async assertOwnOrder(orderId: string, customerId: string): Promise<void> {
    const { data, error } = await this.supabase.admin
      .from('orders')
      .select('id')
      .eq('id', orderId)
      .eq('customer_id', customerId)
      .maybeSingle<{ id: string }>();

    if (error) {
      this.logger.error(`Order lookup failed for delivery-proof read ${orderId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Order lookup failed' });
    }

    if (!data) {
      throw new DomainError('NOT_FOUND', { message: 'Order not found' });
    }
  }

  private async readDelivery(orderId: string): Promise<DeliveryProofRow | null> {
    const { data, error } = await this.supabase.admin
      .from('deliveries')
      .select('delivered_at, proof_photo_path')
      .eq('order_id', orderId)
      .maybeSingle<DeliveryProofRow>();

    if (error) {
      this.logger.error(`Delivery lookup failed for delivery-proof read ${orderId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Delivery lookup failed' });
    }

    return data;
  }

  private isPastRetention(deliveredAt: string): boolean {
    const deliveredAtMs = new Date(deliveredAt).getTime();
    return Date.now() - deliveredAtMs >= POD_RETENTION_DAYS * MS_PER_DAY;
  }
}
