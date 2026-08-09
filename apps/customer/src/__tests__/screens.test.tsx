import { render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { CartProvider } from '../hooks/useCart';
import { AuthProvider } from '../hooks/useAuth';

import { SplashScreen } from '../screens/auth/SplashScreen';
import { OnboardingScreen } from '../screens/auth/OnboardingScreen';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { OtpScreen } from '../screens/auth/OtpScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { ShopScreen } from '../screens/ShopScreen';
import { ItemOptionsScreen } from '../screens/ItemOptionsScreen';
import { CartScreen } from '../screens/CartScreen';
import { CheckoutScreen } from '../screens/CheckoutScreen';
import { AddressScreen } from '../screens/AddressScreen';
import { OrdersScreen } from '../screens/OrdersScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { OrderConfirmedScreen } from '../screens/OrderConfirmedScreen';
import { OrderTrackingScreen } from '../screens/OrderTrackingScreen';
import { RatingScreen } from '../screens/RatingScreen';
import {
  PromptPayQrScreen,
  PayCheckingScreen,
  PaySuccessScreen,
  PayFailedScreen,
  PayExpiredScreen,
  PayDuplicateScreen,
  PayDetailScreen,
  RefundScreen,
} from '../screens/payment';

/**
 * Smoke tests: every screen must mount without throwing.
 *
 * Route params are supplied via a mocked useRoute so screens can be rendered in
 * isolation rather than driving the whole navigator for each one.
 */

const mockRouteParams: Record<string, unknown> = {};

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: jest.fn(),
      goBack: jest.fn(),
      setOptions: jest.fn(),
    }),
    useRoute: () => ({ params: mockRouteParams }),
  };
});

function renderScreen(ui: React.ReactElement) {
  return render(
    <NavigationContainer>
      <AuthProvider>
        <CartProvider>{ui}</CartProvider>
      </AuthProvider>
    </NavigationContainer>,
  );
}

beforeEach(() => {
  for (const key of Object.keys(mockRouteParams)) delete mockRouteParams[key];
});

describe('Screen smoke tests', () => {
  it('01 Splash renders', () => {
    renderScreen(<SplashScreen />);
    expect(screen.getByTestId('screen-splash')).toBeTruthy();
  });

  it('02 Onboarding renders', () => {
    const Screen = OnboardingScreen as unknown as () => React.ReactElement;
    renderScreen(<Screen />);
    expect(screen.getByTestId('screen-onboarding')).toBeTruthy();
  });

  it('03 Login renders', () => {
    const Screen = LoginScreen as unknown as () => React.ReactElement;
    renderScreen(<Screen />);
    expect(screen.getByTestId('screen-login')).toBeTruthy();
  });

  it('04 OTP renders', () => {
    // OtpScreen reads route.params from props (it is a navigator screen), so
    // the mocked useRoute does not apply — pass a real route object.
    const Screen = OtpScreen as unknown as (p: {
      route: { params: { phone: string } };
    }) => React.ReactElement;
    renderScreen(<Screen route={{ params: { phone: '+66812345678' } }} />);
    expect(screen.getByTestId('screen-otp')).toBeTruthy();
  });

  it('05 Home renders and resolves to content', async () => {
    renderScreen(<HomeScreen />);
    expect(screen.getByTestId('screen-home-loading')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('screen-home')).toBeTruthy());
  });

  it('06 Search renders its idle state', () => {
    renderScreen(<SearchScreen />);
    expect(screen.getByTestId('state-search-idle')).toBeTruthy();
  });

  it('07 Shop renders', async () => {
    mockRouteParams.shopId = 'shop-somtam-pathongdee';
    renderScreen(<ShopScreen />);
    await waitFor(() => expect(screen.getByTestId('screen-shop')).toBeTruthy());
  });

  it('07 Shop renders the closed state for a closed shop', async () => {
    mockRouteParams.shopId = 'shop-grilled-chicken-je-muay';
    renderScreen(<ShopScreen />);
    await waitFor(() => expect(screen.getByTestId('state-shop-closed')).toBeTruthy());
  });

  it('08 ItemOptions renders', async () => {
    mockRouteParams.shopId = 'shop-somtam-pathongdee';
    mockRouteParams.itemId = 'menu-pad-kaprao-moo';
    renderScreen(<ItemOptionsScreen />);
    await waitFor(() => expect(screen.getByTestId('screen-item-options')).toBeTruthy());
  });

  it('09 Cart renders with items', () => {
    renderScreen(<CartScreen />);
    expect(screen.getByTestId('screen-cart')).toBeTruthy();
  });

  it('09 Cart renders the empty state', () => {
    render(
      <NavigationContainer>
        <CartProvider seed={[]}>
          <CartScreen />
        </CartProvider>
      </NavigationContainer>,
    );
    expect(screen.getByTestId('state-cart-empty')).toBeTruthy();
  });

  it('10 Checkout renders', () => {
    renderScreen(<CheckoutScreen />);
    expect(screen.getByTestId('screen-checkout')).toBeTruthy();
  });

  it('11 Address renders', async () => {
    renderScreen(<AddressScreen />);
    await waitFor(() => expect(screen.getByTestId('screen-address')).toBeTruthy());
  });

  it('12 PromptPay QR renders', () => {
    renderScreen(<PromptPayQrScreen />);
    expect(screen.getByTestId('screen-promptpay-qr')).toBeTruthy();
  });

  it('12b PayChecking renders', () => {
    renderScreen(<PayCheckingScreen />);
    expect(screen.getByTestId('state-pay-checking')).toBeTruthy();
  });

  it('12c PaySuccess renders', () => {
    renderScreen(<PaySuccessScreen />);
    expect(screen.getByTestId('state-pay-success')).toBeTruthy();
  });

  it('12d PayFailed renders', () => {
    renderScreen(<PayFailedScreen />);
    expect(screen.getByTestId('state-pay-failed')).toBeTruthy();
  });

  it('12e PayExpired renders', () => {
    renderScreen(<PayExpiredScreen />);
    expect(screen.getByTestId('state-pay-expired')).toBeTruthy();
  });

  it('12f PayDuplicate renders', () => {
    renderScreen(<PayDuplicateScreen />);
    expect(screen.getByTestId('state-pay-duplicate')).toBeTruthy();
  });

  it('12g PayDetail renders', () => {
    renderScreen(<PayDetailScreen />);
    expect(screen.getByTestId('screen-pay-detail')).toBeTruthy();
  });

  it('12h Refund renders', () => {
    renderScreen(<RefundScreen />);
    expect(screen.getByTestId('screen-refund')).toBeTruthy();
  });

  it('13 OrderConfirmed renders', () => {
    renderScreen(<OrderConfirmedScreen />);
    expect(screen.getByTestId('state-order-confirmed')).toBeTruthy();
  });

  it('14 OrderTracking renders', () => {
    mockRouteParams.state = 'DELIVERING';
    renderScreen(<OrderTrackingScreen />);
    expect(screen.getByTestId('screen-order-tracking')).toBeTruthy();
  });

  it('14 OrderTracking renders the no-driver state', () => {
    mockRouteParams.state = 'NO_DRIVER';
    renderScreen(<OrderTrackingScreen />);
    expect(screen.getByTestId('state-no-driver')).toBeTruthy();
  });

  it('14 OrderTracking renders the cancelled state', () => {
    mockRouteParams.state = 'CANCELLED';
    renderScreen(<OrderTrackingScreen />);
    expect(screen.getByTestId('state-cancelled')).toBeTruthy();
  });

  it('15 Rating renders', () => {
    renderScreen(<RatingScreen />);
    expect(screen.getByTestId('screen-rating')).toBeTruthy();
  });

  it('16 Orders renders', async () => {
    renderScreen(<OrdersScreen />);
    await waitFor(() => expect(screen.getByTestId('screen-orders')).toBeTruthy());
  });

  it('17 Notifications renders', async () => {
    renderScreen(<NotificationsScreen />);
    await waitFor(() => expect(screen.getByTestId('screen-notifications')).toBeTruthy());
  });

  it('18 Profile renders', () => {
    renderScreen(<ProfileScreen />);
    expect(screen.getByTestId('screen-profile')).toBeTruthy();
  });
});
