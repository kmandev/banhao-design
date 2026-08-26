import {
  createRiderProofUploadRepository,
  ProofUploadFailedError,
} from './riderProofUpload';
import type { ApiClient } from '@banhao/api-client';

/**
 * Proof upload repository — POD, Phase G-7.2 Phase 2.
 *
 * The security-relevant assertions here are about what is **absent** from the
 * PUT: no Authorization header, no R2 credential, no key the client built
 * itself. The presigned URL is the entire authorization, which is what keeps
 * every R2 secret server-side.
 */

const DELIVERY_ID = '11111111-1111-4111-8111-111111111111';
const OBJECT_KEY = `deliveries/${DELIVERY_ID}/proof/22222222-2222-4222-8222-222222222222.jpg`;
const UPLOAD_URL = 'https://acct.r2.cloudflarestorage.com/banhao-private/x?X-Amz-Signature=abc';

function apiStub(response: unknown = { uploadUrl: UPLOAD_URL, objectKey: OBJECT_KEY }) {
  const request = jest.fn(async (_path: string, _init?: unknown) => response);
  return { client: { request } as unknown as ApiClient, request };
}

/**
 * A `fetch` double that answers a `file://` read with a blob and a PUT with a
 * status. Records every call so the request shape can be asserted.
 */
function fetchStub(putStatus = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];

  const impl = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });

    if (String(url).startsWith('file://')) {
      return { ok: true, blob: async () => ({ size: 1234 }) } as unknown as Response;
    }

    return { ok: putStatus >= 200 && putStatus < 300, status: putStatus } as Response;
  });

  return { impl: impl as unknown as typeof fetch, calls, mock: impl };
}

describe('RiderProofUploadRepository — requesting authorization', () => {
  it('POSTs to the delivery’s own presign route with only the content type', async () => {
    const { client, request } = apiStub();
    const repo = createRiderProofUploadRepository(client, async () => 'token');

    await repo.requestUploadUrl(DELIVERY_ID, 'image/jpeg');

    expect(request).toHaveBeenCalledWith(
      `/api/v1/rider/deliveries/${DELIVERY_ID}/proof/upload-url`,
      { method: 'POST', body: JSON.stringify({ contentType: 'image/jpeg' }) },
    );
  });

  it('never sends an object key — the server templates it', async () => {
    const { client, request } = apiStub();
    const repo = createRiderProofUploadRepository(client, async () => 'token');

    await repo.requestUploadUrl(DELIVERY_ID, 'image/jpeg');

    // A client-supplied key is what would let Rider A upload to Rider B's
    // delivery; there is simply no field for one.
    expect(String(request.mock.calls[0]?.[1] ?? '')).not.toMatch(/objectKey|key|bucket/i);
  });

  it('sends no request at all when signed out', async () => {
    const { client, request } = apiStub();
    const repo = createRiderProofUploadRepository(client, async () => null);

    await expect(repo.requestUploadUrl(DELIVERY_ID, 'image/jpeg')).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});

describe('RiderProofUploadRepository — uploading to R2', () => {
  it('PUTs the bytes with the signed content type and NO credential of any kind', async () => {
    const { client } = apiStub();
    const fetcher = fetchStub();
    const repo = createRiderProofUploadRepository(client, async () => 'token', fetcher.impl);

    await repo.uploadToSignedUrl(UPLOAD_URL, 'file:///tmp/proof.jpg', 'image/jpeg');

    const put = fetcher.calls.find((call) => call.init?.method === 'PUT');
    expect(put?.url).toBe(UPLOAD_URL);
    expect(put?.init?.headers).toEqual({ 'Content-Type': 'image/jpeg' });

    // The presigned URL IS the authorization. An Authorization header here
    // would be both useless and a credential leak.
    const headers = (put?.init?.headers ?? {}) as Record<string, string>;
    expect(Object.keys(headers)).toEqual(['Content-Type']);
    expect(JSON.stringify(headers)).not.toMatch(/bearer|authorization|aws|secret/i);
  });

  it('reads the local file before uploading it', async () => {
    const { client } = apiStub();
    const fetcher = fetchStub();
    const repo = createRiderProofUploadRepository(client, async () => 'token', fetcher.impl);

    await repo.uploadToSignedUrl(UPLOAD_URL, 'file:///tmp/proof.jpg', 'image/jpeg');

    expect(fetcher.calls[0]?.url).toBe('file:///tmp/proof.jpg');
    expect(fetcher.calls[1]?.init?.method).toBe('PUT');
  });

  it('reports a 403 as an EXPIRED authorization, so the caller re-presigns', async () => {
    const { client } = apiStub();
    const fetcher = fetchStub(403);
    const repo = createRiderProofUploadRepository(client, async () => 'token', fetcher.impl);

    const error = await repo
      .uploadToSignedUrl(UPLOAD_URL, 'file:///tmp/proof.jpg', 'image/jpeg')
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ProofUploadFailedError);
    // Retrying the same PUT could only fail again.
    expect((error as ProofUploadFailedError).isExpiredAuthorization).toBe(true);
  });

  it('reports a 500 as a plain failure, not an expired authorization', async () => {
    const { client } = apiStub();
    const fetcher = fetchStub(500);
    const repo = createRiderProofUploadRepository(client, async () => 'token', fetcher.impl);

    const error = await repo
      .uploadToSignedUrl(UPLOAD_URL, 'file:///tmp/proof.jpg', 'image/jpeg')
      .catch((cause: unknown) => cause);

    expect((error as ProofUploadFailedError).isExpiredAuthorization).toBe(false);
    expect((error as ProofUploadFailedError).status).toBe(500);
  });

  it('reports a network failure as an upload failure, never as a success', async () => {
    const { client } = apiStub();
    const impl = jest.fn(async (url: string) => {
      if (String(url).startsWith('file://')) {
        return { ok: true, blob: async () => ({ size: 10 }) } as unknown as Response;
      }
      throw new Error('Network request failed');
    });
    const repo = createRiderProofUploadRepository(
      client,
      async () => 'token',
      impl as unknown as typeof fetch,
    );

    await expect(
      repo.uploadToSignedUrl(UPLOAD_URL, 'file:///tmp/proof.jpg', 'image/jpeg'),
    ).rejects.toBeInstanceOf(ProofUploadFailedError);
  });

  it('reports an unreadable local file as an upload failure', async () => {
    const { client } = apiStub();
    const impl = jest.fn(async () => {
      throw new Error('ENOENT');
    });
    const repo = createRiderProofUploadRepository(
      client,
      async () => 'token',
      impl as unknown as typeof fetch,
    );

    await expect(
      repo.uploadToSignedUrl(UPLOAD_URL, 'file:///tmp/proof.jpg', 'image/jpeg'),
    ).rejects.toBeInstanceOf(ProofUploadFailedError);
  });
});
