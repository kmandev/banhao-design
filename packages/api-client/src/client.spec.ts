import { ApiClient, ApiClientError } from './client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ApiClient', () => {
  it('unwraps a successful envelope and returns data', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: { status: 'ok' } }));

    const client = new ApiClient({ baseUrl: 'http://api.test', fetch: fetchMock });

    await expect(client.health()).resolves.toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/health', expect.anything());
  });

  it('attaches a bearer token when one is available', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: { id: 'u1', role: 'CUSTOMER' } }));

    const client = new ApiClient({
      baseUrl: 'http://api.test',
      getAccessToken: () => 'token-123',
      fetch: fetchMock,
    });

    await client.me();

    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer token-123');
  });

  it('omits the Authorization header when signed out', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: { status: 'ok' } }));

    const client = new ApiClient({
      baseUrl: 'http://api.test',
      getAccessToken: () => null,
      fetch: fetchMock,
    });

    await client.health();

    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.has('Authorization')).toBe(false);
  });

  it('throws ApiClientError carrying the server error code', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Missing token' } },
        401,
      ),
    );

    const client = new ApiClient({ baseUrl: 'http://api.test', fetch: fetchMock });

    await expect(client.me()).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 401,
      code: 'UNAUTHORIZED',
    });
  });

  it('throws a useful error when the response is not JSON', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response('<html>502</html>', { status: 502 }));

    const client = new ApiClient({ baseUrl: 'http://api.test', fetch: fetchMock });

    await expect(client.health()).rejects.toBeInstanceOf(ApiClientError);
  });

  // --- canonical error contract (V1.1 §6, §10) --------------------------------
  //
  // These assert the machine-readable STRUCTURE. They deliberately never assert
  // on user-facing prose: `code` is the contract, and copy belongs to clients.

  it('accepts an error carrying only a code — message is not required', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ success: false, error: { code: 'OFFER_TAKEN' } }, 409));

    const client = new ApiClient({ baseUrl: 'http://api.test', fetch: fetchMock });

    await expect(client.me()).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 409,
      code: 'OFFER_TAKEN',
    });
  });

  it('falls back to the code for Error.message when the server sends none', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ success: false, error: { code: 'NOT_RELEASABLE' } }, 409));

    const client = new ApiClient({ baseUrl: 'http://api.test', fetch: fetchMock });

    // Developer-facing only — a client renders copy resolved from `code`.
    await expect(client.me()).rejects.toThrow('NOT_RELEASABLE');
  });

  it('surfaces structured non-validation details', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: { code: 'NOT_RELEASABLE', details: { deliveryId: 'd-42', attempt: 2 } },
        },
        409,
      ),
    );

    const client = new ApiClient({ baseUrl: 'http://api.test', fetch: fetchMock });

    await expect(client.me()).rejects.toMatchObject({
      code: 'NOT_RELEASABLE',
      details: { deliveryId: 'd-42', attempt: 2 },
    });
  });

  it('surfaces field-level validation details', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: { code: 'VALIDATION_FAILED', details: { phone: ['required'] } },
        },
        400,
      ),
    );

    const client = new ApiClient({ baseUrl: 'http://api.test', fetch: fetchMock });

    await expect(client.me()).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { phone: ['required'] },
    });
  });

  it('surfaces the correlation id when the API sends one', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse(
        { success: false, error: { code: 'INTERNAL_ERROR', correlationId: '9f3c-aa21' } },
        500,
      ),
    );

    const client = new ApiClient({ baseUrl: 'http://api.test', fetch: fetchMock });

    await expect(client.me()).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      correlationId: '9f3c-aa21',
    });
  });

  it('leaves correlationId undefined until the API populates it', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ success: false, error: { code: 'UNAUTHORIZED' } }, 401));

    const client = new ApiClient({ baseUrl: 'http://api.test', fetch: fetchMock });

    await expect(client.me()).rejects.toMatchObject({ correlationId: undefined });
  });

  it('reports the failing path as structured detail on an unparseable response', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response('<html>502</html>', { status: 502 }));

    const client = new ApiClient({ baseUrl: 'http://api.test', fetch: fetchMock });

    await expect(client.health()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      details: { path: '/health' },
    });
  });

  it('strips a trailing slash from the base URL', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: { status: 'ok' } }));

    const client = new ApiClient({ baseUrl: 'http://api.test/', fetch: fetchMock });
    await client.health();

    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/health');
  });
});
