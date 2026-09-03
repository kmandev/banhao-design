import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { SupervisorCaseService } from './supervisor-case.service';
import { SupervisorController } from './supervisor.controller';

/**
 * Phase I — the admin/operator API surface.
 *
 * Opens with the Human Supervisor console (`docs/HUMAN_SUPERVISOR_CONTRACT.md`)
 * rather than with the Admin design package's financial screens, because the
 * financial half is gated behind Q-001, Q-002, Q-010, Q-020 and Q-032 while
 * Phase J is already writing escalations that nothing can read.
 *
 * Imports `SupabaseModule` and nothing else: the supervisor projection reads
 * `audit_logs`, `orders`, `deliveries` and `order_status_history` directly and
 * calls no domain service, because it changes no domain state. The moment a
 * supervisor command *does* need to move state, it imports that domain's
 * module and calls its existing guarded service — never a second write path.
 */
@Module({
  imports: [SupabaseModule],
  controllers: [SupervisorController],
  providers: [SupervisorCaseService],
  exports: [SupervisorCaseService],
})
export class AdminModule {}
