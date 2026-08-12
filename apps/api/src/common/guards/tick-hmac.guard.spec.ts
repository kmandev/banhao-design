import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { Request } from 'express';
import { TICK_SIGNATURE_HEADER_LOWER, TickHmacGuard } from './tick-hmac.guard';

const SECRET = 'test-tick-secret';

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(Buffer.from(body, 'utf8')).digest('hex');
}

function contextFor(request: Partial<Request>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function requestWith(body: string, signature?: string, extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extraHeaders };
  if (signature !== undefined) headers[TICK_SIGNATURE_HEADER_LOWER] = signature;
  return { rawBody: Buffer.from(body, 'utf8'), headers } as unknown as Request;
}

describe('TickHmacGuard', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
      SUPABASE_JWT_SECRET: 'jwt',
      INTERNAL_TICK_SECRET: SECRET,
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('accepts a request signed with the correct secret over the exact body', () => {
    const body = '{"tick":true}';
    const guard = new TickHmacGuard();

    expect(guard.canActivate(contextFor(requestWith(body, sign(body))))).toBe(true);
  });

  it('rejects a missing signature header', () => {
    const guard = new TickHmacGuard();

    expect(() => guard.canActivate(contextFor(requestWith('{}')))).toThrow(UnauthorizedException);
  });

  it('rejects an incorrect signature', () => {
    const guard = new TickHmacGuard();
    const wrong = sign('{}').replace(/^./, (c) => (c === 'a' ? 'b' : 'a'));

    expect(() => guard.canActivate(contextFor(requestWith('{}', wrong)))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a signature computed with the wrong secret', () => {
    const guard = new TickHmacGuard();
    const body = '{}';

    expect(() =>
      guard.canActivate(contextFor(requestWith(body, sign(body, 'someone-elses-secret')))),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a malformed (non-hex) signature', () => {
    const guard = new TickHmacGuard();

    expect(() =>
      guard.canActivate(contextFor(requestWith('{}', 'not-hex-at-all!!'))),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a wrong-length signature, even if it is valid hex', () => {
    const guard = new TickHmacGuard();
    const tooShort = sign('{}').slice(0, 32); // valid hex, half the required length

    expect(() => guard.canActivate(contextFor(requestWith('{}', tooShort)))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an oversized signature', () => {
    const guard = new TickHmacGuard();
    const tooLong = sign('{}') + sign('{}');

    expect(() => guard.canActivate(contextFor(requestWith('{}', tooLong)))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects when rawBody is missing entirely, without falling back to a parsed body', () => {
    const guard = new TickHmacGuard();
    const request = {
      rawBody: undefined,
      headers: { [TICK_SIGNATURE_HEADER_LOWER]: sign('{}') },
      body: { tick: true }, // a parsed body may exist; must not be used
    } as unknown as Request;

    expect(() => guard.canActivate(contextFor(request))).toThrow(UnauthorizedException);
  });

  it('rejects an empty rawBody', () => {
    const guard = new TickHmacGuard();
    const request = {
      rawBody: Buffer.alloc(0),
      headers: { [TICK_SIGNATURE_HEADER_LOWER]: sign('') },
    } as unknown as Request;

    expect(() => guard.canActivate(contextFor(request))).toThrow(UnauthorizedException);
  });

  it('rejects a signature computed over a different body than the one sent', () => {
    // Proves verification runs against req.rawBody, not any other
    // representation — signing "{}" then sending a modified body must fail.
    const guard = new TickHmacGuard();
    const signatureForOriginal = sign('{"amount":1}');

    expect(() =>
      guard.canActivate(contextFor(requestWith('{"amount":999}', signatureForOriginal))),
    ).toThrow(UnauthorizedException);
  });

  it('gives every rejection the same message, not a hint about which check failed', () => {
    const guard = new TickHmacGuard();
    const cases = [
      requestWith('{}'), // missing signature
      requestWith('{}', 'zz'.repeat(32)), // wrong digest, valid shape
      requestWith('{}', 'not-hex'), // malformed
    ];

    const messages = cases.map((request) => {
      try {
        guard.canActivate(contextFor(request));
        return null;
      } catch (error) {
        return (error as Error).message;
      }
    });

    expect(new Set(messages).size).toBe(1);
  });

  it('never includes the secret in a thrown error', () => {
    const guard = new TickHmacGuard();

    try {
      guard.canActivate(contextFor(requestWith('{}')));
    } catch (error) {
      expect((error as Error).message).not.toContain(SECRET);
      expect(JSON.stringify(error)).not.toContain(SECRET);
    }
  });
});
