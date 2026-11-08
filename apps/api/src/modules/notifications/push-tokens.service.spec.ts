import { Logger } from '@nestjs/common';
import { PushTokensService } from './push-tokens.service';
import type { SupabaseService } from '../../supabase/supabase.service';

function stub(result: { error: { message: string } | null } = { error: null }) {
  const calls: { op: string; payload?: unknown; options?: unknown; eq: Record<string, unknown> }[] = [];
  const admin = {
    from() {
      const call: { op: string; payload?: unknown; options?: unknown; eq: Record<string, unknown> } = { op: '', eq: {} };
      calls.push(call);
      const builder: Record<string, unknown> = {
        upsert(payload: unknown, options: unknown) {
          call.op = 'upsert';
          call.payload = payload;
          call.options = options;
          return Promise.resolve(result);
        },
        update(payload: unknown) {
          call.op = 'update';
          call.payload = payload;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.eq[column] = value;
          return builder;
        },
        is: () => Promise.resolve(result),
      };
      return builder;
    },
  };
  return { service: new PushTokensService({ admin } as unknown as SupabaseService), calls };
}

describe('PushTokensService', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('registers the token under the caller, keyed on the token, clearing any revocation', async () => {
    const { service, calls } = stub();
    await service.register('user-1', { token: 'ExponentPushToken[a]', platform: 'ios', app: 'customer' });

    expect(calls[0]?.payload).toMatchObject({ user_id: 'user-1', token: 'ExponentPushToken[a]', platform: 'ios', app: 'customer', revoked_at: null });
    expect(calls[0]?.options).toEqual({ onConflict: 'token' });
  });

  it('revokes only the caller\'s own token', async () => {
    const { service, calls } = stub();
    await service.revoke('user-1', 'ExponentPushToken[a]');

    expect(calls[0]?.eq).toEqual({ token: 'ExponentPushToken[a]', user_id: 'user-1' });
  });

  it('fails as INTERNAL_ERROR on a write error', async () => {
    const { service } = stub({ error: { message: 'boom' } });
    await expect(service.register('user-1', { token: 'ExponentPushToken[a]', platform: 'ios', app: 'customer' })).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
