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
import {
  failDeliverySchema,
  initiateRefundSchema,
  resolveSupervisorCaseSchema,
  resolveReconciliationCaseSchema,
} from '@banhao/validation';
import type {
  AwaitingFailureListResponse,
  FailDeliveryResponse,
  InitiateRefundResponse,
  ResolveSupervisorCaseResponse,
  SupervisorIdentityResponse,
  SupervisorCaseDetailResponse,
  SupervisorCaseListResponse,
  ReconciliationCaseListResponse,
  ReconciliationCaseDetailResponse,
  ResolveReconciliationCaseResponse,
} from '@banhao/validation';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { parseOrThrow } from '../../common/validation/parse';
import type { AuthenticatedUser } from '../../common/types';
import { SupervisorCaseService } from './supervisor-case.service';
import { DeliveryFailureService } from './delivery-failure.service';
import { RefundService } from './refund.service';
import { ReconciliationCaseService } from './reconciliation-case.service';

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
 * There is no cancel, release, redispatch, pause, ledger or settlement route
 * here — not disabled, absent. Each is gated on an open business decision
 * (BQ-013, UX-Q-006, BQ-015, Q-032) or on the money questions Phase I
 * inherits, and the detail response's `blockedBy` names the decision so the
 * console can say why rather than look unfinished. There is likewise no
 * generic mutation route: no SQL, no table name and no column ever crosses
 * this boundary (DEC-APP-008).
 *
 * **Refund is no longer on that absent list.** Q-020's mechanism, authority
 * and full-refund accounting are decision-locked (DEC-057/058/059), and
 * `POST .../orders/:id/refund` (Q-020 Slice 1) is this console's first
 * financial command. It only **initiates** a refund — it never reaches
 * `REFUNDED`, posts no ledger reversal, and processes no provider webhook
 * (see `RefundService`'s own doc comment for the exact Slice 1 boundary).
 * Every other absence above is unchanged.
 *
 * The remaining state-changing writes are a case resolution (an audit row
 * only) and the DEC-053 delivery-failure command.
 *
 * **Q-020 Slice 4** adds the `reconciliation_cases` read path
 * (`GET reconciliation-cases`, `GET reconciliation-cases/:id`) a prior
 * production audit found missing, plus an operator resolution record
 * (`POST reconciliation-cases/:id/resolve`) — advisory metadata only, never a
 * refund/payment/order/ledger mutation. It does not add a refund-specific
 * anomaly `kind`; see `ReconciliationCaseService`'s own doc comment and this
 * slice's final report for the schema decision that blocks that half.
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
    private readonly refunds: RefundService,
    private readonly reconciliation: ReconciliationCaseService,
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

  /**
   * Q-020 Slice 1 (DEC-057/058/059) — an operator initiates a full refund for
   * an order already eligible under DEC-050 (cancellation) or DEC-053
   * (post-pickup failure, non-customer-caused).
   *
   * **Initiation only.** This call makes one real Stripe refund request and
   * records it locally; it never marks the refund `REFUNDED`, never posts a
   * ledger reversal, and never touches `orders.state` or `payments.state`.
   * Finality — reading Stripe's own verified refund status and, only then,
   * posting DEC-049's reversal groups — is Slice 2's work, deliberately not
   * done here (DEC-057 § 2/§ 8: a synchronous provider response is never
   * treated as finality).
   *
   * No `amount` field exists on the request body — Phase 1 is full refund
   * only (DEC-057 § 1), and the amount is always the order's own settled
   * payment amount, determined here, never by the caller.
   *
   * `200`, not `201`: a retry of an in-flight or previously-failed refund
   * reuses the same local `refunds` row rather than creating a new resource
   * each time (see `RefundService`'s own idempotency doc comment).
   */
  @Post('orders/:id/refund')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Refund initiated (or an in-flight/retried one resumed) — never REFUNDED from this call' })
  @ApiNotFoundResponse({ description: 'Order or payment not found' })
  @ApiConflictResponse({
    description:
      'ORDER_NOT_REFUND_ELIGIBLE — order state is not eligible under DEC-050/DEC-053. ' +
      'PAYMENT_NOT_REFUNDABLE — the order has no SUCCESS payment. ' +
      'REFUND_ALREADY_EXISTS — this payment was already REFUNDED.',
  })
  async initiateRefund(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InitiateRefundResponse> {
    const request = parseOrThrow(initiateRefundSchema, body);
    return this.refunds.initiateRefund(user, id, request);
  }

  /**
   * Q-020 Slice 4 — the `reconciliation_cases` read path a prior production
   * audit found missing. Every case `PaymentEventProcessingService.openCase`
   * has ever written (`LATE_PAYMENT`/`SURPLUS_PAYMENT`/`AMOUNT_MISMATCH`/
   * `UNMATCHED_EVENT` — this table's entire committed vocabulary today), newest
   * first. `kind`/`state` filter against that same committed vocabulary and
   * reject an unrecognized value rather than silently returning nothing.
   */
  @Get('reconciliation-cases')
  @ApiOkResponse({ description: 'Reconciliation cases, newest first' })
  async listReconciliationCases(
    @Query('kind') kind?: string,
    @Query('state') state?: string,
    @Query('limit') limit?: string,
  ): Promise<ReconciliationCaseListResponse> {
    return this.reconciliation.listCases({ kind, state, limit });
  }

  /** One reconciliation case, by id. */
  @Get('reconciliation-cases/:id')
  @ApiOkResponse({ description: 'One reconciliation case' })
  @ApiNotFoundResponse({ description: 'No reconciliation case with this id' })
  async getReconciliationCase(@Param('id') id: string): Promise<ReconciliationCaseDetailResponse> {
    return this.reconciliation.getCase(id);
  }

  /**
   * The operator's own resolution record — never an automatic outcome of a
   * scan running (see `ReconciliationCaseService.resolveCase`'s own doc
   * comment). Writes only this table's advisory metadata; no refund,
   * payment, order or ledger row is touched by this route.
   */
  @Post('reconciliation-cases/:id/resolve')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Reconciliation case updated with the operator\'s own resolution record' })
  @ApiNotFoundResponse({ description: 'No reconciliation case with this id' })
  async resolveReconciliationCase(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResolveReconciliationCaseResponse> {
    const request = parseOrThrow(resolveReconciliationCaseSchema, body);
    return this.reconciliation.resolveCase(id, request, user);
  }
}
