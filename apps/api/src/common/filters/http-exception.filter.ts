import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiError, ApiResponse, ErrorCode } from '@banhao/types';
import { DomainError } from '../errors/domain-error';

/**
 * Renders every error in the shared { success: false, error } envelope.
 *
 * Three tiers, most specific first:
 *
 *   1. `DomainError` — carries its own semantic code and structured details.
 *      This is the intended path for anything the domain decides.
 *   2. Any other `HttpException` — no semantic code available, so the status is
 *      classified into a generic fallback code. Correct for framework-raised
 *      errors (a 404 from an unmatched route), and a smell anywhere else.
 *   3. Anything else — logged in full, reported as a generic `INTERNAL_ERROR`.
 *      Internal details must not leak to a client of a payments system.
 *
 * `error.code` is the contract; `message` is a developer-facing English default
 * for logs and is never what a client renders (V1.1 §10). No user-facing copy —
 * Thai or otherwise — is produced here.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    // 1. A domain condition that named itself.
    if (exception instanceof DomainError) {
      this.send(response, exception.getStatus(), {
        code: exception.code,
        details: exception.details,
        message: exception.message,
      });
      return;
    }

    // 2. A framework or generic HTTP exception — classify by status.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      this.send(response, status, {
        code: this.fallbackCodeFor(status),
        details: this.detailsFrom(payload),
        message: this.messageFrom(payload, exception.message),
      });
      return;
    }

    // 3. Unexpected. Log everything, tell the client nothing specific.
    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : String(exception),
    );

    this.send(response, HttpStatus.INTERNAL_SERVER_ERROR, {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }

  private send(response: Response, status: number, error: ApiError): void {
    const body: ApiResponse<never> = { success: false, error };
    response.status(status).json(body);
  }

  private messageFrom(payload: string | object, fallback: string): string {
    if (typeof payload === 'string') return payload;
    if (typeof payload === 'object' && payload !== null && 'message' in payload) {
      const message = (payload as { message: unknown }).message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join('; ');
    }
    return fallback;
  }

  /**
   * Preserves validation output as structured data rather than only as prose.
   *
   * Nest's ValidationPipe reports field errors as a string array. Flattening
   * that into one sentence loses the per-issue structure a client needs to
   * render inline field errors, so it is surfaced under `details.issues` as
   * well as in the developer-facing message.
   */
  private detailsFrom(payload: string | object): Record<string, unknown> | undefined {
    if (typeof payload !== 'object' || payload === null) return undefined;

    if ('details' in payload) {
      const details = (payload as { details: unknown }).details;
      if (typeof details === 'object' && details !== null) {
        return details as Record<string, unknown>;
      }
    }

    if ('message' in payload) {
      const message = (payload as { message: unknown }).message;
      if (Array.isArray(message)) {
        return { issues: message };
      }
    }

    return undefined;
  }

  /**
   * Generic classification for exceptions with no semantic code of their own.
   *
   * Returning `ErrorCode` keeps this honest: every fallback must exist in the
   * shared catalogue. A domain condition should never rely on this — throw a
   * `DomainError` so 409s stay distinguishable from one another.
   */
  private fallbackCodeFor(status: number): ErrorCode {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION_FAILED';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.NOT_IMPLEMENTED:
        return 'NOT_IMPLEMENTED';
      default:
        return 'INTERNAL_ERROR';
    }
  }
}
