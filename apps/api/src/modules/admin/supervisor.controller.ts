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
import { resolveSupervisorCaseSchema } from '@banhao/validation';
import type {
  ResolveSupervisorCaseResponse,
  SupervisorCaseDetailResponse,
  SupervisorCaseListResponse,
} from '@banhao/validation';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { parseOrThrow } from '../../common/validation/parse';
import type { AuthenticatedUser } from '../../common/types';
import { SupervisorCaseService } from './supervisor-case.service';

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
  constructor(private readonly cases: SupervisorCaseService) {}

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
}
