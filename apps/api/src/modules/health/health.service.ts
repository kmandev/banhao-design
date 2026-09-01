import { Injectable, Logger } from '@nestjs/common';
import type { DatabaseHealth, HealthResponse } from '@banhao/types';
import { SupabaseService } from '../../supabase/supabase.service';

/**
 * `GET /health`'s answer, including the database ping V1.1 §11 asks for.
 *
 * Without the ping, the probe proves only that a Node process is accepting
 * connections — which is true of an instance that cannot serve a single real
 * request because its database is unreachable.
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async check(): Promise<HealthResponse> {
    const database = await this.pingDatabase();

    return {
      status: database.status === 'ok' ? 'ok' : 'degraded',
      service: 'banhao-api',
      version: process.env.npm_package_version ?? '0.1.0',
      timestamp: new Date().toISOString(),
      database,
    };
  }

  /**
   * The cheapest round trip that proves PostgREST answered: a `HEAD` against
   * `profiles` with no rows returned and no count computed. It reads no data,
   * so the probe cannot leak anything and cannot become slow as a table grows.
   *
   * Bounded by {@link PING_TIMEOUT_MS} because a probe that hangs is worse than
   * one that fails — Cloud Run's own health check would time out first, and the
   * body would never say why.
   */
  private async pingDatabase(): Promise<DatabaseHealth> {
    const startedAt = process.hrtime.bigint();

    try {
      const { error } = await withTimeout(
        this.supabase.admin.from('profiles').select('id', { head: true, count: undefined }).limit(1),
        PING_TIMEOUT_MS,
      );

      if (error) {
        this.logger.error(`Health ping failed: ${error.message}`);
        return { status: 'unreachable' };
      }

      return { status: 'ok', latencyMs: elapsedMs(startedAt) };
    } catch (cause) {
      // Never rethrow: a failed ping is a reported state, not a 500. The
      // message is logged and deliberately not returned — the same rule the
      // exception filter follows for every other internal error.
      this.logger.error(`Health ping failed: ${String(cause)}`);
      return { status: 'unreachable' };
    }
  }
}

/** Generous enough for a cold PostgREST connection, short enough to answer a probe. */
const PING_TIMEOUT_MS = 2_000;

function elapsedMs(startedAt: bigint): number {
  return Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
}

function withTimeout<T>(work: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ping exceeded ${ms}ms`)), ms);
    // `unref` so a pending timer never holds the process open — the tick
    // worker and the test runner both exit on an idle event loop.
    timer.unref?.();

    void Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
