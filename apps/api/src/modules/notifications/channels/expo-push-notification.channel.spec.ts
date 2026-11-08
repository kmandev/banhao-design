import { Logger } from '@nestjs/common';
import { ExpoPushNotificationChannel } from './expo-push-notification.channel';
import type { SupabaseService } from '../../../supabase/supabase.service';

type Result = { data: unknown; error: { message: string } | null };

function stub(results: Result[]) {
  const calls: { table: string; op: string; payload?: unknown; in?: unknown[] }[] = [];
  let i = 0;
  const next = () => results[i++] ?? { data: null, error: null };
  const admin = {
    from(table: string) {
      const call: { table: string; op: string; payload?: unknown; in?: unknown[] } = { table, op: 'select' };
      calls.push(call);
      const builder: Record<string, unknown> = {
        select: () => builder,
        update(payload: unknown) {
          call.op = 'update';
          call.payload = payload;
          return builder;
        },
        eq: () => builder,
        is: () => builder,
        in(_c: string, values: unknown[]) {
          call.in = values;
          return Promise.resolve(next());
        },
        returns: () => Promise.resolve(next()),
      };
      return builder;
    },
  };
  return { channel: new ExpoPushNotificationChannel({ admin } as unknown as SupabaseService), calls };
}

const INPUT = { notificationId: 'n1', recipientId: 'user-1', title: 'อาหารพร้อมแล้ว', body: 'ไปรับที่ร้านได้เลย', deepLink: null };

describe('ExpoPushNotificationChannel', () => {
  const realFetch = global.fetch;
  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('reports NO_TOKEN, and calls nobody, when the recipient has no active device', async () => {
    const { channel } = stub([{ data: [], error: null }]);
    global.fetch = jest.fn() as unknown as typeof fetch;

    await expect(channel.deliver(INPUT)).resolves.toEqual({ delivered: false, reason: 'NO_TOKEN' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends the chosen title and body to every active token through Expo', async () => {
    const { channel } = stub([{ data: [{ token: 'ExponentPushToken[a]' }, { token: 'ExponentPushToken[b]' }], error: null }]);
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{ status: 'ok' }, { status: 'ok' }] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(channel.deliver(INPUT)).resolves.toEqual({ delivered: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    expect(JSON.parse(init.body)).toEqual([
      { to: 'ExponentPushToken[a]', title: 'อาหารพร้อมแล้ว', body: 'ไปรับที่ร้านได้เลย', sound: 'default', data: { notificationId: 'n1' } },
      { to: 'ExponentPushToken[b]', title: 'อาหารพร้อมแล้ว', body: 'ไปรับที่ร้านได้เลย', sound: 'default', data: { notificationId: 'n1' } },
    ]);
  });

  it('revokes a token Expo reports as DeviceNotRegistered', async () => {
    const { channel, calls } = stub([
      { data: [{ token: 'ExponentPushToken[dead]' }, { token: 'ExponentPushToken[ok]' }], error: null },
      { data: null, error: null },
    ]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }, { status: 'ok' }] }),
    }) as unknown as typeof fetch;

    await expect(channel.deliver(INPUT)).resolves.toEqual({ delivered: true });
    const revoke = calls.find((c) => c.op === 'update');
    expect(revoke?.in).toEqual(['ExponentPushToken[dead]']);
  });

  it('reports a failure, never throws, when Expo is unreachable', async () => {
    const { channel } = stub([{ data: [{ token: 'ExponentPushToken[a]' }], error: null }]);
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    await expect(channel.deliver(INPUT)).resolves.toMatchObject({ delivered: false });
  });
});
