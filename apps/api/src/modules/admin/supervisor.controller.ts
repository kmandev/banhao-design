import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { failDeliverySchema, resolveSupervisorCaseSchema } from '@banhao/validation';
import type {
  AwaitingFailureListResponse,
  FailDeliveryResponse,
  ResolveSupervisorCaseResponse,
  SupervisorIdentityResponse,
  SupervisorCaseDetailResponse,
  SupervisorCaseListResponse,
} from '@banhao/validation';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { parseOrThrow } from '../../common/validation/parse';
import type { AuthenticatedUser } from '../../common/types';
import { SupervisorCaseService } from './supervisor-case.service';
import { DeliveryFailureService } from './delivery-failure.service';

/**
 * Human Supervisor console — Phase I, screens S-02, S-03 and S-06 of the AI
 * Operations design package § 09.
 *
 * ## Authorization is reused, not invented
 *
 * `@Roles('OPERATOR', 'ADMIN')` resolves against `platform_staff` through
 * `CapabilitiesService`, per request and uncached (DEC-033 / DEC-APP-004).
 * There is no new role, no new permission model and no new table — the Admin
 * design package § 02 is explicit that the two staff roles are all there are.
 * A revoked grant therefore takes effect on the next request, and the server
 * refuses regardless of what the console renders: a hidden control is
 * presentation, never the boundary.
 *
 * ## What is deliberately absent
 *
 * There is no cancel, release, redispatch, pause, refund, ledger or settlement
 * route here — not disabled, absent. Each is gated on an open business
 * decision (BQ-013, UX-Q-006, BQ-015, Q-032) or on the money questions Phase I
 * inherits, and the detail response's `blockedBy` names the decision so the
 * console can say why rather than look unfinished. There is likewise no
 * generic mutation route: no SQL, no table name and no column ever crosses
 * this boundary (DEC-APP-008).
 *
 * The one write is a case resolution, which appends an audit row and changes
 * no domain state at all.
 */
@ApiTags('admin')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token' })
@ApiForbiddenResponse({ description: 'Caller holds no active platform_staff grant' })
@Roles('OPERATOR', 'ADMIN')
@Controller('api/v1/admin/supervisor')
export class SupervisorController {
  constructor(
    private readonly cases: SupervisorCaseService,
    private readonly failures: DeliveryFailureService,
  ) {}

  /**
   * Who the console is signed in as, and with which grant.
   *
   * Presentation only — it exists so the console can render the staff role in
   * its header and show a refusal instead of an empty inbox, per the design
   * package's S-01. It is **not** the access boundary: every other route
   * re-resolves the grant from `platform_staff` on its own request, so a
   * revoked grant is refused there regardless of what this returned earlier.
   *
   * Reads nothing. The capabilities are already resolved on the request by
   * `SupabaseAuthGuard`, so there is no second database round trip and no
   * cached copy of an authorization answer.
   */
  @Get('me')
  @ApiOkResponse({ description: 'The signed-in staff member and the grant held' })
  me(@CurrentUser() user: AuthenticatedUser): SupervisorIdentityResponse {
    return {
      userId: user.id,
      // Present by construction: `@Roles('OPERATOR','ADMIN')` refused anyone
      // without a grant before this handler was reached.
      staffRole: user.capabilities.platformStaff?.staffRole ?? 'OPERATOR',
    };
  }

  /** S-02 — the operations inbox: every AI Operations escalation, newest first. */
  @Get('cases')
  @ApiOkResponse({ description: 'AI operations cases, projected from audit_logs' })
  async list(@Query('limit') limit?: string): Promise<SupervisorCaseListResponse> {
    const parsed = limit === undefined ? undefined : Number.parseInt(limit, 10);
    return this.cases.listCases(Number.isFinite(parsed) ? (parsed as number) : undefined);
  }

  /** S-03 — one case, its evidence, its live subject and its timeline. */
  @Get('cases/:id')
  @ApiOkResponse({ description: 'One case with live domain state and timeline' })
  @ApiNotFoundResponse({ description: 'No AI operations case with this id' })
  async detail(@Param('id') id: string): Promise<SupervisorCaseDetailResponse> {
    return this.cases.getCase(id);
  }

  /**
   * S-06 — close a case with a mandatory reason.
   *
   * `200`, not `201`: nothing is created that the caller can address. The
   * audit row is a record of a decision, not a resource with a URL.
   */
  @Post('cases/:id/resolve')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Case resolved; one append-only audit row written' })
  @ApiNotFoundResponse({ description: 'No AI operations case with this id' })
  @ApiConflictResponse({ description: 'Case was already resolved' })
  async resolve(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResolveSupervisorCaseResponse> {
    const request = parseOrThrow(resolveSupervisorCaseSchema, body);
    return this.cases.resolveCase(id, request, user);
  }

  /**
   * BQ-017 Slice #3 — the operator's DEC-053 working list: deliveries that
   * have been `ARRIVED` at the customer for at least five minutes with their
   * order still `DELIVERING`.
   *
   * **Read-only, and the timer's only output.** The tick phase that watches
   * the five-minute wait records an append-only escalation and changes nothing
   * (see `ArrivalTimeoutEscalationService`); this route is how a person then
   * sees it. Reading the list claims nothing and resolves nothing — a delivery
   * leaves it only by being resolved through the command below.
   *
   * **A row here is a request for attention, never a verdict.** DEC-053 § 2
   * makes the operator the authority; nothing about appearing in this list
   * means the delivery should fail, and no `causeCode` is offered, because the
   * cause is what the operator decides.
   *
   * Carries no financial field — the same projection discipline
   * `docs/HUMAN_SUPERVISOR_CONTRACT.md` § 7 imposes on every surface here.
   */
  @Get('deliveries/awaiting-failure')
  @ApiOkResponse({
    description: 'Deliveries ARRIVED past the DEC-053 wait, awaiting an operator decision',
  })
  async awaitingFailure(@Query('limit') limit?: string): Promise<AwaitingFailureListResponse> {
    const parsed = limit === undefined ? undefined : Number.parseInt(limit, 10);
    return this.failures.listAwaitingFailure(Number.isFinite(parsed) ? (parsed as number) : undefined);
  }

  /**
   * BQ-017 — the operator declares a post-pickup delivery failure (DEC-053,
   * operationally unblocked by DEC-054). `ARRIVED -> FAILED` on the delivery,
   * `DELIVERING -> DELIVERY_FAILED` on the order, one cause on both.
   *
   * **The first supervisor command that moves domain state.** Everything above
   * it appends an audit row and changes nothing; this one transitions two
   * domains, because DEC-053 § 2 puts the authority here and nowhere else —
   * the rider performs the operational steps and produces the evidence, the
   * operator declares the failure. A rider-, customer- or merchant-declared
   * failure is refused by construction: there is no such route, and this one
   * sits behind the class-level `@Roles('OPERATOR','ADMIN')` grant.
   *
   * DEC-053 § 3's preconditions — two recorded contact attempts and five
   * minutes since **customer** arrival (`deliveries.arrived_at`, DEC-054) —
   * are enforced server-side by `DeliveryFailureService`, not by the console,
   * and there is no override: DEC-053 makes the operator the authority once
   * its conditions are met, not instead of them.
   *
   * **Nothing financial happens.** No refund, ledger reversal, write-off,
   * rider compensation or settlement — Q-020 and BQ-024 are open, and the
   * response carries no amount.
   *
   * `200`, not `201`: nothing is created that the caller can address.
   */
  @Post('deliveries/:id/fail')
  @HttpCode(200)
  @ApiOkResponse({ description: 'The delivery now FAILED, and the order now DELIVERY_FAILED' })
  @ApiNotFoundResponse({ description: 'Delivery or order not found' })
  @ApiConflictResponse({
    description:
      'CONFLICT — a DEC-053 precondition is unmet (order not DELIVERING, fewer than 2 contact ' +
      'attempts, or less than 5 minutes since customer arrival), or the delivery was already ' +
      'failed under a different cause. INVALID_TRANSITION — the delivery is not ARRIVED',
  })
  async failDelivery(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FailDeliveryResponse> {
    const request = parseOrThrow(failDeliverySchema, body);
    return this.failures.failDelivery(user, id, request);
  }
}
