import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  CORRELATION_ID_HEADER,
  CORRELATION_ID_HEADER_LOWER,
  type CorrelatedRequest,
  resolveCorrelationId,
  runWithCorrelationId,
} from './correlation';

/**
 * Establishes the correlation id for one request, before anything else runs.
 *
 * Middleware is the earliest hook Nest offers — ahead of guards, pipes,
 * interceptors and controllers — so an authentication rejection, an
 * authorization rejection and an unmatched route are all correlated just as
 * well as a successful call.
 *
 * The id is published three ways, each for a different reader:
 *
 *   - on the request object, for `HttpExceptionFilter`;
 *   - in the async store, for services that must log or persist it without
 *     taking it as a parameter (V1.1 §11 sends it to the `correlation_id`
 *     columns from Phase E onward);
 *   - on the response header, so a successful request is traceable too —
 *     a success envelope has nowhere else to carry it.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId = resolveCorrelationId(req.headers[CORRELATION_ID_HEADER_LOWER]);

    (req as Request & CorrelatedRequest).correlationId = correlationId;

    // Safe by construction: resolveCorrelationId only ever yields the validated
    // charset, so no inbound value can inject a header or a log line.
    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    runWithCorrelationId(correlationId, next);
  }
}
