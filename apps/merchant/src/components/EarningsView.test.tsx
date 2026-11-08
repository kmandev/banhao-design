import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { EarningsView, currentMonday } from './EarningsView';
import { apiClient } from '../lib/apiClient';

jest.mock('../lib/apiClient', () => ({ apiClient: { request: jest.fn() } }));
const request = apiClient.request as jest.Mock;

const DATA = {
  period: { weekStart: '2026-11-02', weekEnd: '2026-11-08' },
  lines: [
    { id: 'o1', orderNumber: 'BH-1', deliveredAt: '', foodSatang: 18000, commissionSatang: 1800, amountSatang: 16200, paid: true },
    { id: 'o2', orderNumber: 'BH-2', deliveredAt: '', foodSatang: 5000, commissionSatang: 500, amountSatang: 4500, paid: false },
  ],
  weekTotalSatang: 20700,
  weekPaidSatang: 16200,
  outstandingSatang: 4500,
  payouts: [{ paidOn: '2026-11-09', totalSatang: 16200, bankReference: 'SLIP-1', items: 1 }],
};

beforeEach(() => request.mockReset().mockResolvedValue(DATA));

describe('DEC-073 — restaurant earnings', () => {
  it('reads this restaurant\'s earnings for the current week', async () => {
    render(<EarningsView restaurantId="rest-1" />);

    await waitFor(() => expect(screen.getByTestId('earnings-table')).toBeInTheDocument());
    expect(request).toHaveBeenCalledWith(`/api/v1/merchant/restaurants/rest-1/earnings?week=${currentMonday()}`);
  });

  it('shows food, commission, earning and whether each order was transferred', async () => {
    render(<EarningsView restaurantId="rest-1" />);

    await waitFor(() => expect(screen.getByTestId('earnings-table')).toHaveTextContent('BH-1'));
    expect(screen.getByTestId('earnings-table')).toHaveTextContent('฿162');
    expect(screen.getByTestId('earnings-table')).toHaveTextContent('โอนแล้ว');
    expect(screen.getByTestId('earnings-table')).toHaveTextContent('รอโอน');
    expect(screen.getByTestId('earnings-week-total')).toHaveTextContent('฿207');
    expect(screen.getByTestId('earnings-outstanding')).toHaveTextContent('฿45');
    expect(screen.getByTestId('earnings-payouts')).toHaveTextContent('SLIP-1');
  });

  it('moves to the previous week', async () => {
    render(<EarningsView restaurantId="rest-1" />);
    await waitFor(() => expect(screen.getByTestId('earnings-table')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('earnings-prev'));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request.mock.calls[1][0]).not.toContain(currentMonday());
  });
});
