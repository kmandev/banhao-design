import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OtpPage from './page';

const replace = jest.fn();
const push = jest.fn();
let phoneParam: string | null = '+66812345678';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
  useSearchParams: () => ({ get: (key: string) => (key === 'phone' ? phoneParam : null) }),
}));

const verifyOtp = jest.fn();
const requestOtp = jest.fn();
let mockSession: unknown = null;

jest.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    session: mockSession,
    verifyOtp: (phone: string, token: string) => verifyOtp(phone, token),
    requestOtp: (phone: string) => requestOtp(phone),
  }),
}));

jest.mock('../../../lib/supabase', () => ({ isSupabaseConfigured: true }));

describe('OtpPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSession = null;
    phoneParam = '+66812345678';
  });

  it('renders the OTP form with the phone number from the query string', async () => {
    render(<OtpPage />);
    expect(await screen.findByTestId('input-otp')).toBeInTheDocument();
    expect(screen.getByText(/\+66812345678/)).toBeInTheDocument();
  });

  it('redirects to /login when no phone number is present', async () => {
    phoneParam = null;
    render(<OtpPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });

  it('disables verify until a 6-digit code is entered', async () => {
    render(<OtpPage />);
    const button = await screen.findByTestId('button-verify-otp');
    expect(button).toBeDisabled();

    fireEvent.change(await screen.findByTestId('input-otp'), { target: { value: '123456' } });
    expect(button).not.toBeDisabled();
  });

  it('calls verifyOtp with the phone and code on submit', async () => {
    verifyOtp.mockResolvedValue(undefined);
    render(<OtpPage />);

    fireEvent.change(await screen.findByTestId('input-otp'), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('button-verify-otp'));

    await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith('+66812345678', '123456'));
  });

  it('shows an error on an invalid or expired code and does not navigate', async () => {
    verifyOtp.mockRejectedValue(new Error('รหัสไม่ถูกต้อง'));
    render(<OtpPage />);

    fireEvent.change(await screen.findByTestId('input-otp'), { target: { value: '000000' } });
    fireEvent.click(screen.getByTestId('button-verify-otp'));

    await screen.findByText('รหัสไม่ถูกต้อง');
    expect(push).not.toHaveBeenCalled();
  });

  it('disables resend during the countdown', async () => {
    render(<OtpPage />);
    const resend = await screen.findByTestId('button-resend-otp');
    expect(resend).toBeDisabled();
    expect(resend).toHaveTextContent('60 วินาที');
  });

  it('redirects to / once a session appears (post-verify)', async () => {
    mockSession = { access_token: 'a' };
    render(<OtpPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  });
});
