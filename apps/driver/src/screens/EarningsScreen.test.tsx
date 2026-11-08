import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { EarningsScreen, currentMonday } from './EarningsScreen';
import { fetchRiderEarnings } from '../repositories/riderEarnings';

jest.mock('../repositories/riderEarnings', () => ({ fetchRiderEarnings: jest.fn() }));
const fetchMock = fetchRiderEarnings as jest.Mock;

const DATA = {
  period: { weekStart: '2026-11-02', weekEnd: '2026-11-08' },
  lines: [
    { id: 'd1', orderNumber: 'BH-1', deliveredAt: '', foodSatang: null, commissionSatang: null, amountSatang: 1200, paid: true },
    { id: 'd2', orderNumber: 'BH-2', deliveredAt: '', foodSatang: null, commissionSatang: null, amountSatang: 2000, paid: false },
  ],
  weekTotalSatang: 3200,
  weekPaidSatang: 1200,
  outstandingSatang: 2000,
  payouts: [{ paidOn: '2026-11-09', totalSatang: 1200, bankReference: 'SLIP-9', items: 1 }],
};

beforeEach(() => fetchMock.mockReset().mockResolvedValue(DATA));

describe('DEC-073 — rider earnings screen', () => {
  it('loads the current week and shows each delivery\'s earning and whether it was transferred', async () => {
    render(<EarningsScreen />);

    await waitFor(() => expect(screen.getByTestId('earnings-line-d1')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(currentMonday());
    expect(screen.getAllByText('฿12').length).toBe(2); // the delivery and the matching transfer
    expect(screen.getByText('โอนแล้ว')).toBeTruthy();
    expect(screen.getAllByText('รอโอน').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('฿32')).toBeTruthy(); // week total
    expect(screen.getByText(/SLIP-9/)).toBeTruthy();
  });

  it('moves to the previous week', async () => {
    render(<EarningsScreen />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.press(screen.getByTestId('earnings-prev'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).not.toBe(currentMonday());
  });

  it('offers a retry when loading fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    render(<EarningsScreen />);

    await waitFor(() => expect(screen.getByText('โหลดรายได้ไม่สำเร็จ')).toBeTruthy());
  });
});
