import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { AuthProvider } from '../hooks/useAuth';
import { ProfileScreen } from './ProfileScreen';

/**
 * D-1 — DQ-04-01 names บัญชี → ที่อยู่ของฉัน as a reused address-management
 * entry point, but the `ที่อยู่จัดส่ง` row had no `onPress` and was dead.
 * This is the one delta: the row now navigates to the existing `Address`
 * route, the same destination and call shape `CheckoutScreen` already uses.
 */

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), setOptions: jest.fn() }),
  };
});

function renderScreen() {
  return render(
    <NavigationContainer>
      <AuthProvider>
        <ProfileScreen />
      </AuthProvider>
    </NavigationContainer>,
  );
}

beforeEach(() => {
  mockNavigate.mockClear();
});

it('the ที่อยู่จัดส่ง row navigates to Address (DQ-04-01 entry point)', async () => {
  renderScreen();
  await waitFor(() => expect(screen.getByTestId('screen-profile')).toBeTruthy());

  fireEvent.press(screen.getByTestId('row-profile-address'));

  expect(mockNavigate).toHaveBeenCalledWith('Address');
});
