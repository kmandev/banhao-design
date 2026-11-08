import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PricingPage from './page';

const deliveryFee = jest.fn();
const setDeliveryFee = jest.fn();
let mockRole: 'ADMIN' | 'OPERATOR' = 'ADMIN';

jest.mock('../../repositories/pricing', () => ({
  pricingRepository: {
    deliveryFee: () => deliveryFee(),
    setDeliveryFee: (request: unknown) => setDeliveryFee(request),
  },
}));

jest.mock('../../hooks/useStaff', () => ({
  useStaff: () => ({ status: 'ready', identity: { staffRole: mockRole }, reload: jest.fn() }),
}));

jest.mock('../../components/ConsoleShell', () => ({
  ConsoleShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const OVERVIEW = {
  current: { id: 's1', mode: 'FIXED', fixedSatang: 1500, reason: 'initial', createdAt: '2026-11-08T00:00:00Z', createdBy: null },
  history: [{ id: 's1', mode: 'FIXED', fixedSatang: 1500, reason: 'initial', createdAt: '2026-11-08T00:00:00Z', createdBy: null }],
  preview: [
    { foodSubtotalSatang: 5000, deliveryFeeSatang: 1500, riderEarningSatang: 1200, banhaoDeliveryMarginSatang: 300 },
  ],
  bounds: { minSatang: 1500, maxSatang: 3500, riderShareBasisPoints: 8000, riderFloorSatang: 1200 },
};

beforeEach(() => {
  mockRole = 'ADMIN';
  deliveryFee.mockReset().mockResolvedValue(OVERVIEW);
  setDeliveryFee.mockReset().mockResolvedValue(OVERVIEW);
});

describe('DEC-071 — delivery fee settings page', () => {
  it('shows the setting in force and what it means for customer, rider and BANHAO', async () => {
    render(<PricingPage />);

    await waitFor(() => expect(screen.getByTestId('delivery-fee-current')).toHaveTextContent('คงที่ ฿15'));
    expect(screen.getByTestId('delivery-fee-current-preview')).toHaveTextContent('฿12');
    expect(screen.getByTestId('delivery-fee-current-preview')).toHaveTextContent('฿3');
  });

  it('refuses to save a fee below ฿15, and saves nothing', async () => {
    render(<PricingPage />);
    await waitFor(() => expect(screen.getByTestId('delivery-fee-form')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('input-fixed'), { target: { value: '10' } });
    fireEvent.change(screen.getByTestId('input-reason'), { target: { value: 'ลดค่าส่ง' } });

    expect(screen.getByTestId('delivery-fee-invalid')).toBeInTheDocument();
    expect(screen.getByTestId('button-save-delivery-fee')).toBeDisabled();
  });

  it('requires a reason before saving', async () => {
    render(<PricingPage />);
    await waitFor(() => expect(screen.getByTestId('delivery-fee-form')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('input-fixed'), { target: { value: '20' } });

    expect(screen.getByTestId('button-save-delivery-fee')).toBeDisabled();
  });

  it('previews a valid draft and saves it in satang with the reason', async () => {
    render(<PricingPage />);
    await waitFor(() => expect(screen.getByTestId('delivery-fee-form')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('input-fixed'), { target: { value: '25' } });
    fireEvent.change(screen.getByTestId('input-reason'), { target: { value: 'ทดลองค่าส่ง ฿25' } });

    expect(screen.getByTestId('delivery-fee-draft-preview')).toHaveTextContent('฿20'); // rider 80%
    fireEvent.click(screen.getByTestId('button-save-delivery-fee'));

    await waitFor(() =>
      expect(setDeliveryFee).toHaveBeenCalledWith({ mode: 'FIXED', fixedSatang: 2500, reason: 'ทดลองค่าส่ง ฿25' }),
    );
    await waitFor(() => expect(screen.getByTestId('delivery-fee-saved')).toBeInTheDocument());
  });

  it('saves a percentage setting with its optional bounds', async () => {
    render(<PricingPage />);
    await waitFor(() => expect(screen.getByTestId('delivery-fee-form')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('เปอร์เซ็นต์ของค่าอาหาร', { selector: 'input[type="radio"]' }));
    fireEvent.change(screen.getByTestId('input-percent'), { target: { value: '8' } });
    fireEvent.change(screen.getByTestId('input-min'), { target: { value: '20' } });
    fireEvent.change(screen.getByTestId('input-reason'), { target: { value: '8% ขั้นต่ำ ฿20' } });
    fireEvent.click(screen.getByTestId('button-save-delivery-fee'));

    await waitFor(() =>
      expect(setDeliveryFee).toHaveBeenCalledWith({
        mode: 'PERCENT',
        percentBasisPoints: 800,
        minSatang: 2000,
        maxSatang: null,
        reason: '8% ขั้นต่ำ ฿20',
      }),
    );
  });

  it('an OPERATOR sees the setting but no form', async () => {
    mockRole = 'OPERATOR';
    render(<PricingPage />);

    await waitFor(() => expect(screen.getByTestId('delivery-fee-read-only')).toBeInTheDocument());
    expect(screen.queryByTestId('delivery-fee-form')).toBeNull();
  });
});
