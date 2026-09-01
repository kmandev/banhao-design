import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { buildOpenApiDocument } from './openapi';

/**
 * Writes the committed OpenAPI contract, `docs/06-api/openapi.json`.
 *
 * Run with `pnpm --filter @banhao/api openapi`, which builds first and then
 * executes the compiled file — the repository has no TypeScript runner and
 * this deliberately does not add one.
 *
 * The document is produced from the real `AppModule`, so it is the same
 * surface the server serves at `/docs`. `test/openapi.contract.spec.ts`
 * regenerates it and fails when the committed file has drifted, which is what
 * makes the file a contract rather than a snapshot someone forgot to refresh.
 */

/**
 * Placeholder environment for document generation.
 *
 * The DI graph cannot be built without these: `SupabaseService`'s constructor
 * calls `loadServerEnv()`, and the storage module's constructor throws
 * `StorageConfigError` when the five R2 values are absent. Nothing here reaches
 * the document — no environment value appears anywhere in an OpenAPI
 * description, and no request is ever made, since the application is created
 * and closed without being initialised or listened on.
 *
 * Every value is obviously non-functional, and `.invalid` is the reserved TLD
 * (RFC 2606) precisely so a stray connection attempt cannot resolve.
 *
 * Existing values are never overwritten, matching `dotenv`'s rule, so running
 * this in a configured shell uses the real configuration and still produces an
 * identical document.
 */
const GENERATION_ENV: Readonly<Record<string, string>> = {
  SUPABASE_URL: 'https://openapi-generation.invalid',
  SUPABASE_ANON_KEY: 'openapi-generation',
  SUPABASE_SERVICE_ROLE_KEY: 'openapi-generation',
  SUPABASE_JWT_SECRET: 'openapi-generation',
  INTERNAL_TICK_SECRET: 'openapi-generation',
  R2_ACCOUNT_ID: 'openapi-generation',
  R2_ACCESS_KEY_ID: 'openapi-generation',
  R2_SECRET_ACCESS_KEY: 'openapi-generation',
  R2_BUCKET: 'openapi-generation',
  R2_PUBLIC_URL: 'https://openapi-generation.invalid',
};

export const OPENAPI_DOCUMENT_PATH = resolve(__dirname, '../../../docs/06-api/openapi.json');

/**
 * Builds the OpenAPI document from the real application graph.
 *
 * `logger: false` keeps Nest's startup banner out of the generator's and the
 * test's output; `abortOnError: false` surfaces a DI failure as a rejected
 * promise instead of calling `process.exit`, which would take the test runner
 * down with it. The application is never initialised or listened on —
 * `createDocument` reads route metadata, so no lifecycle hook and no network
 * call is needed to produce the contract.
 */
export async function createOpenApiDocument(): Promise<OpenAPIObject> {
  for (const [key, value] of Object.entries(GENERATION_ENV)) {
    process.env[key] ??= value;
  }

  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });

  try {
    return buildOpenApiDocument(app);
  } finally {
    await app.close();
  }
}

/**
 * Serialised exactly as the generator writes it, so the drift test compares
 * bytes rather than re-deriving formatting rules. Two-space indent and a
 * trailing newline match every other JSON file in the repository.
 */
export function serialiseOpenApiDocument(document: OpenAPIObject): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

async function main(): Promise<void> {
  const document = await createOpenApiDocument();

  mkdirSync(dirname(OPENAPI_DOCUMENT_PATH), { recursive: true });
  writeFileSync(OPENAPI_DOCUMENT_PATH, serialiseOpenApiDocument(document), 'utf8');

  process.stdout.write(
    `OpenAPI contract written to ${OPENAPI_DOCUMENT_PATH} (${Object.keys(document.paths).length} paths)\n`,
  );
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
}
