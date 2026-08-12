import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import type { ApiResponse } from '@banhao/types';
import { IS_RAW_RESPONSE_KEY } from '../decorators/raw-response.decorator';

/**
 * Wraps every successful response in the shared { success: true, data } envelope
 * so @banhao/api-client can unwrap uniformly across all four apps.
 *
 * Routes marked `@RawResponse()` are passed through untouched (DEC-APP-005) —
 * a payment provider's webhook contract is not ours to shape.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T> | T> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T> | T> {
    const isRawResponse = this.reflector.getAllAndOverride<boolean>(IS_RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isRawResponse) {
      return next.handle();
    }

    return next.handle().pipe(map((data) => ({ success: true as const, data })));
  }
}
