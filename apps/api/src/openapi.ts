import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';

/**
 * The single definition of BANHAO's OpenAPI surface.
 *
 * Extracted from `main.ts` so exactly one description exists and three callers
 * can share it: the running server (`/docs`), the generator that writes the
 * committed `docs/06-api/openapi.json`, and the drift test that regenerates
 * the document and compares it to that file. If the builder lived only in
 * `bootstrap()`, the committed contract could silently diverge from the served
 * one.
 *
 * The version is the API contract version, deliberately separate from any
 * package version — it changes when the contract does, not when a dependency
 * is bumped.
 */
export const OPENAPI_VERSION = '0.1.0';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('BANHAO API')
    .setDescription('BANHAO | บ้านเฮา — Phase 1 Food Delivery API')
    .setVersion(OPENAPI_VERSION)
    .addBearerAuth()
    .build();

  return SwaggerModule.createDocument(app, config);
}
