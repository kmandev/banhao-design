import { Injectable } from '@nestjs/common';
import type { AgentDecision, ScopedOperationalProjection } from './ai-ops.types';

/**
 * Phase J — stage 4. The agent boundary.
 *
 * DEC-040 §2 is enforced here by **absence**, which is the only enforcement
 * that actually holds: an implementation of this port is constructed with no
 * `SupabaseService`, no database client, no PostgREST reach, no credential and
 * no HTTP client. It cannot execute SQL because it is handed nothing capable
 * of executing SQL — not because a guard checks a string for `SELECT`.
 *
 * Its input is a {@link ScopedOperationalProjection}, which carries no
 * financial field. Its output is an {@link AgentDecision}, which can only name
 * a catalog command — it cannot express a free-form mutation. Both halves of
 * the boundary are types, so widening either is a visible change to a
 * reviewable interface rather than a quiet capability grant.
 *
 * Note the ordering guarantee this port depends on: the pipeline reaches an
 * agent only *after* the deterministic router has chosen a playbook and its
 * policy inputs have resolved. An agent is never asked to route, and never
 * asked what a missing policy value should be.
 */
export abstract class AgentPort {
  abstract decide(projection: ScopedOperationalProjection): Promise<AgentDecision>;
}

/**
 * The V1 adapter: deterministic, no model, no vendor.
 *
 * DEC-040 explicitly selects no vendor, model or region, and this slice does
 * not either — wiring a real provider is a separate decision. What this
 * adapter exists to prove is the *boundary*: that the pipeline can invoke an
 * agent, receive a structured decision, and enforce every downstream guard
 * against it, with the model call itself replaceable behind {@link AgentPort}.
 *
 * It deliberately does the least defensible-by-itself thing: it proposes the
 * one L2 catalog command this playbook has, and otherwise escalates. It never
 * decides authorization — the dispatcher does that, and would refuse this
 * adapter exactly as it would refuse any other implementation of the port.
 */
@Injectable()
export class DeterministicAgentAdapter extends AgentPort {
  async decide(projection: ScopedOperationalProjection): Promise<AgentDecision> {
    if (projection.playbook === 'MERCHANT_ACCEPTANCE_TIMEOUT') {
      // DEC-068 C1: at the deadline an operator is alerted and decides. There
      // is no automatic cancellation, and no merchant command is approved
      // beyond that, so the only outcome is an escalation. (The L2 reminder
      // command stays in the catalog, unused by this path: C1 says the system
      // "may" remind the restaurant but names no lead time, and inventing one
      // is forbidden by DEC-040 §5.)
      return {
        kind: 'ESCALATE',
        escalation: 'ESC-UNKNOWN',
        reason:
          `Order has been awaiting merchant acceptance for ${projection.elapsedSeconds}s, past the ` +
          `5-minute deadline (DEC-068 C1). An operator should contact the restaurant and decide; ` +
          `nothing is cancelled or refunded automatically (DEC-058).`,
      };
    }

    if (projection.playbook === 'NO_RIDER_TRIAGE') {
      // The design package's § 10 "No rider found" playbook stops here by
      // construction: the agent detects that rounds are producing no
      // acceptance and escalates with the round history attached. It must not
      // cancel, must not fail the delivery, and must not say anything new to
      // the customer — UX-Q-006 leaves the terminal outcome open and DEC-020
      // forbids auto-cancellation. So there is no command to return, and no
      // catalog entry for one to name.
      return {
        kind: 'ESCALATE',
        escalation: 'ESC-NORIDER',
        reason:
          `Delivery has been searching for ${projection.elapsedSeconds}s across ` +
          `${projection.roundsBroadcast} round(s): ${projection.offersMade} offer(s) to ` +
          `${projection.ridersOffered} rider(s), ${projection.offersExpired} expired, ` +
          `${projection.offersDeclined} declined; ${projection.ridersEligibleNow} rider(s) eligible now`,
      };
    }

    return {
      kind: 'ESCALATE',
      escalation: 'ESC-UNKNOWN',
      reason: 'No agent behaviour is defined for this playbook',
    };
  }
}
