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

  it('strips a trailing slash from the base URL', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: { status: 'ok' } }));

    const client = new ApiClient({ baseUrl: 'http://api.test/', fetch: fetchMock });
    await client.health();

    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/health');
  });
});
