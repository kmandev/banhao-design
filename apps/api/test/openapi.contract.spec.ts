import { readFileSync } from 'node:fs';
import {
  OPENAPI_DOCUMENT_PATH,
  createOpenApiDocument,
  serialiseOpenApiDocument,
} from '../src/openapi.generate';
import { OPENAPI_VERSION } from '../src/openapi';

/**
 * The committed contract, `docs/06-api/openapi.json`, is only worth anything if
 * it matches the code. This regenerates it from the real `AppModule` and fails
 * when the two have diverged, which is the moment a route was added, renamed or
 * removed without `pnpm --filter @banhao/api openapi` being re-run.
 *
 * Building the whole DI graph is slower than the rest of this suite, hence the
 * raised timeout.
 */
describe('OpenAPI contract', () => {
  let document: Awaited<ReturnType<typeof createOpenApiDocument>>;

  beforeAll(async () => {
    document = await createOpenApiDocument();
  }, 60_000);

  it('matches the committed docs/06-api/openapi.json byte for byte', () => {
    const committed = readFileSync(OPENAPI_DOCUMENT_PATH, 'utf8');

    expect(serialiseOpenApiDocument(document)).toBe(committed);
  });

  it('declares the API contract version', () => {
    expect(document.info.version).toBe(OPENAPI_VERSION);
  });

  it('declares bearer authentication', () => {
    expect(document.components?.securitySchemes?.bearer).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('excludes the two internal endpoints from the client-facing surface', () => {
    // POST /internal/tick and POST /webhooks/payments/:provider carry
    // @ApiExcludeEndpoint: neither is called by a BANHAO client, and publishing
    // them would invite exactly the direct calls their HMAC guards exist to
    // reject.
    expect(Object.keys(document.paths)).not.toContain('/internal/tick');
    expect(
      Object.keys(document.paths).filter((path) => path.startsWith('/webhooks')),
    ).toEqual([]);
  });

  it('versions every client route under /api/v1, with /health the only exception', () => {
    const unversioned = Object.keys(document.paths).filter(
      (path) => !path.startsWith('/api/v1/') && path !== '/health',
    );

    expect(unversioned).toEqual([]);
  });
});
