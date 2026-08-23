import { act, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text } from 'react-native';
import { CartProvider } from '../hooks/useCart';
import { AuthProvider } from '../hooks/useAuth';
import { CheckoutScreen } from '../screens/CheckoutScreen';
import { repositories } from '../repositories';
import type { Cart } from '../domain/cart';
import type { AddressRepository, CartRepository } from '../repositories/types';

/**
 * D-2 — during E-3F manual acceptance, creating a real address through the
 * DQ-04 UI and returning to Checkout left the address row on `เลือกที่อยู่`:
 * `CheckoutScreen` only fetched addresses on mount. This exercises the fix —
 * a focus refetch, same pattern as `AddressScreen`'s own — through a REAL
 * two-screen navigator (not the usual mocked `useNavigation`), because the
 * behaviour under test is a real `focus` event, which a mocked navigation
 * object cannot produce.
 */

jest.mock('../hooks/useAuth', () => {
  const actual = jest.requireActual('../hooks/useAuth');
  return {
    ...actual,
    useAuth: () => ({
      initialising: false,
      session: { user: { id: 'user-1' } },
      profile: null,
      profileError: null,
    }),
  };
});

const CART: Cart = {
  id: 'cart-1',
  shopId: 'shop-1',
  lines: [
    {
      id: 'ci-1',
      menuItemId: 'mi-1',
      name: 'ส้มตำไทย',
      basePriceSatang: 6000,
      isAvailable: true,
      quantity: 1,
      note: '',
      options: [],
    },
  ],
  unresolvedLineIds: [],
};

const DEFAULT_ADDRESS = {
  id: 'address-1',
  label: 'บ้าน',
  glyph: '📍',
  line: 'ที่อยู่ทดสอบ',
  isDefault: true,
  rawLabel: 'บ้าน',
  recipientName: 'ลูกค้า ทดสอบ',
  recipientPhone: '+66811111111',
  addressLine: 'ที่อยู่ทดสอบ',
  landmark: null,
  instructions: null,
  lat: null,
  lng: null,
};

/** Stands in for AddressForm — the test only needs somewhere else to focus. */
function OtherScreen() {
  return <Text testID="screen-other">other</Text>;
}

const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef();

function renderCheckoutInRealStack() {
  return render(
    <NavigationContainer ref={navigationRef}>
      <AuthProvider>
        <CartProvider>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Checkout" component={CheckoutScreen} />
            <Stack.Screen name="Other" component={OtherScreen} />
          </Stack.Navigator>
        </CartProvider>
      </AuthProvider>
    </NavigationContainer>,
  );
}

function stub(listAddresses: jest.Mock) {
  const cartRepo: CartRepository = {
    getCart: jest.fn().mockResolvedValue(CART),
    addItem: jest.fn(),
    setQuantity: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
  };
  const addressRepo: AddressRepository = {
    listAddresses,
    createAddress: jest.fn(),
    updateAddress: jest.fn(),
    archiveAddress: jest.fn(),
  };

  (repositories as unknown as { cart: CartRepository }).cart = cartRepo;
  (repositories as unknown as { addresses: AddressRepository }).addresses = addressRepo;
}

it('reloads addresses when Checkout regains focus, so a newly-created default becomes available', async () => {
  const listAddresses = jest
    .fn()
    .mockResolvedValueOnce([]) // mount: no address yet
    .mockResolvedValueOnce([DEFAULT_ADDRESS]); // after returning from AddressForm
  stub(listAddresses);

  renderCheckoutInRealStack();

  await waitFor(() => expect(screen.getByTestId('screen-checkout')).toBeTruthy());
  await waitFor(() => expect(screen.getByText('เลือกที่อยู่')).toBeTruthy());
  expect(listAddresses).toHaveBeenCalledTimes(1);

  // Leave Checkout (as AddressFormScreen would) and come back to it.
  act(() => {
    navigationRef.navigate('Other' as never);
  });
  await waitFor(() => expect(screen.getByTestId('screen-other')).toBeTruthy());

  act(() => {
    navigationRef.navigate('Checkout' as never);
  });

  await waitFor(() => expect(listAddresses).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByText(DEFAULT_ADDRESS.label)).toBeTruthy());
});

it('does not fetch a second time on the initial mount', async () => {
  const listAddresses = jest.fn().mockResolvedValue([DEFAULT_ADDRESS]);
  stub(listAddresses);

  renderCheckoutInRealStack();

  await waitFor(() => expect(screen.getByText(DEFAULT_ADDRESS.label)).toBeTruthy());
  expect(listAddresses).toHaveBeenCalledTimes(1);
});
