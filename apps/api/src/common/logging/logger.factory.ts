import { ConsoleLogger, type LoggerService, type LogLevel } from '@nestjs/common';
import { JsonLogger } from './json-logger';

/**
 * Structured JSON where a machine reads the logs, human-readable prose where a
 * person does.
 *
 * Cloud Run's log ingestion is the only consumer that matters in `production`,
 * and it wants one JSON object per line (see {@link JsonLogger}). A developer
 * tailing `pnpm dev` wants Nest's coloured output, and losing it would be a
 * real cost for no gain — nothing parses a local terminal.
 *
 * `test` gets the console logger too, so a failing spec still prints something
 * a human can read.
 */
export function createLogger(nodeEnv: 'development' | 'test' | 'production'): LoggerService {
  if (nodeEnv !== 'production') {
    return new ConsoleLogger();
  }

  return new JsonLogger(new Set(PRODUCTION_LEVELS));
}

/**
 * `debug` and `verbose` are off in production deliberately. Every one of them
 * is a log line billed by volume, and the two that carry operational meaning —
 * a warning and an error — are the two that get lost in the noise when
 * everything is emitted.
 */
const PRODUCTION_LEVELS: readonly LogLevel[] = ['fatal', 'error', 'warn', 'log'];
