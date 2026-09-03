import { render, screen, waitFor } from '@testing-library/react';
import InboxPage from './page';

const list = jest.fn();
const push = jest.fn();

jest.mock('../repositories/supervisorCases', () => ({
  supervisorCaseRepository: {
    identity: jest.fn(),
    list: () => list(),
    detail: jest.fn(),
    resolve: jest.fn(),
  },
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: jest.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

jest.mock('../components/ConsoleShell', () => ({
  ConsoleShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const caseRow = (overrides = {}) => ({
  caseId: 'aa100000-0000-4000-8000-000000000001',
  action: 'AI_OPS_NO_RIDER_TRIAGE',
  escalation: 'ESC-NORIDER',
  subjectType: 'delivery',
  subjectId: 'bb100000-0000-4000-8000-000000000002',
  reason: 'ESC-NORIDER: searching 1900s',
  raisedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
  state: 'OPEN',
  resolution: null,
  ...overrides,
});

beforeEach(() => {
  list.mockReset();
  push.mockReset();
});

describe('S-02 — the operations inbox', () => {
  it('lists escalations with their subject, reason and age', async () => {
    list.mockResolvedValue({
      cases: [caseRow()],
      window: { limit: 50, returned: 1, openInWindow: 1, resolvedInWindow: 0 },
    });

    render(<InboxPage />);

    await waitFor(() => expect(screen.getByText('ไม่มีไรเดอร์รับงาน')).toBeInTheDocument());
    expect(screen.getByText('20 นาที')).toBeInTheDocument();
    expect(screen.getByTestId('count-open')).toHaveTextContent('1');
  });

  it('says the counts are of this page rather than implying a system-wide total', async () => {
    list.mockResolvedValue({
      cases: [],
      window: { limit: 50, returned: 0, openInWindow: 0, resolvedInWindow: 0 },
    });

    render(<InboxPage />);

    await waitFor(() =>
      expect(screen.getByText('ตัวเลขนับเฉพาะรายการที่แสดงในหน้านี้')).toBeInTheDocument(),
    );
  });

  it('distinguishes an empty inbox from a broken one', async () => {
    list.mockResolvedValue({
      cases: [],
      window: { limit: 50, returned: 0, openInWindow: 0, resolvedInWindow: 0 },
    });

    const { unmount } = render(<InboxPage />);
    await waitFor(() =>
      expect(screen.getByText('ไม่มีเรื่องที่ต้องมีคนตัดสินใจ')).toBeInTheDocument(),
    );
    unmount();

    list.mockRejectedValue(new Error('network down'));
    render(<InboxPage />);
    await waitFor(() => expect(screen.getByText('โหลดข้อมูลไม่สำเร็จ')).toBeInTheDocument());
    expect(screen.queryByText('ไม่มีเรื่องที่ต้องมีคนตัดสินใจ')).not.toBeInTheDocument();
  });

  it('offers no bulk action, assignment or command from the queue', async () => {
    list.mockResolvedValue({
      cases: [caseRow()],
      window: { limit: 50, returned: 1, openInWindow: 1, resolvedInWindow: 0 },
    });

    render(<InboxPage />);

    await waitFor(() => expect(screen.getByTestId('case-row')).toBeInTheDocument());
    // The only controls on this screen are navigation. Nothing here cancels,
    // reassigns, pauses or refunds anything.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});
