import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  UnauthorizedException,
  type Provider,
} from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CorrelationModule } from '../../common/correlation/correlation.module';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../common/interceptors/response.interceptor';
import { RolesGuard } from '../../common/guards/roles.guard';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';
import { SupervisorController } from './supervisor.controller';
import { SupervisorCaseService } from './supervisor-case.service';

/**
 * The HTTP boundary of the Human Supervisor console — Phase I.
 *
 * Same shape as `rider.controller.spec.ts`: the service is a plain stub,
 * because its behaviour is covered by `supervisor-case.spec.ts`. What this file
 * proves is the boundary that spec cannot see — that an anonymous or non-staff
 * caller never reaches a handler, that the acting identity is the
 * server-verified one and never a body field, that a malformed body is rejected
 * before the service runs, and that a domain conflict renders through the real
 * global filter.
 *
 * The real `RolesGuard` is used, not a fake: `@Roles('OPERATOR','ADMIN')` is
 * the entire access gate for this surface, and stubbing it would leave the
 * thing under test unexercised.
 */

const CASE_ID = 'aa100000-0000-4000-8000-000000000001';

const OPERATOR: AuthenticatedUser = {
  id: 'user-operator-1',
  phone: '+66812345678',
  capabilities: {
    customer: true,
    merchant: [],
    rider: null,
    platformStaff: { staffRole: 'OPERATOR' },
  },
};

/** A signed-in customer with no staff grant — a revoked operator looks identical here. */
const NON_STAFF: AuthenticatedUser = {
  id: 'user-customer-1',
  phone: '+66899999999',
  capabilities: { customer: true, merchant: [], rider: null, platformStaff: null },
};

function makeStub() {
  return {
    listCases: jest.fn().mockResolvedValue({
      cases: [],
      window: { limit: 50, returned: 0, openInWindow: 0, resolvedInWindow: 0 },
    }),
    getCase: jest.fn().mockResolvedValue({ case: {}, evidence: {}, subject: {}, timeline: [], blockedBy: null }),
    resolveCase: jest.fn().mockResolvedValue({ caseId: CASE_ID, state: 'RESOLVED', resolution: {} }),
  };
}

type Stub = ReturnType<typeof makeStub>;

function fakeAuthGuard(user: AuthenticatedUser | null): CanActivate {
  @Injectable()
  class FakeAuthGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      if (!user) throw new UnauthorizedException();
      context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user = user;
      return true;
    }
  }
  return new FakeAuthGuard();
}

async function buildApp(user: AuthenticatedUser | null, stub: Stub): Promise<INestApplication> {
  const guards: Provider[] = [
    { provide: APP_GUARD, useValue: fakeAuthGuard(user) },
    { provide: APP_GUARD, useClass: RolesGuard },
  ];

  const moduleRef = await Test.createTestingModule({
    imports: [CorrelationModule],
    controllers: [SupervisorController],
    providers: [
      { provide: SupervisorCaseService, useValue: stub },
      ...guards,
      { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      Reflector,
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  return app;
}

/** Every route on the surface. A route added without a test here is visible in review. */
const ROUTES: ReadonlyArray<{ name: string; method: 'get' | 'post'; path: string; body?: unknown }> = [
  { name: 'identity', method: 'get', path: '/api/v1/admin/supervisor/me' },
  { name: 'inbox', method: 'get', path: '/api/v1/admin/supervisor/cases' },
  { name: 'case detail', method: 'get', path: `/api/v1/admin/supervisor/cases/${CASE_ID}` },
  {
    name: 'resolve',
    method: 'post',
    path: `/api/v1/admin/supervisor/cases/${CASE_ID}/resolve`,
    body: { outcome: 'RESOLVED', reason: 'ปิดเคส' },
  },
];

describe('SupervisorController — HTTP boundary', () => {
  let app: INestApplication;
  let stub: Stub;

  beforeEach(() => {
    stub = makeStub();
  });

  afterEach(async () => {
    await app?.close();
  });

  function serviceWasCalled(): boolean {
    return [stub.listCases, stub.getCase, stub.resolveCase].some((fn) => fn.mock.calls.length > 0);
  }

  it.each(ROUTES)('refuses an anonymous caller on $name with 401', async (route) => {
    app = await buildApp(null, stub);

    await request(app.getHttpServer())[route.method](route.path).send(route.body ?? {}).expect(401);

    expect(serviceWasCalled()).toBe(false);
  });

  it.each(ROUTES)('refuses a signed-in non-staff caller on $name with 403', async (route) => {
    app = await buildApp(NON_STAFF, stub);

    // A revoked grant is indistinguishable from never having had one, which is
    // the point: the guard re-reads `platform_staff` per request, so a grant
    // removed a second ago is refused now.
    await request(app.getHttpServer())[route.method](route.path).send(route.body ?? {}).expect(403);

    expect(serviceWasCalled()).toBe(false);
  });

  it.each(ROUTES)('admits a staff caller on $name', async (route) => {
    app = await buildApp(OPERATOR, stub);

    await request(app.getHttpServer())[route.method](route.path).send(route.body ?? {}).expect(200);
  });

  it('passes the server-verified identity to the service, never a body field', async () => {
    app = await buildApp(OPERATOR, stub);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/supervisor/cases/${CASE_ID}/resolve`)
      .send({ outcome: 'RESOLVED', reason: 'ปิดเคส' })
      .expect(200);

    expect(stub.resolveCase).toHaveBeenCalledWith(
      CASE_ID,
      { outcome: 'RESOLVED', reason: 'ปิดเคส' },
      OPERATOR,
    );
  });

  it('rejects a blank reason before the service runs', async () => {
    app = await buildApp(OPERATOR, stub);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/admin/supervisor/cases/${CASE_ID}/resolve`)
      .send({ outcome: 'RESOLVED', reason: '  ' })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(stub.resolveCase).not.toHaveBeenCalled();
  });

  it('rejects a body carrying an unknown field', async () => {
    app = await buildApp(OPERATOR, stub);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/supervisor/cases/${CASE_ID}/resolve`)
      .send({ outcome: 'RESOLVED', reason: 'ok', actorId: 'someone-else' })
      .expect(400);

    expect(stub.resolveCase).not.toHaveBeenCalled();
  });

  it('renders a domain conflict through the real filter with its code intact', async () => {
    stub.resolveCase.mockRejectedValue(
      new DomainError('CONFLICT', { message: 'already resolved', details: { caseId: CASE_ID } }),
    );
    app = await buildApp(OPERATOR, stub);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/admin/supervisor/cases/${CASE_ID}/resolve`)
      .send({ outcome: 'RESOLVED', reason: 'ปิดเคส' })
      .expect(409);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('exposes no route outside the four above', async () => {
    app = await buildApp(OPERATOR, stub);
    const server = app.getHttpServer();

    // A generic mutation path would be the one thing that voids this whole
    // surface's safety argument — asserted absent rather than assumed.
    await request(server).post('/api/v1/admin/supervisor/query').send({ sql: 'select 1' }).expect(404);
    await request(server).post('/api/v1/admin/supervisor/cases').send({}).expect(404);
    await request(server)
      .post(`/api/v1/admin/supervisor/cases/${CASE_ID}/cancel`)
      .send({})
      .expect(404);
  });
});
