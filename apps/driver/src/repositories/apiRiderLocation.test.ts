import { createApiClient } from '@banhao/api-client';
import {
  LocationReportFailedError,
  NotAuthenticatedError,
  createApiRiderLocationRepository,
} from './apiRiderLocation';

/**
 * `POST /api/v1/rider/location` — Phase G-2's endpoint, given its first client.
 *
 * The server's `riderLocationRequestSchema` is `.strict()` precisely so a
 * client cannot smuggle an identity into a body whose rider is resolved from
 * the verified JWT (DEC-033 / DEC-APP-004). These tests assert this side of
 * that contract: two fields on the wire, an identity that travels only as a
 * bearer token, and nothing sent at all when there is no token to send.
 */

const OK_BODY = { success: true, data: { riderId: 'rider-1', locationUpdatedAt: '2026-08-25T05:00:00Z' } };

interface Captured {
  url: string;
  init: RequestInit;
}

function clientWith(
  response: { status: number; body: unknown },
  captured: Captured[] = [],
) {
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    captured.push({ url, init });
    return {
      status: response.status,
      json: async () => response.body,
    } as unknown as Response;
  }) as unknown as typeof fetch;

  return { fetchImpl, captured };
}

function subjectWith(
  response: { status: number; body: unknown },
  token: string | null = 'access-token-abc',
) {
  const captured: Captured[] = [];
  const { fetchImpl } = clientWith(response, captured);

  const api = createApiClient({
    baseUrl: 'https://api.test',
    getAccessToken: () => token,
    fetch: fetchImpl,
  });

  return {
    subject: createApiRiderLocationRepository(api, async () => token),
    captured,
  };
}

function bodyOf(captured: Captured[]): Record<string, unknown> {
  return JSON.parse(String(captured[0]?.init.body)) as Record<string, unknown>;
}

describe('reportPosition — the request', () => {
  it('POSTs to /api/v1/rider/location', async () => {
    const { subject, captured } = subjectWith({ status: 200, body: OK_BODY });

    await subject.reportPosition({ lat: 14.78, lng: 105.32 });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe('https://api.test/api/v1/rider/location');
    expect(captured[0]?.init.method).toBe('POST');
  });

  it('sends exactly { lat, lng } — no more, no fewer', async () => {
    const { subject, captured } = subjectWith({ status: 200, body: OK_BODY });

    await subject.reportPosition({ lat: 14.78, lng: 105.32 });

    expect(bodyOf(captured)).toEqual({ lat: 14.78, lng: 105.32 });
    expect(Object.keys(bodyOf(captured))).toEqual(['lat', 'lng']);
  });

  it('never puts a rider identity in the body', async () => {
    const { subject, captured } = subjectWith({ status: 200, body: OK_BODY });

    // A caller that has attached extra fields must not have them forwarded.
    const contaminated = {
      lat: 14.78,
      lng: 105.32,
      riderId: 'rider-1',
      userId: 'user-1',
      is_online: true,
      active_delivery_count: 0,
      blocked_reason: null,
      last_lat: 1,
      last_lng: 2,
    } as unknown as { lat: number; lng: number };

    await subject.reportPosition(contaminated);

    const body = bodyOf(captured);
    expect(body).toEqual({ lat: 14.78, lng: 105.32 });
    for (const forbidden of [
      'riderId',
      'userId',
      'rider_id',
      'user_id',
      'is_online',
      'active_delivery_count',
      'blocked_reason',
      'last_lat',
      'last_lng',
    ]) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });

  it('sends the access token as a bearer header — the only identity on the wire', async () => {
    const { subject, captured } = subjectWith({ status: 200, body: OK_BODY });

    await subject.reportPosition({ lat: 14.78, lng: 105.32 });

    const headers = new Headers(captured[0]?.init.headers);
    expect(headers.get('Authorization')).toBe('Bearer access-token-abc');
  });
});

describe('reportPosition — signed out', () => {
  it('makes no request at all when there is no session', async () => {
    const { subject, captured } = subjectWith({ status: 200, body: OK_BODY }, null);

    await expect(subject.reportPosition({ lat: 14.78, lng: 105.32 })).rejects.toBeInstanceOf(
      NotAuthenticatedError,
    );

    // The coordinates never left the device.
    expect(captured).toHaveLength(0);
  });
});

describe('reportPosition — results and failures', () => {
  it('resolves with the server-reported locationUpdatedAt', async () => {
    const { subject } = subjectWith({ status: 200, body: OK_BODY });

    await expect(subject.reportPosition({ lat: 14.78, lng: 105.32 })).resolves.toEqual({
      riderId: 'rider-1',
      locationUpdatedAt: '2026-08-25T05:00:00Z',
    });
  });

  it('surfaces an API error as a retryable failure, never as a silent success', async () => {
    const { subject } = subjectWith({
      status: 403,
      body: { success: false, error: { code: 'FORBIDDEN', message: 'Not an approved rider' } },
    });

    await expect(subject.reportPosition({ lat: 14.78, lng: 105.32 })).rejects.toBeInstanceOf(
      LocationReportFailedError,
    );
  });

  it('surfaces a transport failure the same way', async () => {
    const failingFetch = (async () => {
      throw new Error('Network request failed');
    }) as unknown as typeof fetch;

    const api = createApiClient({
      baseUrl: 'https://api.test',
      getAccessToken: () => 'access-token-abc',
      fetch: failingFetch,
    });
    const subject = createApiRiderLocationRepository(api, async () => 'access-token-abc');

    await expect(subject.reportPosition({ lat: 14.78, lng: 105.32 })).rejects.toBeInstanceOf(
      LocationReportFailedError,
    );
  });
});
