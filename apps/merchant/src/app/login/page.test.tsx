import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from './page';

const replace = jest.fn();
const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
}));

const requestOtp = jest.fn();
let mockSession: unknown = null;
jest.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ session: mockSession, requestOtp: (phone: string) => requestOtp(phone) }),
}));

jest.mock('../../lib/supabase', () => ({ isSupabaseConfigured: true }));

let sessionExpiredFlag = false;
jest.mock('../../lib/restaurantScope', () => ({
  consumeSessionExpired: () => sessionExpiredFlag,
}));

describe('LoginPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSession = null;
    sessionExpiredFlag = false;
  });

  it('renders the phone entry form', () => {
    render(<LoginPage />);
    expect(screen.getByTestId('input-phone')).toBeInTheDocument();
    expect(screen.getByTestId('button-request-otp')).toBeInTheDocument();
  });

  it('disables submit until the phone number is a valid Thai mobile number', () => {
    render(<LoginPage />);
    const button = screen.getByTestId('button-request-otp');
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByTestId('input-phone'), { target: { value: '812345678' } });
    expect(button).not.toBeDisabled();

    fireEvent.change(screen.getByTestId('input-phone'), { target: { value: '81234' } });
    expect(button).toBeDisabled();
  });

  it('requests an OTP and navigates to the OTP screen on success', async () => {
    requestOtp.mockResolvedValue(undefined);
    render(<LoginPage />);

    fireEvent.change(screen.getByTestId('input-phone'), { target: { value: '812345678' } });
    fireEvent.click(screen.getByTestId('button-request-otp'));

    await waitFor(() => expect(requestOtp).toHaveBeenCalledWith('+66812345678'));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/login/otp?phone=' + encodeURIComponent('+66812345678')),
    );
  });

  it('shows an error and does not navigate when the OTP request fails', async () => {
    requestOtp.mockRejectedValue(new Error('เครือข่ายขัดข้อง'));
    render(<LoginPage />);

    fireEvent.change(screen.getByTestId('input-phone'), { target: { value: '812345678' } });
    fireEvent.click(screen.getByTestId('button-request-otp'));

    await screen.findByText('เครือข่ายขัดข้อง');
    expect(push).not.toHaveBeenCalled();
  });

  it('shows the session-expired banner when arriving after an expired session', () => {
    sessionExpiredFlag = true;
    render(<LoginPage />);
    expect(screen.getByTestId('session-expired-banner')).toBeInTheDocument();
  });

  it('redirects away from login when already signed in', () => {
    mockSession = { access_token: 'a' };
    render(<LoginPage />);
    expect(replace).toHaveBeenCalledWith('/');
  });
});
