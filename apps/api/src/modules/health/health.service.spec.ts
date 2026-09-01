import { Logger } from '@nestjs/common';
import { HealthService } from './health.service';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * The three outcomes of the database ping, and the one rule that binds them:
 * a failing ping is a reported state, never a thrown error. `/health` answering
 * 500 would be indistinguishable to Cloud Run from a dead process.
 */

function serviceWith(limit: () => PromiseLike<unknown>): HealthService {
  const supabase = {
    admin: { from: () => ({ select: () => ({ limit }) }) },
  } as unknown as SupabaseService;

  return new HealthService(supabase);
}

describe('HealthService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('reports ok with a latency when the ping succeeds', async () => {
    const result = await serviceWith(() => Promise.resolve({ error: null })).check();

    expect(result.status).toBe('ok');
    expect(result.database.status).toBe('ok');
    expect(result.database.latencyMs).toEqual(expect.any(Number));
  });

  it('reports degraded, with no latency, on a PostgREST error', async () => {
    const result = await serviceWith(() =>
      Promise.resolve({ error: { message: 'relation does not exist' } }),
    ).check();

    expect(result.status).toBe('degraded');
    expect(result.database).toEqual({ status: 'unreachable' });
  });

  it('reports degraded rather than throwing when the client rejects', async () => {
    const result = await serviceWith(() =>
      Promise.reject(new Error('getaddrinfo ENOTFOUND')),
    ).check();

    expect(result.status).toBe('degraded');
    expect(result.database.status).toBe('unreachable');
  });

  it('gives up on a ping that never settles, instead of hanging the probe', async () => {
    jest.useFakeTimers();

    const pending = serviceWith(() => new Promise(() => undefined)).check();
    await jest.advanceTimersByTimeAsync(2_000);

    await expect(pending).resolves.toMatchObject({
      status: 'degraded',
      database: { status: 'unreachable' },
    });
  });

  it('logs the underlying failure, which the response never carries', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const result = await serviceWith(() =>
      Promise.resolve({ error: { message: 'connection refused to db-1' } }),
    ).check();

    expect(logged).toHaveBeenCalledWith(expect.stringContaining('db-1'));
    expect(JSON.stringify(result)).not.toContain('db-1');
  });

  it('always names the service, so a probe answer is attributable', async () => {
    const result = await serviceWith(() => Promise.resolve({ error: null })).check();

    expect(result.service).toBe('banhao-api');
    expect(result.timestamp).toEqual(expect.any(String));
  });
});
