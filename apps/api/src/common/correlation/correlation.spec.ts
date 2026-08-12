import type { NextFunction, Request, Response } from 'express';
import {
  CORRELATION_ID_HEADER,
  CORRELATION_ID_HEADER_LOWER,
  MAX_CORRELATION_ID_LENGTH,
  generateCorrelationId,
  getCorrelationId,
  isValidCorrelationId,
  resolveCorrelationId,
  runWithCorrelationId,
} from './correlation';
import { CorrelationMiddleware } from './correlation.middleware';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface Ran {
  headers: Record<string, string>;
  request: Request & { correlationId?: string };
  seenInContext: string | undefined;
  nextCalls: number;
}

/** Drives the middleware over a fake request and reports everything it did. */
function runMiddleware(incoming?: string | string[]): Ran {
  const headers: Record<string, string> = {};
  const request = {
    headers: incoming === undefined ? {} : { [CORRELATION_ID_HEADER_LOWER]: incoming },
  } as unknown as Request & { correlationId?: string };

  const response = {
    setHeader(name: string, value: string) {
      headers[name] = value;
      return this;
    },
  } as unknown as Response;

  const ran: Ran = { headers, request, seenInContext: undefined, nextCalls: 0 };

  const next: NextFunction = () => {
    ran.nextCalls += 1;
    // Captured inside the async store, the way a service would read it.
    ran.seenInContext = getCorrelationId();
  };

  new CorrelationMiddleware().use(request, response, next);
  return ran;
}

describe('correlation id', () => {
  describe('validation', () => {
    it.each(['9f3c', 'a-b_c', '0123456789abcdef', generateCorrelationId()])(
      'accepts the safe value %p',
      (value) => {
        expect(isValidCorrelationId(value)).toBe(true);
      },
    );

    it.each([
      ['empty', ''],
      ['a space', 'has space'],
      ['a carriage return', 'abc\r'],
      ['a line feed', 'abc\ndef'],
      ['a CRLF header injection', 'abc\r\nX-Admin: true'],
      ['a NUL byte', 'abc\u0000def'],
      ['a comma from repeated headers', 'abc, def'],
      ['a colon', 'abc:def'],
      ['a quote', 'abc"def'],
      ['non-ASCII', 'รหัส'],
      ['an ANSI escape', 'abc\u001b[31m'],
    ])('rejects %s', (_label, value) => {
      expect(isValidCorrelationId(value)).toBe(false);
    });

    it('rejects a value longer than the maximum', () => {
      expect(isValidCorrelationId('a'.repeat(MAX_CORRELATION_ID_LENGTH))).toBe(true);
      expect(isValidCorrelationId('a'.repeat(MAX_CORRELATION_ID_LENGTH + 1))).toBe(false);
    });

    it.each([[undefined], [null], [42], [{}], [['a', 'b']]])(
      'rejects the non-string %p',
      (value) => {
        expect(isValidCorrelationId(value)).toBe(false);
      },
    );
  });

  describe('generation', () => {
    it('generates a UUID v4', () => {
      expect(generateCorrelationId()).toMatch(UUID_V4);
    });

    it('generates a distinct id each time', () => {
      const ids = new Set(Array.from({ length: 100 }, generateCorrelationId));

      expect(ids.size).toBe(100);
    });

    it('generates ids that pass its own validation', () => {
      expect(isValidCorrelationId(generateCorrelationId())).toBe(true);
    });
  });

  describe('resolution', () => {
    it('adopts a valid inbound id so a trace survives an upstream hop', () => {
      expect(resolveCorrelationId('upstream-123')).toBe('upstream-123');
    });

    it('generates one when absent', () => {
      expect(resolveCorrelationId(undefined)).toMatch(UUID_V4);
    });

    it('replaces an unsafe inbound id rather than rejecting the request', () => {
      expect(resolveCorrelationId('bad\r\nvalue')).toMatch(UUID_V4);
      expect(resolveCorrelationId('x'.repeat(5000))).toMatch(UUID_V4);
    });
  });

  describe('async context', () => {
    it('exposes the id to code running inside it', () => {
      expect(runWithCorrelationId('cid-1', () => getCorrelationId())).toBe('cid-1');
    });

    it('survives an await boundary, the way a service call does', async () => {
      const seen = await runWithCorrelationId('cid-async', async () => {
        await Promise.resolve();
        return getCorrelationId();
      });

      expect(seen).toBe('cid-async');
    });

    it('is undefined outside a request', () => {
      expect(getCorrelationId()).toBeUndefined();
    });

    it('keeps concurrent requests isolated', async () => {
      const [a, b] = await Promise.all([
        runWithCorrelationId('cid-a', async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return getCorrelationId();
        }),
        runWithCorrelationId('cid-b', async () => getCorrelationId()),
      ]);

      expect(a).toBe('cid-a');
      expect(b).toBe('cid-b');
    });
  });

  describe('middleware', () => {
    it('generates an id when the request has no header', () => {
      const ran = runMiddleware();

      expect(ran.request.correlationId).toMatch(UUID_V4);
    });

    it('adopts a valid inbound header', () => {
      const ran = runMiddleware('inbound-abc');

      expect(ran.request.correlationId).toBe('inbound-abc');
    });

    it('publishes one identical id to request, header and async context', () => {
      const ran = runMiddleware('inbound-abc');

      expect(ran.request.correlationId).toBe('inbound-abc');
      expect(ran.headers[CORRELATION_ID_HEADER]).toBe('inbound-abc');
      expect(ran.seenInContext).toBe('inbound-abc');
    });

    it('echoes the generated id on the response header', () => {
      const ran = runMiddleware();

      expect(ran.headers[CORRELATION_ID_HEADER]).toBe(ran.request.correlationId);
    });

    it('never echoes an unsafe inbound value', () => {
      const ran = runMiddleware('evil\r\nX-Admin: true');

      expect(ran.headers[CORRELATION_ID_HEADER]).toMatch(UUID_V4);
      expect(ran.headers[CORRELATION_ID_HEADER]).not.toContain('X-Admin');
    });

    it('does not adopt an id joined from repeated headers', () => {
      const ran = runMiddleware('first, second');

      expect(ran.request.correlationId).toMatch(UUID_V4);
    });

    it('continues the chain exactly once', () => {
      expect(runMiddleware().nextCalls).toBe(1);
    });
  });

  describe('convention', () => {
    it('uses the header V1.1 §11 names', () => {
      expect(CORRELATION_ID_HEADER).toBe('X-Request-Id');
    });

    it('looks the header up in the lowercase form Node delivers', () => {
      expect(CORRELATION_ID_HEADER_LOWER).toBe('x-request-id');
    });
  });
});
