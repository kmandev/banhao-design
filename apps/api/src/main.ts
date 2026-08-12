import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { loadServerEnv } from '@banhao/config';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

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
