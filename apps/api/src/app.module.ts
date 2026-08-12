import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { CorrelationModule } from './common/correlation/correlation.module';
import { SupabaseModule } from './supabase/supabase.module';
import { UsersModule } from './modules/users/users.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { SupabaseAuthGuard } from './common/guards/supabase-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

/**
 * BANHAO API — modular monolith (DEC-009).
 *
 * Guard order matters: SupabaseAuthGuard runs first and populates request.user,
 * then RolesGuard checks that user's database-backed role. Both are global, so
 * routes are protected by default and must opt out with @Public().
 *
 * CorrelationModule is listed first for readability only — its middleware runs
 * before every guard regardless, which is what makes an auth rejection
 * traceable.
 */
@Module({
  imports: [
    CorrelationModule,
    SupabaseModule,
    UsersModule,
    HealthModule,
    AuthModule,
    PaymentsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: SupabaseAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
