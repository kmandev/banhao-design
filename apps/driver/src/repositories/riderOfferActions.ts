/**
 * API-backed offer actions repository — `POST /api/v1/rider/offers/:id/accept`
 * and `POST /api/v1/rider/offers/:id/decline` (Phase G-2 / G-6.2), given their
 * first client.
 *
 * Distinct from `riderOfferInbox.ts` on purpose: that repository is a direct
 * Supabase **read** under RLS (DEC-APP-008); these are **writes**, and
 * DEC-APP-008 puts every write through the API. Same read/write split
 * `riderAvailability.ts` (Supabase write, the documented exception) and
 * `apiRiderLocation.ts` (API write) already draw for the availability
 * surface — this file is the offer surface's `apiRiderLocation.ts`.
 *
 * Both endpoints already exist and are unmodified by this file
 * (`OfferAcceptanceService`). This module only translates: it re-implements
 * none of the server's ownership, liveness, or race-condition rules, and it
 * never writes `rider_assignment_attempts` directly.
 *
 * Errors are deliberately **not** wrapped into an opaque message the way
 * `apiRiderLocation.ts` wraps into `LocationReportFailedError`: callers here
 * need to branch on `ApiClientError.code` (`OFFER_TAKEN`, `OFFER_EXPIRED`,
 * `RIDER_HAS_ACTIVE_DELIVERY`, `NOT_FOUND`, `FORBIDDEN`), so the error is left
 * for the caller to inspect rather than collapsed into one string.
 */

import type { ApiClient } from '@banhao/api-client';
import type { RiderOfferAcceptResponse, RiderOfferDeclineResponse } from '@banhao/validation';
import { apiClient as defaultClient, getAccessToken as defaultGetAccessToken } from '../lib/apiClient';
// Reused rather than redeclared — `apiRiderLocation.ts`'s own
// `NotAuthenticatedError` already names exactly this condition ("there is no
// session, so the request is not sent at all") with the same message, and
// `repositories/index.ts` re-exports both files' members, so a second class
// of the same name would collide there.
import { NotAuthenticatedError } from './apiRiderLocation';

export interface RiderOfferActionsRepository {
  /** `POST /api/v1/rider/offers/:id/accept` — DEC-020's "first valid acceptance wins." */
  acceptOffer(offerId: string): Promise<RiderOfferAcceptResponse>;
  /** `POST /api/v1/rider/offers/:id/decline` — a single-row transition, Phase G-6.2. */
  declineOffer(offerId: string): Promise<RiderOfferDeclineResponse>;
}

export function createRiderOfferActionsRepository(
  client: ApiClient = defaultClient,
  getAccessToken: () => Promise<string | null> = defaultGetAccessToken,
): RiderOfferActionsRepository {
  return {
    async acceptOffer(offerId: string): Promise<RiderOfferAcceptResponse> {
      const token = await getAccessToken();
      if (!token) throw new NotAuthenticatedError();

      return client.request<RiderOfferAcceptResponse>(`/api/v1/rider/offers/${offerId}/accept`, {
        method: 'POST',
      });
    },

    async declineOffer(offerId: string): Promise<RiderOfferDeclineResponse> {
      const token = await getAccessToken();
      if (!token) throw new NotAuthenticatedError();

      return client.request<RiderOfferDeclineResponse>(`/api/v1/rider/offers/${offerId}/decline`, {
        method: 'POST',
      });
    },
  };
}
