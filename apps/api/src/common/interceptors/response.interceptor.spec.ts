import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';
import { IS_RAW_RESPONSE_KEY } from '../decorators/raw-response.decorator';

function contextWith(rawResponseMetadata: boolean | undefined): {
  context: ExecutionContext;
  handler: CallHandler;
} {
  const context = {
    getHandler: () => (rawResponseMetadata === undefined ? {} : { [IS_RAW_RESPONSE_KEY]: true }),
    getClass: () => ({}),
  } as unknown as ExecutionContext;

  const handler: CallHandler = { handle: () => of({ fine: true }) };
  return { context, handler };
}

/** Reflector reading metadata straight off the fake handler object above. */
class FakeReflector extends Reflector {
  override getAllAndOverride<T>(key: string, targets: unknown[]): T {
    for (const target of targets) {
      const value = (target as Record<string, unknown>)?.[key];
      if (value !== undefined) return value as T;
    }
    return undefined as T;
  }
}

describe('ResponseInterceptor', () => {
  it('wraps a normal response in the success envelope', (done) => {
    const interceptor = new ResponseInterceptor(new FakeReflector());
    const { context, handler } = contextWith(undefined);

    interceptor.intercept(context, handler).subscribe((result) => {
      expect(result).toEqual({ success: true, data: { fine: true } });
      done();
    });
  });

  it('passes a @RawResponse() route through untouched (DEC-APP-005)', (done) => {
    const interceptor = new ResponseInterceptor(new FakeReflector());
    const { context, handler } = contextWith(true);

    interceptor.intercept(context, handler).subscribe((result) => {
      expect(result).toEqual({ fine: true });
      expect(result).not.toHaveProperty('success');
      done();
    });
  });
});
