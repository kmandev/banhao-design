/**
 * Proof photo upload repository — POD, Phase G-7.2 Phase 2.
 *
 * Two steps, and the split matters:
 *
 * 1. **`requestUploadUrl`** — `POST /api/v1/rider/deliveries/:id/proof/upload-url`
 *    through the API, like every other write. The server authorizes the
 *    caller, templates the object key, and returns a presigned `PUT`.
 * 2. **`uploadToSignedUrl`** — a bare `PUT` of the image bytes straight to
 *    Cloudflare R2. **No Authorization header, no credential of any kind.**
 *    The presigned URL *is* the authorization: one object, one operation, one
 *    content type, five minutes. This is why no R2 secret exists anywhere in
 *    this app and why the image bytes never transit Cloud Run.
 *
 * There is deliberately no third `complete` call. `MenuItemImageService` and
 * `RestaurantCoverService` each pair a presign with their own `complete`
 * endpoint; POD's completion **is** the delivered command, which persists the
 * key in the same guarded UPDATE that moves the delivery to `DELIVERED`. See
 * `DeliveryProofService` for why folding them removes two bad states.
 *
 * The object key is never constructed here and never modified — it is echoed
 * back to the delivered command exactly as the server returned it, and the
 * server re-parses it against the delivery it authorized rather than trusting
 * the round trip.
 */

import type { ApiClient } from '@banhao/api-client';
import type { RiderProofUploadUrlResponse } from '@banhao/validation';
import { apiClient as defaultClient, getAccessToken as defaultGetAccessToken } from '../lib/apiClient';
// Reused rather than redeclared — see `riderOfferActions.ts` for why.
import { NotAuthenticatedError } from './apiRiderLocation';

/**
 * A `PUT` to R2 that did not return 2xx.
 *
 * Carries the status so the caller can tell an expired presign (403 — R2's
 * answer to a lapsed signature) from a transport failure, without parsing a
 * provider-specific XML body.
 */
export class ProofUploadFailedError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ProofUploadFailedError';
    this.status = status;
  }

  /**
   * Whether the presigned URL is no longer usable and a fresh one must be
   * requested. R2 answers a lapsed or malformed signature with 403.
   */
  get isExpiredAuthorization(): boolean {
    return this.status === 403;
  }
}

export interface RiderProofUploadRepository {
  /** Step 1 — authorize, and receive a server-templated key. */
  requestUploadUrl(deliveryId: string, contentType: string): Promise<RiderProofUploadUrlResponse>;
  /** Step 2 — PUT the bytes straight to R2 using only the presigned URL. */
  uploadToSignedUrl(uploadUrl: string, fileUri: string, contentType: string): Promise<void>;
}

export function createRiderProofUploadRepository(
  client: ApiClient = defaultClient,
  getAccessToken: () => Promise<string | null> = defaultGetAccessToken,
  fetchImpl: typeof fetch = fetch,
): RiderProofUploadRepository {
  return {
    async requestUploadUrl(deliveryId, contentType) {
      const token = await getAccessToken();
      if (!token) throw new NotAuthenticatedError();

      return client.request<RiderProofUploadUrlResponse>(
        `/api/v1/rider/deliveries/${deliveryId}/proof/upload-url`,
        { method: 'POST', body: JSON.stringify({ contentType }) },
      );
    },

    async uploadToSignedUrl(uploadUrl, fileUri, contentType) {
      // The local file, read as a blob. React Native's networking stack
      // supports `fetch` against a `file://` URI, so this needs no filesystem
      // dependency.
      let body: Blob;
      try {
        const file = await fetchImpl(fileUri);
        body = await file.blob();
      } catch (cause) {
        throw new ProofUploadFailedError(
          cause instanceof Error ? cause.message : 'อ่านไฟล์รูปไม่สำเร็จ',
        );
      }

      let response: Response;
      try {
        response = await fetchImpl(uploadUrl, {
          method: 'PUT',
          // `Content-Type` must match the type the URL was signed for exactly,
          // or R2 rejects the signature. No Authorization header — adding one
          // would be both useless and a credential leak.
          headers: { 'Content-Type': contentType },
          body,
        });
      } catch (cause) {
        // A network failure, a timeout, or a dropped connection at the door.
        throw new ProofUploadFailedError(
          cause instanceof Error ? cause.message : 'อัปโหลดรูปไม่สำเร็จ',
        );
      }

      if (!response.ok) {
        throw new ProofUploadFailedError(
          `Proof upload rejected with ${response.status}`,
          response.status,
        );
      }
    },
  };
}
