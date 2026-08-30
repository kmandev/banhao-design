import { NotificationsService } from './notifications.service';
import { DomainError } from '../../common/errors/domain-error';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * H-5A — the customer notification read path.
 *
 * Same stub shape as `addresses.service.spec.ts`: a fake `supabase.admin`
 * that records every filter a statement was built with, so these tests can
 * assert ownership is actually IN the query, not merely checked afterward in
 * application code — a query missing `recipient_id` would still be a data
 * leak even if every test row happened to belong to the right user.
 */

type Result = { data: unknown; error: { message: string } | null };

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
        update(payload: Record<string, unknown>) {
          call.op = 'update';
          call.payload = payload;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.eq[column] = value;
          return builder;
        },
        order: () => builder,
        returns: () => Promise.resolve(nextResult()),
        maybeSingle: () => Promise.resolve(nextResult()),
      };

      return builder;
    },
  };

  return { service: { admin } as unknown as SupabaseService, calls };
}

function serviceWith(results: Result[]) {
  const { service, calls } = supabaseStub(results);
  return { subject: new NotificationsService(service), calls };
}

const ROW = {
  id: 'n1',
  event_type: 'OrderPickedUp',
  title: 'OrderPickedUp',
  body: null,
  deep_link: null,
  order_id: 'order-1',
  read_at: null,
  created_at: '2026-08-30T10:00:00Z',
};

describe('NotificationsService — ownership scoping', () => {
  it('lists only the caller’s own CUSTOMER notifications, newest first', async () => {
    const { subject, calls } = serviceWith([{ data: [ROW], error: null }]);

    const result = await subject.list('user-42');

    expect(result).toHaveLength(1);
    expect(calls[0]?.eq.recipient_id).toBe('user-42');
    expect(calls[0]?.eq.recipient_type).toBe('CUSTOMER');
  });

  it('maps a row to the client shape and never exposes recipient_id/recipient_type', async () => {
    const { subject } = serviceWith([{ data: [ROW], error: null }]);
    const [notification] = await subject.list('user-42');

    expect(notification).toEqual({
      id: 'n1',
      eventType: 'OrderPickedUp',
      title: 'OrderPickedUp',
      body: null,
      deepLink: null,
      orderId: 'order-1',
      read: false,
      createdAt: '2026-08-30T10:00:00Z',
    });
    expect(notification).not.toHaveProperty('recipient_id');
    expect(notification).not.toHaveProperty('recipient_type');
  });

  it('reports read: true once read_at is set', async () => {
    const { subject } = serviceWith([
      { data: [{ ...ROW, read_at: '2026-08-30T10:05:00Z' }], error: null },
    ]);
    const [notification] = await subject.list('user-42');
    expect(notification?.read).toBe(true);
  });

  it('never selects notification_deliveries', async () => {
    const { subject, calls } = serviceWith([{ data: [ROW], error: null }]);
    await subject.list('user-42');
    expect(calls.map((c) => c.table)).toEqual(['notifications']);
  });

  it('throws rather than reporting success when the list query fails', async () => {
    const { subject } = serviceWith([{ data: null, error: { message: 'connection reset' } }]);
    await expect(subject.list('user-42')).rejects.toBeInstanceOf(DomainError);
  });

  it('scopes markRead by id, recipient_id AND recipient_type', async () => {
    const { subject, calls } = serviceWith([{ data: ROW, error: null }]);

    await subject.markRead('user-42', 'n1');

    expect(calls[0]?.eq.id).toBe('n1');
    expect(calls[0]?.eq.recipient_id).toBe('user-42');
    expect(calls[0]?.eq.recipient_type).toBe('CUSTOMER');
    expect(calls[0]?.op).toBe('update');
    expect(calls[0]?.payload).toHaveProperty('read_at');
  });

  it('marks a foreign notification NOT_FOUND — no row matches, never revealing that it exists', async () => {
    const { subject } = serviceWith([{ data: null, error: null }]);

    try {
      await subject.markRead('attacker', 'victim-notification');
      fail('expected DomainError');
    } catch (error) {
      expect((error as DomainError).code).toBe('NOT_FOUND');
    }
  });

  it('marking an already-read notification succeeds — re-marking is not a 404', async () => {
    const { subject } = serviceWith([
      { data: { ...ROW, read_at: '2026-08-30T09:00:00Z' }, error: null },
    ]);

    const result = await subject.markRead('user-42', 'n1');
    expect(result.read).toBe(true);
  });

  it('throws rather than reporting success when the markRead query fails', async () => {
    const { subject } = serviceWith([{ data: null, error: { message: 'connection reset' } }]);
    await expect(subject.markRead('user-42', 'n1')).rejects.toBeInstanceOf(DomainError);
  });
});
