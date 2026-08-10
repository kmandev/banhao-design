import { act, render, screen } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { CartProvider } from '../hooks/useCart';
import { PromptPayQrScreen } from '../screens/payment';

/**
 * DEF-01. `PayExpired` (12e) was registered in the navigator but nothing routed
 * to it: the QR counted down to zero and stayed there, so a documented payment
 * state was unreachable.
 *
 * This asserts the transition itself — QR TTL reaching 0 moves to PayExpired —
 * and nothing about money. No payment is created, and no payment is confirmed;
 * CON-002 still means only a verified provider webhook may do that.
 */

const mockReplace = jest.fn();
const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      replace: mockReplace,
      goBack: jest.fn(),
      setOptions: jest.fn(),
    }),
    useRoute: () => ({ params: {} }),
  };
});

const QR_TTL_SECONDS = 600;

function renderQr() {
  return render(
    <NavigationContainer>
      <CartProvider>
        <PromptPayQrScreen />
      </CartProvider>
    </NavigationContainer>,
  );
}

/**
 * One second at a time. Each tick schedules the next timeout from an effect that
 * only runs after React commits, so a single large jump would fire one timer and
 * stop — the countdown has to be driven the way it actually runs.
 */
async function advanceSeconds(seconds: number) {
  for (let i = 0; i < seconds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
  }
}

describe('PromptPay QR expiry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockReplace.mockClear();
    mockNavigate.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the countdown and does not expire while time remains', async () => {
    renderQr();

    expect(screen.getByTestId('screen-promptpay-qr')).toBeTruthy();

    await advanceSeconds(QR_TTL_SECONDS - 1);

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('moves to PayExpired when the TTL reaches 0', async () => {
    renderQr();

    await advanceSeconds(QR_TTL_SECONDS);

    expect(mockReplace).toHaveBeenCalledWith('PayExpired');
  });

  it('replaces rather than pushes, so Back cannot return to a dead QR', async () => {
    renderQr();

    await advanceSeconds(QR_TTL_SECONDS);

    expect(mockNavigate).not.toHaveBeenCalledWith('PayExpired');
  });
});
