import { OutboxDispatchService } from './outbox-dispatch.service';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { NotificationChannel } from './notification-channel.interface';

/**
 * H-2 — same stub shape as `payment-event-processing.service.spec.ts`: a fake
 * `supabase.admin.from()` that records every filter/payload a statement was
 * built with and returns queued results in call order, so a test can assert
 * the claim guard is actually IN the query, not merely checked afterward in
 * application code.
 */

type Result = { data: unknown; error: { message: string; code?: string } | null };

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update';
  eq: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

function supabaseStub(results: Result[]) {
  const calls: Recorded[] = [];
  let index = 0;

  const nextResult = (): Result => results[index++] ?? { data: null, error: null };

  const admin = {
    from(table: string) {
      const call: Recorded = { table, op: 'select', eq: {} };
      calls.push(call);

      const builder: Record<string, unknown> = {
        select: () => builder,
        insert(payload: Record<string, unknown>) {
          call.op = 'insert';
          call.payload = payload;
          return builder;
        },
        update(payload: Record<string, unknown>) {
          call.op = 'update';
          call.payload = payload;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.eq[column] = value;
          return builder;
        },
        is(column: string, value: unknown) {
          call.eq[`${column}__is`] = value;
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve(nextResult()),
        returns: () => Promise.resolve(nextResult()),
        then: (resolve: (r: Result) => unknown) => Promise.resolve(nextResult()).then(resolve),
      };

      return builder;
    },
  };

  return { supabase: { admin } as unknown as SupabaseService, calls };
}

function alwaysDelivers(): NotificationChannel {
  return { channel: 'IN_APP', deliver: jest.fn().mockResolvedValue({ delivered: true }) };
}

const OUTBOX_ID = 'outbox-1';

function claimedRow(overrides: { payload?: unknown; aggregate_type?: string; attempts?: number } = {}) {
  return {
    id: OUTBOX_ID,
    aggregate_type: overrides.aggregate_type ?? 'order',
    aggregate_id: 'order-1',
    event_type: 'OrderCreated',
    payload: overrides.payload ?? {
      recipients: [
        { recipientId: 'cust-1', recipientType: 'CUSTOMER' },
        { recipientId: 'op-1', recipientType: 'OPERATOR' },
      ],
    },
    attempts: overrides.attempts ?? 0,
  };
}

describe('OutboxDispatchService.processOne — success path', () => {
  it('claims the row, fans out to valid recipients, creates notification + delivery records, marks IN_APP SENT, and stamps dispatched_at', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedRow(), error: null }, // claim
      { data: { id: 'notif-1' }, error: null }, // notifications insert
      { data: { id: 'delivery-1' }, error: null }, // notification_deliveries insert
      { data: null, error: null }, // notification_deliveries -> SENT
    ]);
    const channel = alwaysDelivers();
    const service = new OutboxDispatchService(supabase, channel);

    const result = await service.processOne(OUTBOX_ID);

    expect(result).toBe('dispatched');

    const claimCall = calls.find((c) => c.table === 'outbox' && c.op === 'update');
    expect(claimCall?.payload).toHaveProperty('dispatched_at');
    expect(claimCall?.payload?.dispatched_at).not.toBeNull();
    expect(claimCall?.eq).toMatchObject({ id: OUTBOX_ID, dispatched_at__is: null });

    // OPERATOR recipient must never reach notifications — only one insert.
    const notificationInserts = calls.filter((c) => c.table === 'notifications' && c.op === 'insert');
    expect(notificationInserts).toHaveLength(1);
    expect(notificationInserts[0]?.payload).toMatchObject({
      recipient_id: 'cust-1',
      recipient_type: 'CUSTOMER',
      event_type: 'OrderCreated',
      title: 'OrderCreated',
      body: null,
      deep_link: null,
      order_id: 'order-1',
    });

    const deliveryInsert = calls.find((c) => c.table === 'notification_deliveries' && c.op === 'insert');
    expect(deliveryInsert?.payload).toMatchObject({
      notification_id: 'notif-1',
      channel: 'IN_APP',
      state: 'PENDING',
    });

    const sentUpdate = calls.find((c) => c.table === 'notification_deliveries' && c.op === 'update');
    expect(sentUpdate?.payload).toMatchObject({ state: 'SENT' });
    expect(sentUpdate?.payload).toHaveProperty('sent_at');
    expect(sentUpdate?.eq).toMatchObject({ id: 'delivery-1' });

    expect(channel.deliver).toHaveBeenCalledWith({
      notificationId: 'notif-1',
      recipientId: 'cust-1',
      title: 'OrderCreated',
      body: null,
      deepLink: null,
    });
  });

  it('skips OPERATOR-only events without creating any notification, but still dispatches', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedRow({ payload: { recipients: [{ recipientId: 'op-1', recipientType: 'OPERATOR' }] } }), error: null },
    ]);
    const service = new OutboxDispatchService(supabase, alwaysDelivers());

    const result = await service.processOne(OUTBOX_ID);

    expect(result).toBe('dispatched');
    expect(calls).toHaveLength(1); // only the claim — no notifications/deliveries work
  });
});

describe('OutboxDispatchService.processOne — claiming', () => {
  it('an already-dispatched (or nonexistent) row is skipped with no further calls', async () => {
    const { supabase, calls } = supabaseStub([{ data: null, error: null }]);
    const service = new OutboxDispatchService(supabase, alwaysDelivers());

    const result = await service.processOne(OUTBOX_ID);

    expect(result).toBe('skipped');
    expect(calls).toHaveLength(1);
  });

  it('a rerun after a successful dispatch finds the row already claimed and skips — no duplicate notifications', async () => {
    const { supabase } = supabaseStub([
      { data: claimedRow(), error: null },
      { data: { id: 'notif-1' }, error: null },
      { data: { id: 'delivery-1' }, error: null },
      { data: null, error: null },
      { data: null, error: null }, // second processOne's claim attempt: 0 rows (dispatched_at no longer null)
    ]);
    const service = new OutboxDispatchService(supabase, alwaysDelivers());

    const first = await service.processOne(OUTBOX_ID);
    const second = await service.processOne(OUTBOX_ID);

    expect(first).toBe('dispatched');
    expect(second).toBe('skipped');
  });
});

describe('OutboxDispatchService.processOne — failure handling', () => {
  it('a malformed payload.recipients releases the claim, records the error, and never stamps dispatched_at', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedRow({ payload: {} }), error: null }, // claim
      { data: null, error: null }, // release update
    ]);
    const service = new OutboxDispatchService(supabase, alwaysDelivers());

    const result = await service.processOne(OUTBOX_ID);

    expect(result).toBe('failed');

    const release = calls.filter((c) => c.table === 'outbox' && c.op === 'update')[1];
    expect(release?.payload).toMatchObject({ dispatched_at: null, attempts: 1 });
    expect(release?.payload?.last_error).toEqual(expect.stringContaining('recipients'));
    expect(release?.eq).toMatchObject({ id: OUTBOX_ID });
  });

  it('a failed IN_APP delivery releases the claim and never stamps dispatched_at', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedRow(), error: null }, // claim
      { data: { id: 'notif-1' }, error: null }, // notifications insert
      { data: { id: 'delivery-1' }, error: null }, // notification_deliveries insert
      { data: null, error: null }, // notification_deliveries -> FAILED
      { data: null, error: null }, // release update
    ]);
    const channel: NotificationChannel = {
      channel: 'IN_APP',
      deliver: jest.fn().mockResolvedValue({ delivered: false, reason: 'boom' }),
    };
    const service = new OutboxDispatchService(supabase, channel);

    const result = await service.processOne(OUTBOX_ID);

    expect(result).toBe('failed');

    const failedUpdate = calls.find(
      (c) => c.table === 'notification_deliveries' && c.op === 'update' && c.payload?.state === 'FAILED',
    );
    expect(failedUpdate?.payload).toMatchObject({ state: 'FAILED', last_error: 'boom' });

    const release = calls.filter((c) => c.table === 'outbox' && c.op === 'update')[1];
    expect(release?.payload).toMatchObject({ dispatched_at: null, attempts: 1 });
  });
});

describe('OutboxDispatchService.dispatchPending', () => {
  it('reports claimed/dispatched/skipped/failed counts across a batch', async () => {
    const { supabase } = supabaseStub([
      { data: [{ id: OUTBOX_ID }], error: null }, // list pending
      { data: claimedRow(), error: null }, // claim
      { data: { id: 'notif-1' }, error: null },
      { data: { id: 'delivery-1' }, error: null },
      { data: null, error: null },
    ]);
    const service = new OutboxDispatchService(supabase, alwaysDelivers());

    const result = await service.dispatchPending();

    expect(result).toEqual({ claimed: 1, dispatched: 1, skipped: 0, failed: 0 });
  });

  it('returns all zeros when nothing is pending', async () => {
    const { supabase } = supabaseStub([{ data: [], error: null }]);
    const service = new OutboxDispatchService(supabase, alwaysDelivers());

    const result = await service.dispatchPending();

    expect(result).toEqual({ claimed: 0, dispatched: 0, skipped: 0, failed: 0 });
  });
});
