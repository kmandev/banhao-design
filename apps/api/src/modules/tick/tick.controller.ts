import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { TickHmacGuard } from '../../common/guards/tick-hmac.guard';

export interface TickAcceptedResponse {
  accepted: true;
}

/**
 * `POST /internal/tick` — DEC-APP-010, transport + security boundary only.
 *
 * `@Public()` opts this route out of `SupabaseAuthGuard` (there is no Supabase
 * user behind a scheduler call); `TickHmacGuard` is what actually authenticates
 * it. The two are not redundant — removing either would either lock a
 * scheduler out (no user JWT to present) or leave the route unauthenticated
 * (`@Public()` alone grants nothing).
 *
 * This handler does the minimum true statement it can make: an authenticated
 * tick arrived. It does not drain `outbox`, run `jobs`, process
 * `payment_events`, expire QR attempts, or reconcile the ledger — those are
 * later phases' work (Phase F/G/H), attached behind this same guard once their
 * domains exist. Uses the normal `{ success, data }` envelope: unlike the
 * webhook route (DEC-APP-005), this is BANHAO's own internal API, not a
 * third-party contract to preserve verbatim.
 */
@Controller('internal/tick')
export class TickController {
  @Public()
  @UseGuards(TickHmacGuard)
  @Post()
  @HttpCode(200)
  @ApiExcludeEndpoint() // Internal-only; not part of the public OpenAPI surface.
  handle(): TickAcceptedResponse {
    return { accepted: true };
  }
}
