import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * One log line per request — V1.1 §11's "one line per request".
 *
 * Emitted on `finish`, so the line carries the status and the duration rather
 * than being written before the outcome is known. `JsonLogger` adds the
 * correlation id and the severity, which is why nothing here formats anything:
 * this middleware decides *what* is worth recording, not how it is rendered.
 *
 * **`route`, not `originalUrl`.** Express resolves `req.route.path` to the
 * pattern (`/api/v1/orders/:id/accept`), so log lines group by operation
 * instead of fragmenting across every order id, and no identifier is written
 * to the log by the path. A query string is never logged at all: the API takes
 * no sensitive query parameter today, and logging one is the standard way that
 * changes without anyone noticing.
 *
 * Severity follows the status class, so a 4xx is not an ERROR — a rejected
 * login is an ordinary outcome, and treating it as an error is how an error
 * log stops being read.
 */
@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('Request');

  use(req: Request, res: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const route = resolveRoute(req);
      const line = `${req.method} ${route} ${res.statusCode} ${durationMs.toFixed(1)}ms`;

      if (res.statusCode >= 500) {
        this.logger.error(line);
      } else if (res.statusCode >= 400) {
        this.logger.warn(line);
      } else {
        this.logger.log(line);
      }
    });

    next();
  }
}

/**
 * The matched route pattern, or the literal path when nothing matched.
 *
 * An unmatched request has no `req.route`, and its path is the only useful
 * thing to record — a flood of 404s on one path is exactly the kind of thing
 * this line exists to make visible. `req.path` excludes the query string.
 */
function resolveRoute(req: Request): string {
  const pattern = (req as Request & { route?: { path?: string } }).route?.path;
  if (typeof pattern === 'string' && pattern.length > 0) {
    return req.baseUrl ? `${req.baseUrl}${pattern}` : pattern;
  }
  return req.path;
}
