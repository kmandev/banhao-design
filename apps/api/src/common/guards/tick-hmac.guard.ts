import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { loadServerEnv } from '@banhao/config';

/**
 * Authenticates `POST /internal/tick` (DEC-APP-010).
 *
 * This route has no Supabase user behind it — it is called by a scheduler, not
 * a person — so it is `@Public()` and relies entirely on this guard instead of
 * `SupabaseAuthGuard`. `@Public()` alone would leave it open to anyone; this is
 * the guard that actually authenticates the caller.
 *
 * **Protocol.** The header named {@link TICK_SIGNATURE_HEADER} carries
 * lowercase hex `HMAC-SHA256(INTERNAL_TICK_SECRET, rawBody)` — 64 hex
 * characters, computed over the *exact* request bytes. Never over a
 * JSON.parse → JSON.stringify round trip: that can reorder keys or normalise
 * whitespace, changing the bytes the caller actually signed. `rawBody` is the
 * same `req.rawBody` Buffer DEC-APP-005 already wires up for the webhook route
 * (`main.ts` / `worker.ts` both boot with `{ rawBody: true }`).
 *
 * **Failure is uniform.** Missing body, missing header, malformed encoding, or
 * a wrong digest are all reported as the same rejection — this guard does not
 * tell an attacker which check failed, and the digest comparison itself is
 * constant-time (`timingSafeEqual`) so a wrong guess can't be timed byte by
 * byte. No replay/timestamp protection is implemented — V1.1 does not specify
 * a nonce/timestamp scheme for this endpoint, so none is invented here; it is
 * deferred as a documented future hardening item, not a silent gap.
 */
@Injectable()
export class TickHmacGuard implements CanActivate {
  private readonly secret: string;

  constructor() {
    this.secret = loadServerEnv().internalTickSecret;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    // Fail closed on a missing raw body rather than falling back to Nest's
    // parsed JSON body — a parsed-and-reserialized body is not the bytes the
    // caller signed, so there would be nothing correct to verify against.
    const rawBody = request.rawBody;
    if (!rawBody || rawBody.length === 0) {
      this.reject();
    }

    const signature = this.signatureHeader(request);
    if (!signature) {
      this.reject();
    }

    const expected = createHmac('sha256', this.secret).update(rawBody).digest();
    const received = this.decodeSignature(signature, expected.length);
    if (!received) {
      this.reject();
    }

    if (!timingSafeEqual(received, expected)) {
      this.reject();
    }

    return true;
  }

  private signatureHeader(request: Request): string | undefined {
    const value = request.headers[TICK_SIGNATURE_HEADER_LOWER];
    return typeof value === 'string' ? value : undefined;
  }

  /**
   * Hex-decodes a signature, but only if it is *exactly* `expectedByteLength`
   * bytes of valid hex. `Buffer.from(str, 'hex')` silently truncates at the
   * first invalid character rather than throwing, which could otherwise turn
   * a malformed value into a shorter buffer that happens to pass a naive
   * length check — validating the shape up front removes that possibility
   * entirely, and guarantees `timingSafeEqual` is only ever called on two
   * equal-length buffers (it throws on a length mismatch, which would leak
   * that fact through the exception path).
   */
  private decodeSignature(value: string, expectedByteLength: number): Buffer | undefined {
    const hexPattern = new RegExp(`^[0-9a-f]{${expectedByteLength * 2}}$`, 'i');
    if (!hexPattern.test(value)) {
      return undefined;
    }
    return Buffer.from(value, 'hex');
  }

  /** One rejection path, one message — see the class doc on uniform failure. */
  private reject(): never {
    throw new UnauthorizedException('Tick request rejected');
  }
}

/** The header a tick caller signs into. Canonical casing, for docs and tests. */
export const TICK_SIGNATURE_HEADER = 'X-Tick-Signature';

/** Node lowercases incoming header names; this is the lookup key. */
export const TICK_SIGNATURE_HEADER_LOWER = TICK_SIGNATURE_HEADER.toLowerCase();
