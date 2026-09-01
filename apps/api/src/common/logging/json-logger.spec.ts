import { Writable } from 'node:stream';
import type { LogLevel } from '@nestjs/common';
import { JsonLogger } from './json-logger';
import { runWithCorrelationId } from '../correlation/correlation';

/**
 * V1.1 §11's structured logging. What matters is that Cloud Logging can read
 * the line: one JSON object, a `severity` it recognises, a `message`, and the
 * correlation id that makes a user's complaint findable.
 */

const ALL_LEVELS: LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];

function capture(levels: LogLevel[] = ALL_LEVELS): {
  logger: JsonLogger;
  line: (index: number) => Record<string, unknown>;
  raw: () => string[];
} {
  const written: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      written.push(chunk.toString());
      callback();
    },
  });

  return {
    logger: new JsonLogger(new Set(levels), stream),
    line: (index: number) => {
      const raw = written[index];
      if (raw === undefined) throw new Error(`no log line at index ${index}`);
      return JSON.parse(raw) as Record<string, unknown>;
    },
    raw: () => written,
  };
}

describe('JsonLogger', () => {
  it('writes exactly one newline-terminated JSON object per call', () => {
    const { logger, raw } = capture();

    logger.log('first');
    logger.log('second');

    expect(raw()).toHaveLength(2);
    for (const line of raw()) {
      expect(line.endsWith('\n')).toBe(true);
      expect(line.slice(0, -1)).not.toContain('\n');
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it.each([
    ['fatal', 'CRITICAL'],
    ['error', 'ERROR'],
    ['warn', 'WARNING'],
    ['log', 'INFO'],
    ['debug', 'DEBUG'],
    ['verbose', 'DEBUG'],
  ] as const)('maps %s to the Cloud Logging severity %s', (level, severity) => {
    const { logger, line } = capture();

    logger[level]('m');

    expect(line(0).severity).toBe(severity);
  });

  it('drops a level that is not enabled, without serialising it', () => {
    const { logger, raw } = capture(['error', 'warn']);

    logger.debug('noisy');
    logger.log('also noisy');
    logger.warn('kept');

    expect(raw()).toHaveLength(1);
  });

  it('carries the correlation id of the request it was called inside', () => {
    const { logger, line } = capture();

    runWithCorrelationId('trace-abc', () => {
      logger.log('inside');
    });
    logger.log('outside');

    expect(line(0).correlationId).toBe('trace-abc');
    expect(line(1)).not.toHaveProperty('correlationId');
  });

  it('records the context Nest passes as the last argument', () => {
    const { logger, line } = capture();

    logger.log('started', 'Bootstrap');

    expect(line(0)).toMatchObject({ message: 'started', context: 'Bootstrap' });
  });

  it("splits an error's stack from its context, Nest's own positional convention", () => {
    const { logger, line } = capture();

    logger.error('it broke', 'Error: it broke\n    at somewhere', 'OrdersService');

    expect(line(0)).toMatchObject({
      severity: 'ERROR',
      message: 'it broke',
      stack: 'Error: it broke\n    at somewhere',
      context: 'OrdersService',
    });
  });

  it('treats a lone string on an error as the context, not as a stack', () => {
    const { logger, line } = capture();

    logger.error('it broke', 'OrdersService');

    expect(line(0)).toMatchObject({ context: 'OrdersService' });
    expect(line(0)).not.toHaveProperty('stack');
  });

  it('never renders an object message as [object Object]', () => {
    const { logger, line } = capture();

    logger.log({ deliveryId: 'delivery-1' });

    expect(line(0).message).toBe('{"deliveryId":"delivery-1"}');
  });

  it('reads an Error message rather than stringifying the instance', () => {
    const { logger, line } = capture();

    logger.error(new Error('connection reset'));

    expect(line(0).message).toBe('connection reset');
  });

  it('cannot have a second log line forged through a message', () => {
    const { logger, raw, line } = capture();

    logger.log('real\n{"severity":"ERROR","message":"forged"}');

    expect(raw()).toHaveLength(1);
    expect(line(0).message).toBe('real\n{"severity":"ERROR","message":"forged"}');
  });

  it('stamps an ISO-8601 timestamp', () => {
    const { logger, line } = capture();

    logger.log('m');

    expect(String(line(0).timestamp)).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });
});
