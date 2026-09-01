import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { RequestLoggingMiddleware } from './request-logging.middleware';

/**
 * Binds {@link RequestLoggingMiddleware} to every route.
 *
 * A module rather than a `main.ts` call, for the same reason `CorrelationModule`
 * is one: bootstrap-only middleware is invisible to `Test.createTestingModule`,
 * and behaviour that only exists in production is behaviour nothing tests.
 *
 * Registered after `CorrelationModule` in `AppModule` so the correlation id is
 * already in the async store by the time a request line is written.
 */
@Module({})
export class LoggingModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggingMiddleware).forRoutes('*');
  }
}
