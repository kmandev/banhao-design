import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { AgentPort, DeterministicAgentAdapter } from './agent.port';
import { AiAuditService } from './ai-audit.service';
import { CommandDispatcher } from './command-dispatcher';
import { EventNormalizer } from './event-normalizer';
import {
  Bq013MerchantAcceptancePolicySource,
  MerchantAcceptancePolicySource,
} from './merchant-acceptance-policy';
import { MerchantAcceptanceTimeoutService } from './merchant-acceptance-timeout.service';
import { PlaybookRouter } from './playbook-router';

/**
 * Phase J (DEC-040) — AI Operations, vertical slice #1.
 *
 * The two ports are bound here, which is the whole point of binding them at
 * all: {@link AgentPort} and {@link MerchantAcceptancePolicySource} are the
 * seams where a model vendor and an approved policy value will eventually
 * arrive, and neither is chosen by this slice. Swapping either is a module
 * edit plus a decision entry, not a rewrite of the pipeline.
 *
 * Note what this module does **not** provide: no controller, no route, no
 * client-facing surface. AI Operations runs from the tick and nowhere else,
 * and is never on the request path of a customer, merchant or rider action.
 */
@Module({
  imports: [SupabaseModule],
  providers: [
    EventNormalizer,
    PlaybookRouter,
    AiAuditService,
    CommandDispatcher,
    MerchantAcceptanceTimeoutService,
    { provide: MerchantAcceptancePolicySource, useClass: Bq013MerchantAcceptancePolicySource },
    // The agent is constructed with no Supabase client, no credential and no
    // HTTP client — DEC-040 §2 enforced by what is not injected.
    { provide: AgentPort, useClass: DeterministicAgentAdapter },
  ],
  exports: [MerchantAcceptanceTimeoutService],
})
export class AiOpsModule {}
