import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PayoutsPage from './page';
import { previousMonday } from '../../lib/week';

const report = jest.fn();
const history = jest.fn();
const record = jest.fn();
let mockRole: 'ADMIN' | 'OPERATOR' = 'ADMIN';

jest.mock('../../repositories/settlement', () => ({
  settlementRepository: {
    report: (week: string) => report(week),
    history: () => history(),
    record: (request: unknown) => record(request),
    void: jest.fn(),
  },
}));
jest.mock('../../hooks/useStaff', () => ({
  useStaff: () => ({ status: 'ready', identity: { staffRole: mockRole }, reload: jest.fn() }),
}));
jest.mock('../../components/ConsoleShell', () => ({
  ConsoleShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const REPORT = {
  period: { weekStart: '2026-11-02', weekEnd: '2026-11-08', startsAt: '', endsAt: '' },
  merchants: [
    {
      merchantId: 'm-1',
      name: 'ร้านส้มตำ',
      totalSatang: 16200,
      lines: [{ orderId: 'o-1', orderNumber: 'BH-1', deliveredAt: '', foodSatang: 18000, commissionSatang: 1800, payableSatang: 16200, carriedOver: false }],
    },
  ],
  riders: [
    {
      riderId: 'r-1',
      name: 'ไรเดอร์ เอ',
      totalSatang: 1200,
      lines: [{ deliveryId: 'd-1', orderNumber: 'BH-1', deliveredAt: '', earningSatang: 1200, carriedOver: true }],
    },
  ],
  needsReview: [{ kind: 'DELIVERY_FAILED', orderId: 'f-1', orderNumber: 'BH-9', note: 'ส่งไม่สำเร็จ' }],
};

beforeEach(() => {
  mockRole = 'ADMIN';
  report.mockReset().mockResolvedValue(REPORT);
  history.mockReset().mockResolvedValue([]);
  record.mockReset().mockResolvedValue({ payoutId: 'p-1' });
});

describe('previousMonday', () => {
  it('is the Monday of last week in Bangkok', () => {
    expect(previousMonday(new Date('2026-11-08T10:00:00Z'))).toBe('2026-10-26'); // Sunday 8 Nov: this week began Mon 2 Nov, so last week began Mon 26 Oct
    expect(previousMonday(new Date('2026-11-09T02:00:00Z'))).toBe('2026-11-02'); // Monday 9 Nov Bangkok
  });
});

describe('DEC-073 — payouts page', () => {
  it('lists what each restaurant and rider is owed, and items for staff review', async () => {
    render(<PayoutsPage />);

    await waitFor(() => expect(screen.getByTestId('owed-table')).toHaveTextContent('ร้านส้มตำ'));
    expect(screen.getByTestId('owed-table')).toHaveTextContent('฿162');
    expect(screen.getByTestId('owed-table')).toHaveTextContent('ไรเดอร์ เอ');
    expect(screen.getByTestId('owed-table')).toHaveTextContent('ค้างจากก่อนหน้า 1');
    expect(screen.getByTestId('needs-review')).toHaveTextContent('BH-9');
  });

  it('records a transfer with the date and slip reference, sending ids — never an amount', async () => {
    render(<PayoutsPage />);
    await waitFor(() => expect(screen.getByTestId('record-m-1')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('record-m-1'));
    expect(screen.getByTestId('button-confirm-transfer')).toBeDisabled();
    fireEvent.change(screen.getByTestId('input-paid-on'), { target: { value: '2026-11-09' } });
    fireEvent.change(screen.getByTestId('input-reference'), { target: { value: 'SLIP-001' } });
    fireEvent.click(screen.getByTestId('button-confirm-transfer'));

    await waitFor(() =>
      expect(record).toHaveBeenCalledWith({
        partyType: 'MERCHANT',
        partyId: 'm-1',
        weekStart: expect.any(String),
        itemIds: ['o-1'],
        paidOn: '2026-11-09',
        bankReference: 'SLIP-001',
      }),
    );
  });

  it('an OPERATOR sees the report but cannot record', async () => {
    mockRole = 'OPERATOR';
    render(<PayoutsPage />);

    await waitFor(() => expect(screen.getByTestId('owed-table')).toBeInTheDocument());
    expect(screen.queryByTestId('record-m-1')).toBeNull();
  });
});
