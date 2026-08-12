import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CorrelationMiddleware } from './correlation.middleware';

/**
 * Binds {@link CorrelationMiddleware} to every route.
 *
 * Registration lives in a module rather than in `main.ts` so that integration
 * tests get the identical wiring by importing this module — bootstrap-only
 * middleware would be invisible to `Test.createTestingModule`, and the
 * behaviour would be untestable exactly where it matters most.
 */
@Module({})
export class CorrelationModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
