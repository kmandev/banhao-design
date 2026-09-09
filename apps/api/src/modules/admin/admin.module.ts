import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { SupervisorCaseService } from './supervisor-case.service';
import { DeliveryFailureService } from './delivery-failure.service';
import { RefundService } from './refund.service';
import { ReconciliationCaseService } from './reconciliation-case.service';
import { SupervisorController } from './supervisor.controller';

/**
 * Phase I — the admin/operator API surface.
 *
 * Opens with the Human Supervisor console (`docs/HUMAN_SUPERVISOR_CONTRACT.md`)
 * rather than with the Admin design package's financial screens, because the
 * financial half is gated behind Q-001, Q-002, Q-010, Q-020 and Q-032 while
 * Phase J is already writing escalations that nothing can read.
 *
 * The supervisor projection reads `audit_logs`, `orders`, `deliveries` and
 * `order_status_history` directly and calls no domain service, because it
 * changes no domain state.
 *
 * `OrdersModule` is imported for exactly one reason, and it is the case this
 * module's original note anticipated: "the moment a supervisor command *does*
 * need to move state, it imports that domain's module and calls its existing
 * guarded service — never a second write path." BQ-017's operator failure
 * command (DEC-053) is that moment, and it calls `OrdersService.failDelivery`
 * for the order half rather than reimplementing the guarded UPDATE.
 *
 * `PaymentsModule` is imported for `RefundService` (Q-020 Slice 1,
 * DEC-057/058/059) — specifically for `PAYMENT_PROVIDER`, the same injected
 * Stripe adapter `PaymentsService` already uses. `RefundService` reads/writes
 * `orders`/`payments`/`refunds` directly rather than calling `PaymentsService`
 * or `OrdersService`, because refund initiation is not a payment-creation or
 * order-transition operation — it neither touches `payments.state` nor
 * `orders.state` (see `RefundService`'s own doc comment).
 *
 * `ReconciliationCaseService` (Q-020 Slice 4) needs only `SupabaseModule` —
 * it reads/writes `reconciliation_cases` directly, the same table
 * `PaymentEventProcessingService.openCase` already writes, under this
 * console's existing `@Roles('OPERATOR', 'ADMIN')` grant.
 */
@Module({
  imports: [SupabaseModule, OrdersModule, PaymentsModule],
  controllers: [SupervisorController],
  providers: [SupervisorCaseService, DeliveryFailureService, RefundService, ReconciliationCaseService],
  exports: [SupervisorCaseService],
})
export class AdminModule {}
