import { SetMetadata } from '@nestjs/common';

export const IS_RAW_RESPONSE_KEY = 'isRawResponse';

/**
 * Marks a route as exempt from the global `{ success, data }` envelope
 * (DEC-APP-005).
 *
 * `ResponseInterceptor` wraps every response by default, which is correct for
 * BANHAO's own clients but wrong for a payment provider webhook: the provider
 * expects its own agreed response shape and status, and a wrapped `200` risks
 * it reading the call as a failure and retrying forever. Opt-out is explicit,
 * mirroring `@Public()` — the envelope stays on by default so a route can only
 * lose it on purpose.
 */
export const RawResponse = () => SetMetadata(IS_RAW_RESPONSE_KEY, true);
