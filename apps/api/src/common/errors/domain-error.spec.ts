import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES, isErrorCode, type ErrorCode } from '@banhao/types';
import { DomainError, statusForErrorCode } from './domain-error';

/**
 * The error catalogue and its status map (Phase D / D-3 adds the cart codes).
 *
 * The important property is **totality**: `STATUS_BY_CODE` is typed as
 * `Record<ErrorCode, HttpStatus>`, so a code added to `@banhao/types` without a
 * status is a compile error rather than an `undefined` status at runtime. That
 * guarantee is a type-level one, and these tests verify the runtime side of it
 * — that the map really does answer for every code in the union.
 */

describe('error catalogue', () => {
  it('answers with a status for every code in the catalogue', () => {
    for (const code of ERROR_CODES) {
      const status = statusForErrorCode(code);
      expect(typeof status).toBe('number');
      expect(status).toBeGreaterThanOrEqual(400);
    }
  });

  it('has no duplicate codes', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});

describe('cart revalidation codes — D-3', () => {
  it.each(['PRICE_CHANGED', 'MIXED_RESTAURANT'])('%s is in the catalogue', (code) => {
    expect(isErrorCode(code)).toBe(true);
    expect(ERROR_CODES).toContain(code as ErrorCode);
  });

  it.each<[ErrorCode, HttpStatus]>([
    ['PRICE_CHANGED', HttpStatus.CONFLICT],
    ['MIXED_RESTAURANT', HttpStatus.CONFLICT],
  ])('%s maps to %i', (code, status) => {
    expect(statusForErrorCode(code)).toBe(status);
  });

  it('reports as a business-rule conflict, not a validation failure', () => {
    // The request was well-formed and the customer did nothing wrong — the
    // world moved underneath the cart. A 400 would misattribute that.
    for (const code of ['PRICE_CHANGED', 'MIXED_RESTAURANT'] as ErrorCode[]) {
      expect(statusForErrorCode(code)).not.toBe(HttpStatus.BAD_REQUEST);
    }
  });

  it('carries its code and structured details through DomainError', () => {
    const error = new DomainError('PRICE_CHANGED', {
      details: { menuItemId: 'mi-1', wasSatang: 6000, nowSatang: 6500 },
    });

    expect(error.code).toBe('PRICE_CHANGED');
    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    // Money travels in `details` as integer satang, never interpolated into a
    // message a client would have to parse.
    expect(error.details).toEqual({
      menuItemId: 'mi-1',
      wasSatang: 6000,
      nowSatang: 6500,
    });
  });

  it('defaults its developer-facing message to the code itself', () => {
    expect(new DomainError('MIXED_RESTAURANT').message).toBe('MIXED_RESTAURANT');
  });
});
