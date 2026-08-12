import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { loadServerEnv } from '@banhao/config';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

/**
 * The worker entrypoint (DEC-APP-002, ADR-010).
 *
 * "A second entrypoint, not a second service": this boots the exact same
 * `AppModule` as `main.ts` — same modules, same routes, same guards, same
 * correlation and error-handling wiring. Nothing here builds a second module
 * hierarchy, and nothing here restricts which routes this process can serve.
 * What makes this the *worker* process is operational, not architectural: in
 * deployment, only the scheduler's calls to `POST /internal/tick` are routed
 * here — that routing is infrastructure configuration (Cloudflare Worker cron
 * → this process), out of scope for A-6, and does not belong in this file.
 *
 * Deliberately narrower than `main.ts`: no CORS (no browser calls this
 * process) and no Swagger (an internal process has no public API surface to
 * document).
 */
async function bootstrap(): Promise<void> {
  const env = loadServerEnv();

  // rawBody: true — TickHmacGuard verifies a signature over the exact request
  // bytes, the same requirement DEC-APP-005 already established for webhooks.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.useGlobalFilters(new HttpExceptionFilter());

  await app.listen(env.port);

  const logger = new Logger('Worker');
  logger.log(`BANHAO worker listening on port ${env.port} (${env.nodeEnv})`);
}

void bootstrap();
