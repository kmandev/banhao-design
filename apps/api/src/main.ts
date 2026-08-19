import 'reflect-metadata';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { loadServerEnv } from '@banhao/config';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

/**
 * Loads the repository-root `.env` into `process.env` for local development,
 * before anything reads it.
 *
 * Root, not `apps/api/.env` — this is the one location `.env.example`,
 * `docs/SETUP.md` ("cp .env.example .env") and `docker-compose.yml`
 * (`env_file: - .env`, resolved relative to the compose file at the repo
 * root) already agree on. `loadServerEnv()` (`@banhao/config`) has always
 * read bare `process.env` — that stays true here too; this only populates it
 * first.
 *
 * `resolve(__dirname, '../../../.env')` rather than a bare `'.env'` path so
 * the file is found regardless of the current working directory or whether
 * this is running from `src/` (`nest start --watch`) or `dist/`
 * (`node dist/main.js`) — both are three directories below the repo root
 * (`apps/api/src`, `apps/api/dist`).
 *
 * A no-op everywhere the file doesn't exist — Cloud Run has no `.env` on disk
 * and gets its environment from Secret Manager, and the Dockerfile never
 * copies one into any build stage either, so this changes nothing about
 * production or the container image. `dotenv` never overwrites a variable
 * already set in the process environment, so CI or a deploy environment that
 * exports real values takes precedence over any stray local file.
 */
loadDotenv({ path: resolve(__dirname, '../../../.env') });

async function bootstrap(): Promise<void> {
  // Validated first so a misconfigured deployment fails at startup, not at the
  // first request.
  const env = loadServerEnv();

  // rawBody: true exposes req.rawBody as a Buffer of the original request
  // bytes, alongside Nest's normal JSON body parsing. DEC-APP-005 requires
  // this: a payment provider's signature is computed over its exact bytes, and
  // a JSON-parsed-and-reserialized body will not verify.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableCors({ origin: env.corsOrigins, credentials: true });

  const config = new DocumentBuilder()
    .setTitle('BANHAO API')
    .setDescription('BANHAO | บ้านเฮา — Phase 1 Food Delivery API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));

  await app.listen(env.port);

  const logger = new Logger('Bootstrap');
  logger.log(`BANHAO API listening on port ${env.port} (${env.nodeEnv})`);
  logger.log(`OpenAPI docs at http://localhost:${env.port}/docs`);
}

void bootstrap();
