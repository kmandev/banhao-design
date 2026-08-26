import { createApiClient, ApiClientError } from '@banhao/api-client';
import { createRiderOfferActionsRepository } from './riderOfferActions';
// Shared with `apiRiderLocation.ts` — see `riderOfferActions.ts`'s own note
// on why this class isn't redeclared or re-exported a second time.
import { NotAuthenticatedError } from './apiRiderLocation';

/**
 * `POST /api/v1/rider/offers/:id/accept` and `.../decline` — Phase G-2 /
 * G-6.2's endpoints, given their first client (G-7.1).
 *
 * Same discipline `apiRiderLocation.test.ts` establishes for the location
 * endpoint: assert the exact request shape, that no request is sent without a
 * session, and — the part specific to this surface — that a 409's `code` is
 * exactly what a caller can branch on rather than being swallowed into a
 * generic message.
 */

const ACCEPT_OK = {
  success: true,
  data: { deliveryId: 'delivery-1', state: 'RIDER_ASSIGNED', riderId: 'rider-1' },
};

const DECLINE_OK = {
  success: true,
  data: { offerId: 'attempt-1', riderId: 'rider-1', outcome: 'DECLINED' },
};

interface Captured {
  url: string;
  init: RequestInit;
}

function subjectWith(response: { status: number; body: unknown }, token: string | null = 'access-token-abc') {
  const captured: Captured[] = [];

  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    captured.push({ url, init });
    return {
      status: response.status,
      json: async () => response.body,
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const api = createApiClient({ baseUrl: 'https://api.test', getAccessToken: () => token, fetch: fetchImpl });

  return {
    subject: createRiderOfferActionsRepository(api, async () => token),
    captured,
  };
}

describe('acceptOffer — the request', () => {
  it('POSTs to /api/v1/rider/offers/:id/accept with no body', async () => {
    const { subject, captured } = subjectWith({ status: 200, body: ACCEPT_OK });

    await subject.acceptOffer('attempt-1');

    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe('https://api.test/api/v1/rider/offers/attempt-1/accept');
    expect(captured[0]?.init.method).toBe('POST');
    expect(captured[0]?.init.body).toBeUndefined();
  });

  it('sends the access token as a bearer header', async () => {
    const { subject, captured } = subjectWith({ status: 200, body: ACCEPT_OK });

    await subject.acceptOffer('attempt-1');

    const headers = new Headers(captured[0]?.init.headers);
    expect(headers.get('Authorization')).toBe('Bearer access-token-abc');
  });

  it('resolves with the server-reported delivery assignment', async () => {
    const { subject } = subjectWith({ status: 200, body: ACCEPT_OK });

    await expect(subject.acceptOffer('attempt-1')).resolves.toEqual({
      deliveryId: 'delivery-1',
      state: 'RIDER_ASSIGNED',
      riderId: 'rider-1',
    });
  });

  it('makes no request at all when there is no session', async () => {
    const { subject, captured } = subjectWith({ status: 200, body: ACCEPT_OK }, null);

    await expect(subject.acceptOffer('attempt-1')).rejects.toBeInstanceOf(NotAuthenticatedError);
    expect(captured).toHaveLength(0);
  });
});

describe('acceptOffer — failures surface as a branchable code, never a swallowed message', () => {
  it.each([
    ['OFFER_TAKEN', 409],
    ['OFFER_EXPIRED', 409],
    ['RIDER_HAS_ACTIVE_DELIVERY', 409],
    ['NOT_FOUND', 404],
    ['FORBIDDEN', 403],
  ])('rejects with an ApiClientError carrying code %s for a %i response', async (code, status) => {
    const { subject } = subjectWith({
      status,
      body: { success: false, error: { code, message: 'server message' } },
    });

    const error = await subject.acceptOffer('attempt-1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe(code);
    expect((error as ApiClientError).status).toBe(status);
  });
});

describe('declineOffer — the request', () => {
  it('POSTs to /api/v1/rider/offers/:id/decline with no body', async () => {
    const { subject, captured } = subjectWith({ status: 200, body: DECLINE_OK });

    await subject.declineOffer('attempt-1');

    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe('https://api.test/api/v1/rider/offers/attempt-1/decline');
    expect(captured[0]?.init.method).toBe('POST');
    expect(captured[0]?.init.body).toBeUndefined();
  });

  it('resolves with the server-reported decline outcome', async () => {
    const { subject } = subjectWith({ status: 200, body: DECLINE_OK });

    await expect(subject.declineOffer('attempt-1')).resolves.toEqual({
      offerId: 'attempt-1',
      riderId: 'rider-1',
      outcome: 'DECLINED',
    });
  });

  it('makes no request at all when there is no session', async () => {
    const { subject, captured } = subjectWith({ status: 200, body: DECLINE_OK }, null);

    await expect(subject.declineOffer('attempt-1')).rejects.toBeInstanceOf(NotAuthenticatedError);
    expect(captured).toHaveLength(0);
  });
});

describe('declineOffer — failures surface as a branchable code', () => {
  it.each([
    ['OFFER_TAKEN', 409],
    ['OFFER_EXPIRED', 409],
    ['NOT_FOUND', 404],
    ['FORBIDDEN', 403],
  ])('rejects with an ApiClientError carrying code %s for a %i response', async (code, status) => {
    const { subject } = subjectWith({
      status,
      body: { success: false, error: { code, message: 'server message' } },
    });

    const error = await subject.declineOffer('attempt-1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe(code);
  });
});
