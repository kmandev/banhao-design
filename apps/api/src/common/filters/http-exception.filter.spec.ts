import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ApiResponse } from '@banhao/types';
import { HttpExceptionFilter } from './http-exception.filter';
import { DomainError } from '../errors/domain-error';
import { runWithCorrelationId } from '../correlation/correlation';

interface Captured {
  status: number;
  body: ApiResponse<never>;
}

/**
 * Minimal ArgumentsHost double that records what the filter wrote.
 *
 * Assertions below are on STRUCTURE — `code`, `details`, status — never on
 * user-facing prose, because prose is not part of the contract (V1.1 §10).
 *
 * The request double carries `correlationId` the way CorrelationMiddleware sets
 * it; omitting it models a request that never passed through the middleware.
 */
function captureResponse(correlationId?: string): { host: ArgumentsHost; captured: Captured } {
  const captured = { status: 0, body: undefined as unknown as ApiResponse<never> };

  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: ApiResponse<never>) {
      captured.body = body;
      return this;
    },
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ correlationId }),
    }),
  } as unknown as ArgumentsHost;

  return { host, captured: captured as Captured };
}

function run(exception: unknown, correlationId?: string): Captured {
  const { host, captured } = captureResponse(correlationId);
  new HttpExceptionFilter().catch(exception, host);
  return captured;
}

function errorOf(captured: Captured) {
  if (captured.body.success) throw new Error('expected a failure envelope');
  return captured.body.error;
}

describe('HttpExceptionFilter', () => {
  describe('semantic domain errors', () => {
    it('preserves the semantic code from a DomainError', () => {
      const captured = run(new DomainError('OFFER_TAKEN'));

      expect(errorOf(captured).code).toBe('OFFER_TAKEN');
      expect(captured.status).toBe(HttpStatus.CONFLICT);
    });

    it('distinguishes two different 409 conditions by code', () => {
      const taken = run(new DomainError('OFFER_TAKEN'));
      const transition = run(new DomainError('INVALID_TRANSITION'));

      // Same transport status...
      expect(taken.status).toBe(HttpStatus.CONFLICT);
      expect(transition.status).toBe(HttpStatus.CONFLICT);

      // ...different semantic meaning. This is the point of A-3.
      expect(errorOf(taken).code).toBe('OFFER_TAKEN');
      expect(errorOf(transition).code).toBe('INVALID_TRANSITION');
      expect(errorOf(taken).code).not.toBe(errorOf(transition).code);
    });

    it('distinguishes a third 409 condition, and never collapses to CONFLICT', () => {
      const codes = (['OFFER_TAKEN', 'NOT_RELEASABLE', 'ACCEPT_WINDOW_EXPIRED'] as const).map(
        (code) => errorOf(run(new DomainError(code))).code,
      );

      expect(new Set(codes).size).toBe(3);
      expect(codes).not.toContain('CONFLICT');
    });

    it('carries structured details through untouched', () => {
      const captured = run(
        new DomainError('NOT_RELEASABLE', { details: { deliveryId: 'd-42', attempt: 2 } }),
      );

      expect(errorOf(captured).details).toEqual({ deliveryId: 'd-42', attempt: 2 });
    });

    it('defaults the developer-facing message to the code, never to UI copy', () => {
      const captured = run(new DomainError('OFFER_TAKEN'));

      expect(errorOf(captured).message).toBe('OFFER_TAKEN');
    });

    it('maps authorization conditions to 403, not 401', () => {
      const captured = run(new DomainError('NOT_RESTAURANT_MEMBER'));

      expect(captured.status).toBe(HttpStatus.FORBIDDEN);
      expect(errorOf(captured).code).toBe('NOT_RESTAURANT_MEMBER');
    });

    it('maps authentication conditions to 401', () => {
      const captured = run(new DomainError('TOKEN_EXPIRED'));

      expect(captured.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(errorOf(captured).code).toBe('TOKEN_EXPIRED');
    });
  });

  describe('generic HTTP status fallback', () => {
    it.each([
      [new UnauthorizedException(), HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED'],
      [new ForbiddenException(), HttpStatus.FORBIDDEN, 'FORBIDDEN'],
      [new NotFoundException(), HttpStatus.NOT_FOUND, 'NOT_FOUND'],
      [new BadRequestException(), HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED'],
      [new ConflictException(), HttpStatus.CONFLICT, 'CONFLICT'],
      [new NotImplementedException(), HttpStatus.NOT_IMPLEMENTED, 'NOT_IMPLEMENTED'],
    ])('classifies %#: status %s as %s', (exception, status, code) => {
      const captured = run(exception);

      expect(captured.status).toBe(status);
      expect(errorOf(captured).code).toBe(code);
    });
  });

  describe('validation errors', () => {
    it('preserves field issues as structured details', () => {
      const captured = run(new BadRequestException(['phone must be E.164', 'name is required']));

      expect(captured.status).toBe(HttpStatus.BAD_REQUEST);
      expect(errorOf(captured).code).toBe('VALIDATION_FAILED');
      expect(errorOf(captured).details).toEqual({
        issues: ['phone must be E.164', 'name is required'],
      });
    });

    it('passes an explicit details object straight through', () => {
      const captured = run(
        new BadRequestException({ message: 'invalid', details: { phone: ['required'] } }),
      );

      expect(errorOf(captured).details).toEqual({ phone: ['required'] });
    });
  });

  describe('unexpected errors', () => {
    it('reports a non-HttpException generically as INTERNAL_ERROR', () => {
      const captured = run(new Error('connection pool exhausted at 10.0.0.4:5432'));

      expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(errorOf(captured).code).toBe('INTERNAL_ERROR');
    });

    it('never leaks internal detail from an unexpected error', () => {
      const captured = run(new Error('password=hunter2 at 10.0.0.4:5432'));
      const serialised = JSON.stringify(captured.body);

      expect(serialised).not.toContain('hunter2');
      expect(serialised).not.toContain('10.0.0.4');
    });
  });

  describe('canonical contract (A-2 compatibility)', () => {
    it('always produces the { success: false, error: { code } } envelope', () => {
      const captured = run(new DomainError('ITEM_UNAVAILABLE'));

      expect(captured.body.success).toBe(false);
      expect(typeof errorOf(captured).code).toBe('string');
    });

    it('leaves message optional — omitting it is valid', () => {
      // A DomainError constructed without a message still yields a well-formed
      // envelope; `code` alone is the contract.
      const error = errorOf(run(new DomainError('RESTAURANT_CLOSED')));

      expect(error.code).toBe('RESTAURANT_CLOSED');
      expect(error.details).toBeUndefined();
    });

    it('omits correlationId when the request carries none', () => {
      expect(errorOf(run(new DomainError('OFFER_TAKEN'))).correlationId).toBeUndefined();
    });

    it('surfaces the request correlation id on a domain error', () => {
      expect(errorOf(run(new DomainError('OFFER_TAKEN'), 'cid-domain')).correlationId).toBe(
        'cid-domain',
      );
    });

    it('surfaces the correlation id on every error tier', () => {
      // Tier 1 DomainError, tier 2 HttpException, tier 3 unexpected — a user can
      // quote an id no matter which path produced the failure.
      expect(errorOf(run(new DomainError('OFFER_TAKEN'), 'cid-1')).correlationId).toBe('cid-1');
      expect(errorOf(run(new UnauthorizedException(), 'cid-2')).correlationId).toBe('cid-2');
      expect(errorOf(run(new Error('boom'), 'cid-3')).correlationId).toBe('cid-3');
    });

    it('falls back to the async store when the request carries no id', () => {
      const captured = runWithCorrelationId('cid-async', () => run(new DomainError('OFFER_TAKEN')));

      expect(errorOf(captured).correlationId).toBe('cid-async');
    });

    it('prefers the request id over the async store', () => {
      const captured = runWithCorrelationId('cid-async', () =>
        run(new DomainError('OFFER_TAKEN'), 'cid-request'),
      );

      expect(errorOf(captured).correlationId).toBe('cid-request');
    });

    it('keeps code, details and correlationId together on one error', () => {
      const error = errorOf(
        run(new DomainError('NOT_RELEASABLE', { details: { deliveryId: 'd-9' } }), 'cid-all'),
      );

      expect(error).toMatchObject({
        code: 'NOT_RELEASABLE',
        details: { deliveryId: 'd-9' },
        correlationId: 'cid-all',
      });
    });

    it('emits no Thai user-facing copy anywhere in the envelope', () => {
      const samples = [
        run(new DomainError('OFFER_TAKEN')),
        run(new DomainError('RESTAURANT_CLOSED', { details: { restaurantId: 'r-1' } })),
        run(new UnauthorizedException()),
        run(new BadRequestException(['invalid'])),
        run(new Error('boom')),
      ];

      // Thai script block U+0E00–U+0E7F must not appear: the API returns codes,
      // clients own the copy.
      for (const sample of samples) {
        expect(JSON.stringify(sample.body)).not.toMatch(/[฀-๿]/);
      }
    });
  });
});
