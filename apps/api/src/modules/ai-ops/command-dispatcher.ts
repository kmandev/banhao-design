import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import type { CommandRequest, CommandResult } from './ai-ops.types';
import {
  AUTONOMOUSLY_EXECUTABLE_LEVELS,
  COMMAND_NOTIFY_MERCHANT_ACCEPTANCE_DEADLINE,
  lookupCommand,
} from './command-catalog';

/** `orders`, the columns the revalidation needs. No amount column is read — DEC-040 §3. */
interface OrderStateRow {
  id: string;
  state: string;
  restaurant_id: string;
}

type RecipientType = 'CUSTOMER' | 'MERCHANT' | 'RIDER' | 'OPERATOR';

/** H-3's locked recipient shape — `outbox.payload.recipients[]`. Duplicated per module, matching every other H-3 writer's established precedent. */
interface OutboxRecipient {
  recipientId: string;
  recipientType: RecipientType;
}

const REMINDER_EVENT_TYPE = 'MerchantAcceptanceDeadlineReminder';

/**
 * Phase J — stages 6, 7 and 8: the command boundary, the domain call, and the
 * verification read.
 *
 * This is a **thin dispatcher**, deliberately. It performs exactly four jobs
 * and refuses to grow a fifth:
 *
 * 1. Resolve the requested name in the catalog. An unknown name is refused —
 *    never interpreted, never passed through.
 * 2. Enforce the autonomy level from the catalog entry. The level is the
 *    authorization; a confidence score is not an input here and never will be
 *    (DEC-040 §6).
 * 3. Revalidate authoritative domain state immediately before the effect, and
 *    surface a refusal as `DOMAIN_REJECTED`. The domain is the final
 *    authority — this class does not re-implement its rules, it re-reads its
 *    state and defers.
 * 4. Verify the effect afterwards by reading it back. "The insert returned no
 *    error" is not the same claim as "the operation happened", and DEC-040's
 *    pipeline requires the second one.
 *
 * ## Why the revalidation is a read, not a guarded UPDATE
 *
 * ADR-003 requires a state check to live in the `WHERE` clause of the write
 * it guards — and it is obeyed everywhere a *state transition* happens. This
 * command performs no state transition: its effect is an `outbox` insert, a
 * row with no prior state to guard against. The read-then-write window here
 * can therefore only produce a redundant reminder for an order accepted in
 * the same instant, which is the same low-severity, no-money, no-state-change
 * outcome `NoRiderEscalationService` already documents and accepts for its own
 * existence check. It is flagged here rather than hidden: no unique
 * constraint on `outbox` backs it, and adding one would be a migration this
 * slice must not make.
 */
@Injectable()
export class CommandDispatcher {
  private readonly logger = new Logger(CommandDispatcher.name);

  constructor(private readonly supabase: SupabaseService) {}

  async dispatch(request: CommandRequest): Promise<CommandResult> {
    const entry = lookupCommand(request.name);

    if (!entry) {
      // DEC-040 §1/§3 — the refusal that keeps a financial command from ever
      // having a code path, because it has no catalog entry to resolve to.
      return {
        status: 'NOT_PERMITTED',
        detail: `Command "${request.name}" is not in the AI Operations catalog`,
      };
    }

    if (!AUTONOMOUSLY_EXECUTABLE_LEVELS.has(entry.autonomyLevel)) {
      return {
        status: 'NOT_PERMITTED',
        detail: `Command "${entry.name}" is ${entry.autonomyLevel}; autonomous execution requires L2 or L3`,
      };
    }

    if (entry.name !== COMMAND_NOTIFY_MERCHANT_ACCEPTANCE_DEADLINE) {
      // Unreachable while the catalog holds one entry. Kept because a future
      // entry with no handler must fail closed rather than fall through to
      // "executed".
      return { status: 'NOT_PERMITTED', detail: `No handler registered for "${entry.name}"` };
    }

    return this.notifyMerchantAcceptanceDeadline(request);
  }

  /**
   * The one handler this slice has. Notification only — no order, delivery,
   * payment or rider state is written, and no financial table is touched.
   */
  private async notifyMerchantAcceptanceDeadline(request: CommandRequest): Promise<CommandResult> {
    const order = await this.readOrder(request.orderId);

    if (!order) {
      return { status: 'DOMAIN_REJECTED', detail: `Order ${request.orderId} not found` };
    }

    // The catalog's `requiredDomainValidation`, executed. A merchant who
    // accepted between the event and now makes this reminder wrong, and the
    // domain's own state is what says so.
    if (order.state !== 'PAID') {
      return {
        status: 'DOMAIN_REJECTED',
        detail: `Order ${order.id} is ${order.state}, no longer awaiting merchant acceptance`,
      };
    }

    const recipients = await this.resolveRecipients(order.restaurant_id);

    if (recipients.length === 0) {
      // Fail closed rather than write a notification addressed to nobody.
      return {
        status: 'DOMAIN_REJECTED',
        detail: `No merchant recipient resolves for restaurant ${order.restaurant_id}`,
      };
    }

    const { error } = await this.supabase.admin.from('outbox').insert({
      aggregate_type: 'order',
      aggregate_id: order.id,
      event_type: REMINDER_EVENT_TYPE,
      payload: { recipients, reason: request.reason },
    });

    if (error) {
      return { status: 'UNVERIFIED', detail: `outbox insert failed: ${error.message}` };
    }

    // Stage 8 — verify. Read the effect back from the authoritative store
    // rather than trusting the write's own return.
    const verified = await this.verifyReminderWritten(order.id);

    if (!verified) {
      return {
        status: 'UNVERIFIED',
        detail: `Reminder insert reported success but no ${REMINDER_EVENT_TYPE} row is readable for order ${order.id}`,
      };
    }

    return {
      status: 'EXECUTED',
      verified: true,
      detail: `${REMINDER_EVENT_TYPE} written for order ${order.id}`,
    };
  }

  private async readOrder(orderId: string): Promise<OrderStateRow | null> {
    const { data, error } = await this.supabase.admin
      .from('orders')
      .select('id, state, restaurant_id')
      .eq('id', orderId)
      .maybeSingle<OrderStateRow>();

    if (error) {
      this.logger.error(`orders read failed for ${orderId}: ${error.message}`);
      return null;
    }

    return data ?? null;
  }

  /**
   * `restaurants.merchant_id -> merchants.owner_user_id`, the same two hops
   * `PaymentEventProcessingService.resolveMerchantOwnerId` already makes, for
   * the same reason its own comment gives: H-3 resolves recipients per
   * module rather than through a shared cross-module resolver.
   */
  private async resolveRecipients(restaurantId: string): Promise<OutboxRecipient[]> {
    const { data: restaurant, error: restaurantError } = await this.supabase.admin
      .from('restaurants')
      .select('merchant_id')
      .eq('id', restaurantId)
      .maybeSingle<{ merchant_id: string }>();

    if (restaurantError || !restaurant) {
      return [];
    }

    const { data: merchant, error: merchantError } = await this.supabase.admin
      .from('merchants')
      .select('owner_user_id')
      .eq('id', restaurant.merchant_id)
      .maybeSingle<{ owner_user_id: string }>();

    if (merchantError || !merchant?.owner_user_id) {
      return [];
    }

    return [{ recipientId: merchant.owner_user_id, recipientType: 'MERCHANT' }];
  }

  private async verifyReminderWritten(orderId: string): Promise<boolean> {
    const { data, error } = await this.supabase.admin
      .from('outbox')
      .select('id')
      .eq('aggregate_id', orderId)
      .eq('event_type', REMINDER_EVENT_TYPE)
      .limit(1)
      .returns<{ id: string }[]>();

    if (error) {
      this.logger.error(`verification read failed for order ${orderId}: ${error.message}`);
      return false;
    }

    return (data ?? []).length > 0;
  }
}
