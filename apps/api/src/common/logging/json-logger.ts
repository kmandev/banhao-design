import type { LoggerService, LogLevel } from '@nestjs/common';
import { getCorrelationId } from '../correlation/correlation';

/**
 * One JSON object per line on stdout — V1.1 §11's "structured logging".
 *
 * Cloud Run forwards stdout to Cloud Logging, which parses a JSON line into a
 * structured entry and reads two field names in particular: `severity` for the
 * log level, and `message` for the summary shown in the log viewer. Nest's
 * default `ConsoleLogger` writes coloured prose instead, so every entry arrives
 * as `DEFAULT` severity with ANSI escapes embedded in the text — an error is
 * indistinguishable from a debug line, and no field is filterable.
 *
 * Each line also carries `correlationId`, read from the async store the
 * correlation middleware established, so the id a user quotes to support
 * selects exactly the lines belonging to their request:
 * `jsonPayload.correlationId="…"`.
 *
 * Deliberately not a logging library. One class, no transports, no formatters
 * and no dependency — V1.1 §11 rules out a metrics or aggregation stack for V1,
 * and this is the whole of what the platform needs to read the logs properly.
 */

/** Cloud Logging's `LogSeverity` names, for the levels Nest actually emits. */
const SEVERITY_BY_LEVEL: Record<LogLevel, string> = {
  fatal: 'CRITICAL',
  error: 'ERROR',
  warn: 'WARNING',
  log: 'INFO',
  debug: 'DEBUG',
  verbose: 'DEBUG',
};

interface LogLine {
  severity: string;
  message: string;
  timestamp: string;
  context?: string;
  correlationId?: string;
  stack?: string;
}

export class JsonLogger implements LoggerService {
  /**
   * @param levels The levels to emit, in Nest's own vocabulary. Anything absent
   *   is dropped without being serialised.
   * @param stream Injectable for tests. Defaults to stdout — including for
   *   errors, because Cloud Logging reads severity from the payload and
   *   splitting across stderr only duplicates that classification in a second,
   *   less reliable place.
   */
  constructor(
    private readonly levels: ReadonlySet<LogLevel>,
    private readonly stream: NodeJS.WritableStream = process.stdout,
  ) {}

  log(message: unknown, ...rest: unknown[]): void {
    this.write('log', message, rest);
  }

  error(message: unknown, ...rest: unknown[]): void {
    this.write('error', message, rest);
  }

  warn(message: unknown, ...rest: unknown[]): void {
    this.write('warn', message, rest);
  }

  debug(message: unknown, ...rest: unknown[]): void {
    this.write('debug', message, rest);
  }

  verbose(message: unknown, ...rest: unknown[]): void {
    this.write('verbose', message, rest);
  }

  fatal(message: unknown, ...rest: unknown[]): void {
    this.write('fatal', message, rest);
  }

  private write(level: LogLevel, message: unknown, rest: unknown[]): void {
    if (!this.levels.has(level)) {
      return;
    }

    const line: LogLine = {
      severity: SEVERITY_BY_LEVEL[level],
      message: stringify(message),
      timestamp: new Date().toISOString(),
    };

    // Nest's own call convention: `logger.error(message, stack, context)` for
    // errors, `logger.log(message, context)` for everything else. The context
    // is always the last string argument, and an error's stack is the first.
    const { context, stack } = splitRest(level, rest);
    if (context !== undefined) line.context = context;
    if (stack !== undefined) line.stack = stack;

    const correlationId = getCorrelationId();
    if (correlationId !== undefined) line.correlationId = correlationId;

    // JSON.stringify escapes every newline and quote, so no log line can be
    // forged by anything that reaches a message — the same property the
    // correlation id's charset restriction gives that field.
    this.stream.write(`${JSON.stringify(line)}\n`);
  }
}

function splitRest(level: LogLevel, rest: unknown[]): { context?: string; stack?: string } {
  const strings = rest.filter((value): value is string => typeof value === 'string');

  if (level === 'error' || level === 'fatal') {
    // [stack, context] when both are present, [context] when Nest was called
    // with only one — an ambiguity Nest itself resolves by position, so this
    // does the same.
    if (strings.length >= 2) {
      return { stack: strings[0], context: strings[strings.length - 1] };
    }
    return { context: strings[0] };
  }

  return { context: strings[strings.length - 1] };
}

/**
 * A message is usually a string; Nest also permits an object, and services
 * occasionally pass an `Error`. Never `[object Object]`, which is the one
 * outcome that makes a log line useless.
 */
function stringify(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message instanceof Error) return message.message;
  try {
    return JSON.stringify(message) ?? String(message);
  } catch {
    return String(message);
  }
}
