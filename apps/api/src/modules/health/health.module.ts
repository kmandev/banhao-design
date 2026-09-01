import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * `SupabaseModule` is `@Global`, so this import is redundant inside the running
 * application. It is here so that a test can import `HealthModule` alone and
 * still override `SupabaseService` — without it the provider is not part of
 * this module's context, `overrideProvider` has nothing to replace, and the
 * probe could only be tested with real credentials.
 */
@Module({
  imports: [SupabaseModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
