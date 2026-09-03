import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CaseDetailPage from './page';
import { ApiClientError } from '../../lib/apiClient';

const detail = jest.fn();
const resolve = jest.fn();

jest.mock('../../repositories/supervisorCases', () => ({
  supervisorCaseRepository: {
    identity: jest.fn(),
    list: jest.fn(),
    detail: () => detail(),
    resolve: (id: string, request: unknown) => resolve(id, request),
  },
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => ({ get: (key: string) => (key === 'id' ? CASE_ID : null) }),
}));

jest.mock('../../components/ConsoleShell', () => ({
  ConsoleShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const CASE_ID = 'aa100000-0000-4000-8000-000000000001';
const DELIVERY_ID = 'bb100000-0000-4000-8000-000000000002';

const detailResponse = (overrides: Record<string, unknown> = {}) => ({
  case: {
    caseId: CASE_ID,
    action: 'AI_OPS_NO_RIDER_TRIAGE',
    escalation: 'ESC-NORIDER',
    subjectType: 'delivery',
    subjectId: DELIVERY_ID,
    reason: 'ESC-NORIDER: searching 1900s',
    raisedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    state: 'OPEN',
    resolution: null,
  },
  evidence: { roundsBroadcast: 30, ridersEligibleNow: 0 },
  subject: {
    type: 'delivery',
    deliveryId: DELIVERY_ID,
    orderId: 'cc100000-0000-4000-8000-000000000003',
    state: 'RIDER_SEARCHING',
    createdAt: new Date().toISOString(),
    hasRider: false,
  },
  timeline: [
    {
      at: new Date().toISOString(),
      source: 'audit',
      actorType: 'AI',
      what: 'AI_OPS_NO_RIDER_TRIAGE',
      reason: 'ESC-NORIDER',
    },
  ],
  blockedBy: 'UX-Q-006 — the no-rider terminal outcome is undecided.',
  ...overrides,
});

beforeEach(() => {
  detail.mockReset();
  resolve.mockReset();
});

describe('S-03 — case detail', () => {
  it('shows live domain state and the evidence the pipeline recorded', async () => {
    detail.mockResolvedValue(detailResponse());

    render(<CaseDetailPage />);

    await waitFor(() => expect(screen.getByText('RIDER_SEARCHING')).toBeInTheDocument());
    expect(screen.getByText(/roundsBroadcast/)).toBeInTheDocument();
    expect(screen.getByText('AI_OPS_NO_RIDER_TRIAGE')).toBeInTheDocument();
  });

  it('states the open decision instead of offering a control it cannot back', async () => {
    detail.mockResolvedValue(detailResponse());

    render(<CaseDetailPage />);

    await waitFor(() => expect(screen.getByTestId('blocked-notice')).toBeInTheDocument());
    expect(screen.getByText(/UX-Q-006/)).toBeInTheDocument();

    // No cancel, fail, reassign, redispatch, pause or refund control exists —
    // absent rather than disabled, so the screen never implies a capability
    // the platform has not decided to have.
    for (const forbidden of [/ยกเลิก/, /คืนเงิน/, /จัดหาไรเดอร์/, /หยุดรับออเดอร์/]) {
      expect(screen.queryByText(forbidden)).not.toBeInTheDocument();
    }
  });

  it('refuses to submit without a reason', async () => {
    detail.mockResolvedValue(detailResponse());

    render(<CaseDetailPage />);

    await waitFor(() => expect(screen.getByText('ปิดเคส')).toBeInTheDocument());

    const submit = screen.getByRole('button', { name: 'บันทึกและปิดเคส' });
    expect(submit).toBeDisabled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('sends the outcome and the reason, then re-reads the case', async () => {
    detail.mockResolvedValue(detailResponse());
    resolve.mockResolvedValue({ caseId: CASE_ID, state: 'RESOLVED', resolution: {} });

    render(<CaseDetailPage />);

    await waitFor(() => expect(screen.getByLabelText('เหตุผล')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('ผลลัพธ์'), { target: { value: 'AWAITING_POLICY' } });
    fireEvent.change(screen.getByLabelText('เหตุผล'), {
      target: { value: 'รอการตัดสินใจ UX-Q-006' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกและปิดเคส' }));

    await waitFor(() =>
      expect(resolve).toHaveBeenCalledWith(CASE_ID, {
        outcome: 'AWAITING_POLICY',
        reason: 'รอการตัดสินใจ UX-Q-006',
      }),
    );
    // Re-read rather than optimistically patching local state: the server's
    // record is what the next operator will see.
    await waitFor(() => expect(detail).toHaveBeenCalledTimes(2));
  });

  it('reports a case someone else already closed as a conflict, not a failure', async () => {
    detail.mockResolvedValue(detailResponse());
    resolve.mockRejectedValue(new ApiClientError(409, { code: 'CONFLICT' }));

    render(<CaseDetailPage />);

    await waitFor(() => expect(screen.getByLabelText('เหตุผล')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('เหตุผล'), { target: { value: 'ปิดเคส' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกและปิดเคส' }));

    await waitFor(() => expect(screen.getByText('เคสนี้ถูกปิดไปแล้ว')).toBeInTheDocument());
  });

  it('shows a resolved case as read-only, with who closed it and why', async () => {
    detail.mockResolvedValue(
      detailResponse({
        case: {
          ...detailResponse().case,
          state: 'RESOLVED',
          resolution: {
            outcome: 'RESOLVED',
            reason: 'โทรหาไรเดอร์แล้ว',
            resolvedAt: new Date().toISOString(),
            staffRole: 'ADMIN',
          },
        },
      }),
    );

    render(<CaseDetailPage />);

    await waitFor(() => expect(screen.getByTestId('resolution')).toBeInTheDocument());
    expect(screen.getByText('โทรหาไรเดอร์แล้ว')).toBeInTheDocument();
    // An append-only trail has no edit affordance: a correction is a new row.
    expect(screen.queryByRole('button', { name: 'บันทึกและปิดเคส' })).not.toBeInTheDocument();
  });
});
