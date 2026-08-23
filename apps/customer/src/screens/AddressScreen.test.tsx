import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { AddressScreen } from './AddressScreen';
import { repositories } from '../repositories';
import type { Address } from '../mocks/types';
import type { AddressRepository } from '../repositories/types';

/**
 * Phase DQ-04 — the three deltas C-11 gets on top of its Phase E-3A
 * selection behaviour: the add button navigates, each row's `แก้ไข` action
 * navigates with the right id, and the default badge is scoped to the
 * default row only.
 */

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: { selectedId?: string; toast?: string } | undefined;

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, setOptions: jest.fn() }),
    useRoute: () => ({ params: mockRouteParams }),
  };
});

function address(overrides: Partial<Address>): Address {
  return {
    id: 'addr-1',
    label: 'บ้าน',
    glyph: '🏠',
    line: 'ที่อยู่ทดสอบ',
    isDefault: false,
    rawLabel: 'บ้าน',
    recipientName: 'ลูกค้า ทดสอบ',
    recipientPhone: '+66811111111',
    addressLine: 'ที่อยู่ทดสอบ',
    landmark: null,
    instructions: null,
    lat: null,
    lng: null,
    ...overrides,
  };
}

function stub(addresses: Address[]) {
  const repo: AddressRepository = {
    listAddresses: jest.fn().mockResolvedValue(addresses),
    createAddress: jest.fn(),
    updateAddress: jest.fn(),
    archiveAddress: jest.fn(),
  };
  (repositories as unknown as { addresses: AddressRepository }).addresses = repo;
}

function renderScreen() {
  return render(
    <NavigationContainer>
      <AddressScreen />
    </NavigationContainer>,
  );
}

beforeEach(() => {
  mockNavigate.mockReset();
  mockGoBack.mockReset();
  mockRouteParams = undefined;
});

it('add button navigates to create mode', async () => {
  stub([address({ id: 'addr-1', isDefault: true })]);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-address')).toBeTruthy());
  fireEvent.press(screen.getByTestId('button-add-address'));

  expect(mockNavigate).toHaveBeenCalledWith('AddressForm', { mode: 'create' });
});

it('the empty state also offers the add button (DQ-04-01: reused, not a second concept)', async () => {
  stub([]);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-address-empty')).toBeTruthy());
  fireEvent.press(screen.getByText('+ เพิ่มที่อยู่ใหม่'));

  expect(mockNavigate).toHaveBeenCalledWith('AddressForm', { mode: 'create' });
});

it('edit action navigates with the correct address id', async () => {
  stub([
    address({ id: 'addr-1', isDefault: true }),
    address({ id: 'addr-2', label: 'ที่ทำงาน' }),
  ]);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-address')).toBeTruthy());
  fireEvent.press(screen.getByTestId('address-edit-addr-2'));

  expect(mockNavigate).toHaveBeenCalledWith('AddressForm', { mode: 'edit', addressId: 'addr-2' });
});

it('renders the default badge only on the default address', async () => {
  stub([
    address({ id: 'addr-1', isDefault: true }),
    address({ id: 'addr-2', label: 'ที่ทำงาน', isDefault: false }),
  ]);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-address')).toBeTruthy());

  expect(screen.getByText('ค่าเริ่มต้น')).toBeTruthy();
  // Only one row is default, so the badge text appears exactly once.
  expect(screen.getAllByText('ค่าเริ่มต้น')).toHaveLength(1);
});

it('selects and shows the toast for the address AddressFormScreen just returned with', async () => {
  stub([address({ id: 'addr-1', isDefault: true }), address({ id: 'addr-2', label: 'บ้านแม่' })]);
  mockRouteParams = { selectedId: 'addr-2', toast: 'บันทึกที่อยู่แล้ว' };
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-address')).toBeTruthy());
  expect(screen.getByTestId('address-toast')).toBeTruthy();
  expect(screen.getByText('✓ บันทึกที่อยู่แล้ว')).toBeTruthy();
});
