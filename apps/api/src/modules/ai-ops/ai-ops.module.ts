import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { RiderModule } from '../rider/rider.module';
import { AgentPort, DeterministicAgentAdapter } from './agent.port';
import { AiAuditService } from './ai-audit.service';
import { CommandDispatcher } from './command-dispatcher';
import { EventNormalizer } from './event-normalizer';
import {
  Bq013MerchantAcceptancePolicySource,
  MerchantAcceptancePolicySource,
} from './merchant-acceptance-policy';
import { MerchantAcceptanceTimeoutService } from './merchant-acceptance-timeout.service';
import {
  Dec022NoRiderTriagePolicySource,
  NoRiderTriagePolicySource,
} from './no-rider-triage-policy';
import { NoRiderTriageService } from './no-rider-triage.service';
import { PlaybookRouter } from './playbook-router';

/**
 * Phase J (DEC-040) — AI Operations.
 *
 * The ports are bound here, which is the whole point of binding them at all:
 * {@link AgentPort} is the seam where a model vendor will eventually arrive,
 * and each policy source is the seam where an approved value does — one
 * resolving today from DEC-022, one still `MISSING` on BQ-013. Swapping either is a module
 * edit plus a decision entry, not a rewrite of the pipeline.
 *
 * `RiderModule` is imported for one thing: `DISPATCH_STRATEGY`, so the
 * no-rider projection reports the pool the shipped dispatcher would broadcast
 * to rather than a second copy of DEC-037's eligibility rule. The dependency
 * runs one way — the rider domain knows nothing about AI Operations, and
 * nothing here can be reached from a rider request path.
 *
 * Note what this module does **not** provide: no controller, no route, no
 * client-facing surface. AI Operations runs from the tick and nowhere else,
 * and is never on the request path of a customer, merchant or rider action.
 */
@Module({
  imports: [SupabaseModule, RiderModule],
  providers: [
    EventNormalizer,
    PlaybookRouter,
    AiAuditService,
    CommandDispatcher,
    MerchantAcceptanceTimeoutService,
    NoRiderTriageService,
    { provide: MerchantAcceptancePolicySource, useClass: Bq013MerchantAcceptancePolicySource },
    { provide: NoRiderTriagePolicySource, useClass: Dec022NoRiderTriagePolicySource },
    // The agent is constructed with no Supabase client, no credential and no
    // HTTP client — DEC-040 §2 enforced by what is not injected.
    { provide: AgentPort, useClass: DeterministicAgentAdapter },
  ],
  exports: [MerchantAcceptanceTimeoutService, NoRiderTriageService],
})
export class AiOpsModule {}
