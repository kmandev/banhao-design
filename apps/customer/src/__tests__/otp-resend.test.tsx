import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { OtpScreen } from '../screens/auth/OtpScreen';
import type { AuthStackParamList } from '../navigation/types';

/**
 * DEF-02. `ขอรหัสใหม่` used to reset the local countdown and nothing else, so a
 * user whose code had expired could never get a new one.
 *
 * This asserts the button reaches the auth layer. `useAuth` is mocked rather
 * than the Supabase SDK so no request is made and no code is involved — there
 * is no OTP in this test to log, store, or leak.
 */

const mockRequestOtp = jest.fn();
const mockVerifyOtp = jest.fn();

jest.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    requestOtp: mockRequestOtp,
    verifyOtp: mockVerifyOtp,
  }),
}));

jest.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {},
}));

const PHONE = '+66812345678';
const RESEND_SECONDS = 60;

type Props = NativeStackScreenProps<AuthStackParamList, 'Otp'>;

function renderOtp() {
  const navigation = { goBack: jest.fn() } as unknown as Props['navigation'];
  const route = { params: { phone: PHONE } } as unknown as Props['route'];

  return render(
    <NavigationContainer>
      <OtpScreen navigation={navigation} route={route} />
    </NavigationContainer>,
  );
}

/** One second at a time — see the note in payment-expiry.test.tsx. */
async function elapseCountdown() {
  for (let i = 0; i < RESEND_SECONDS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
  }
}

describe('OTP resend', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRequestOtp.mockReset().mockResolvedValue(undefined);
    mockVerifyOtp.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is disabled until the countdown elapses', async () => {
    renderOtp();

    fireEvent.press(screen.getByTestId('button-resend-otp'));

    expect(mockRequestOtp).not.toHaveBeenCalled();
  });

  it('requests a new code from the auth layer', async () => {
    renderOtp();
    await elapseCountdown();

    await act(async () => {
      fireEvent.press(screen.getByTestId('button-resend-otp'));
    });

    expect(mockRequestOtp).toHaveBeenCalledTimes(1);
    expect(mockRequestOtp).toHaveBeenCalledWith(PHONE);
  });

  it('restarts the countdown after a successful resend', async () => {
    renderOtp();
    await elapseCountdown();

    await act(async () => {
      fireEvent.press(screen.getByTestId('button-resend-otp'));
    });

    expect(screen.getByText(`ขอรหัสใหม่ใน ${RESEND_SECONDS} วินาที`)).toBeTruthy();
  });

  it('surfaces the failure and leaves the button available to retry', async () => {
    mockRequestOtp.mockRejectedValueOnce(new Error('Request rate limit reached'));
    renderOtp();
    await elapseCountdown();

    await act(async () => {
      fireEvent.press(screen.getByTestId('button-resend-otp'));
    });

    expect(screen.getByText('Request rate limit reached')).toBeTruthy();
    expect(screen.getByText('ขอรหัสใหม่')).toBeTruthy();
  });
});
