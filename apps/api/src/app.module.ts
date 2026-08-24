import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { CorrelationModule } from './common/correlation/correlation.module';
import { SupabaseModule } from './supabase/supabase.module';
import { UsersModule } from './modules/users/users.module';
import { CartModule } from './modules/cart/cart.module';
import { OrdersModule } from './modules/orders/orders.module';
import { MerchantModule } from './modules/merchant/merchant.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { RiderModule } from './modules/rider/rider.module';
import { TickModule } from './modules/tick/tick.module';
import { SupabaseAuthGuard } from './common/guards/supabase-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { RestaurantScopeGuard } from './common/guards/restaurant-scope.guard';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

/**
 * BANHAO API — modular monolith (DEC-009).
 *
 * Guard order matters, and is the order below. SupabaseAuthGuard runs first and
 * populates request.user with capabilities resolved from database domain
 * membership (DEC-033 / DEC-APP-004); RolesGuard then checks that the actor
 * holds a required capability at all; RestaurantScopeGuard finally checks that
 * a restaurant-scoped route is one this actor is a member of. All three are
 * global, so routes are protected by default and must opt out with @Public().
 *
 * The last two are separate deliberately: "is a merchant" and "is a merchant
 * *here*" are different questions, and collapsing them would make every
 * merchant a merchant everywhere.
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
    CartModule,
    OrdersModule,
    MerchantModule,
    HealthModule,
    AuthModule,
    PaymentsModule,
    WebhooksModule,
    RiderModule,
    TickModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: SupabaseAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: RestaurantScopeGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
