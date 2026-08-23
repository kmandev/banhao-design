import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { AddressFormScreen } from './AddressFormScreen';
import { repositories } from '../repositories';
import type { Address } from '../mocks/types';
import type { AddressPatchInput, AddressRepository, AddressWriteInput } from '../repositories/types';

/**
 * Phase DQ-04 — C-11a, one screen for create and edit (DQ-04-05). These
 * tests exercise the approved design's own required behaviours: the three
 * required fields, the phone normalisation table, the default-address rules
 * (DQ-04-04), and archive/delete (DQ-04-06) — not the underlying HTTP
 * mapping, which `apiAddresses.test.ts` already covers.
 */

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: { mode: 'create' } | { mode: 'edit'; addressId: string };

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
      dispatch: jest.fn(),
    }),
    useRoute: () => ({ params: mockRouteParams }),
  };
});

let mockProfile: { phone: string | null; displayName: string | null } | null = null;

jest.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ profile: mockProfile }),
}));

function address(overrides: Partial<Address>): Address {
  return {
    id: 'addr-1',
    label: 'บ้าน',
    glyph: '🏠',
    line: '88 หมู่ 4 ต.บุณฑริก อ.บุณฑริก',
    isDefault: false,
    rawLabel: 'บ้าน',
    recipientName: 'สมหญิง ใจดี',
    recipientPhone: '+66812345678',
    addressLine: '88 หมู่ 4 ต.บุณฑริก อ.บุณฑริก',
    landmark: 'ใกล้ตลาด',
    instructions: null,
    lat: null,
    lng: null,
    ...overrides,
  };
}

function stub(seed: Address[]): {
  createAddress: jest.Mock;
  updateAddress: jest.Mock;
  archiveAddress: jest.Mock;
} {
  const createAddress = jest.fn(
    async (input: AddressWriteInput): Promise<Address> => ({
      ...address({}),
      id: 'addr-new',
      recipientName: input.recipientName,
      recipientPhone: input.recipientPhone,
      addressLine: input.addressLine,
      isDefault: input.isDefault ?? false,
    }),
  );
  const updateAddress = jest.fn(async (id: string, patch: AddressPatchInput): Promise<Address> => {
    const base = seed.find((a) => a.id === id) ?? address({});
    return {
      ...base,
      id,
      recipientName: patch.recipientName ?? base.recipientName,
      recipientPhone: patch.recipientPhone ?? base.recipientPhone,
      addressLine: patch.addressLine ?? base.addressLine,
      landmark: 'landmark' in patch ? (patch.landmark ?? null) : base.landmark,
      instructions: 'instructions' in patch ? (patch.instructions ?? null) : base.instructions,
      isDefault: patch.isDefault ?? base.isDefault,
    };
  });
  const archiveAddress = jest.fn(async () => undefined);

  const repo: AddressRepository = {
    listAddresses: jest.fn().mockResolvedValue(seed),
    createAddress,
    updateAddress,
    archiveAddress,
  };
  (repositories as unknown as { addresses: AddressRepository }).addresses = repo;

  return { createAddress, updateAddress, archiveAddress };
}

function renderScreen() {
  return render(
    <NavigationContainer>
      <AddressFormScreen />
    </NavigationContainer>,
  );
}

beforeEach(() => {
  mockNavigate.mockReset();
  mockGoBack.mockReset();
  mockProfile = null;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('create mode', () => {
  beforeEach(() => {
    mockRouteParams = { mode: 'create' };
  });

  it('1 · renders', async () => {
    stub([address({ id: 'addr-1', isDefault: true })]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('screen-address-form')).toBeTruthy());
  });

  it('prefills ผู้รับ/เบอร์โทร from the profile when available, still editable', async () => {
    stub([]);
    mockProfile = { phone: '+66899999999', displayName: 'ทดสอบ ผู้ใช้' };
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('screen-address-form')).toBeTruthy());

    expect(screen.getByTestId('input-recipient-name').props.value).toBe('ทดสอบ ผู้ใช้');
    expect(screen.getByTestId('input-recipient-phone').props.value).toBe('089 999 9999');

    fireEvent.changeText(screen.getByTestId('input-recipient-name'), 'แก้ไขแล้ว');
    expect(screen.getByTestId('input-recipient-name').props.value).toBe('แก้ไขแล้ว');
  });

  it('2a · the CTA is disabled until the three required fields are filled (state 1/2)', async () => {
    stub([]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('screen-address-form')).toBeTruthy());

    expect(screen.getByTestId('button-save-address').props.accessibilityState.disabled).toBe(true);
    // No validation shown yet, per state 1/2 — only the disabled CTA guards emptiness.
    expect(screen.queryByText('กรุณากรอกชื่อผู้รับ')).toBeNull();

    fireEvent.changeText(screen.getByTestId('input-recipient-name'), 'สมชาย ใจดี');
    fireEvent.changeText(screen.getByTestId('input-recipient-phone'), '0812345678');
    fireEvent.changeText(
      screen.getByTestId('input-address-line'),
      'บ้านเลขที่ 1 หมู่ 1 ต.บุณฑริก',
    );

    expect(screen.getByTestId('button-save-address').props.accessibilityState.disabled).toBe(
      false,
    );
  });

  it('2b · required fields validate on submit once the CTA is reachable (state 3)', async () => {
    stub([]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('screen-address-form')).toBeTruthy());

    // Non-empty (so the CTA is enabled) but too short to pass — the disabled
    // CTA already guards true emptiness; this exercises the length rules.
    fireEvent.changeText(screen.getByTestId('input-recipient-name'), 'ก');
    fireEvent.changeText(screen.getByTestId('input-recipient-phone'), '0812345678');
    fireEvent.changeText(screen.getByTestId('input-address-line'), 'สั้น');
    fireEvent.press(screen.getByTestId('button-save-address'));

    await waitFor(() => expect(screen.getByText('กรุณากรอกชื่อผู้รับ')).toBeTruthy());
    expect(
      screen.getByText('ใส่ที่อยู่ให้ครบ เช่น บ้านเลขที่ หมู่ ตำบล อำเภอ'),
    ).toBeTruthy();
  });

  it('3 · invalid phone validates', async () => {
    stub([]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('screen-address-form')).toBeTruthy());

    fireEvent.changeText(screen.getByTestId('input-recipient-name'), 'สมชาย ใจดี');
    fireEvent.changeText(screen.getByTestId('input-recipient-phone'), '0812345');
    fireEvent.changeText(
      screen.getByTestId('input-address-line'),
      'บ้านเลขที่ 1 หมู่ 1 ต.บุณฑริก',
    );
    fireEvent.press(screen.getByTestId('button-save-address'));

    await waitFor(() =>
      expect(screen.getByText('เบอร์โทรไม่ถูกต้อง ใส่เบอร์มือถือ 10 หลัก')).toBeTruthy(),
    );
  });

  it('4 · valid phone normalizes to E.164 on submit', async () => {
    const { createAddress } = stub([]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('screen-address-form')).toBeTruthy());

    fireEvent.changeText(screen.getByTestId('input-recipient-name'), 'สมชาย ใจดี');
    fireEvent.changeText(screen.getByTestId('input-recipient-phone'), '081-234-5678');
    fireEvent.changeText(
      screen.getByTestId('input-address-line'),
      'บ้านเลขที่ 1 หมู่ 1 ต.บุณฑริก',
    );
    fireEvent.press(screen.getByTestId('button-save-address'));

    await waitFor(() => expect(createAddress).toHaveBeenCalled());
    expect(createAddress.mock.calls[0][0]).toMatchObject({ recipientPhone: '+66812345678' });
  });

  it('rejects an unrecognisable phone shape the same way (e.g. missing leading 0/+66)', async () => {
    stub([]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('screen-address-form')).toBeTruthy());

    fireEvent.changeText(screen.getByTestId('input-recipient-name'), 'สมชาย ใจดี');
    fireEvent.changeText(screen.getByTestId('input-recipient-phone'), '812345678');
    fireEvent.changeText(
      screen.getByTestId('input-address-line'),
      'บ้านเลขที่ 1 หมู่ 1 ต.บุณฑริก',
    );
    fireEvent.press(screen.getByTestId('button-save-address'));

    await waitFor(() =>
      expect(screen.getByText('เบอร์โทรไม่ถูกต้อง ใส่เบอร์มือถือ 10 หลัก')).toBeTruthy(),
    );
  });

  it('5 · successful create navigates back selecting the new address with a toast', async () => {
    const { createAddress } = stub([]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('screen-address-form')).toBeTruthy());

    fireEvent.changeText(screen.getByTestId('input-recipient-name'), 'สมชาย ใจดี');
    fireEvent.changeText(screen.getByTestId('input-recipient-phone'), '0812345678');
    fireEvent.changeText(
      screen.getByTestId('input-address-line'),
      'บ้านเลขที่ 1 หมู่ 1 ต.บุณฑริก',
    );
    fireEvent.press(screen.getByTestId('button-save-address'));

    await waitFor(() => expect(createAddress).toHaveBeenCalled());
    expect(mockNavigate).toHaveBeenCalledWith('Address', {
      selectedId: 'addr-new',
      toast: 'บันทึกที่อยู่แล้ว',
    });
  });

  it('6 · shows a saving state while the request is in flight', async () => {
    stub([]);
    let resolveCreate: (a: Address) => void = () => {};
    (repositories.addresses as AddressRepository).createAddress = jest.fn(
      () => new Promise<Address>((resolve) => (resolveCreate = resolve)),
    );
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('screen-address-form')).toBeTruthy());

    fireEvent.changeText(screen.getByTestId('input-recipient-name'), 'สมชาย ใจดี');
    fireEvent.changeText(screen.getByTestId('input-recipient-phone'), '0812345678');
    fireEvent.changeText(
      screen.getByTestId('input-address-line'),
      'บ้านเลขที่ 1 หมู่ 1 ต.บุณฑริก',
    );
    fireEvent.press(screen.getByTestId('button-save-address'));

    await waitFor(() =>
      expect(screen.getByTestId('button-save-address').props.accessibilityState.busy).toBe(true),
    );
    resolveCreate(address({ id: 'addr-new' }));
  });

  it('7 · API failure keeps the entered values and shows a retry banner', async () => {
    stub([]);
    (repositories.addresses as AddressRepository).createAddress = jest
      .fn()
      .mockRejectedValue(new Error('INTERNAL_ERROR'));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('screen-address-form')).toBeTruthy());

    fireEvent.changeText(screen.getByTestId('input-recipient-name'), 'สมชาย ใจดี');
    fireEvent.changeText(screen.getByTestId('input-recipient-phone'), '0812345678');
    fireEvent.changeText(
      screen.getByTestId('input-address-line'),
      'บ้านเลขที่ 1 หมู่ 1 ต.บุณฑริก',
    );
    fireEvent.press(screen.getByTestId('button-save-address'));

    await waitFor(() => expect(screen.getByTestId('address-form-api-error')).toBeTruthy());
    expect(screen.getByText('⚠️ บันทึกที่อยู่ไม่สำเร็จ กรุณาลองอีกครั้ง')).toBeTruthy();
    // Values survive the failure — nothing is cleared.
    expect(screen.getByTestId('input-recipient-name').props.value).toBe('สมชาย ใจดี');
  });

  it('11a · forces and locks the default toggle on for the first address', async () => {
    stub([]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('screen-address-form')).toBeTruthy());

    const toggle = screen.getByTestId('switch-address-default');
    expect(toggle.props.value).toBe(true);
    expect(toggle.props.disabled).toBe(true);
  });

  it('11b · a second address defaults the toggle to off and interactive', async () => {
    stub([address({ id: 'addr-1', isDefault: true })]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('screen-address-form')).toBeTruthy());

    const toggle = screen.getByTestId('switch-address-default');
    expect(toggle.props.value).toBe(false);
    expect(toggle.props.disabled).toBe(false);
  });
});

describe('edit mode', () => {
  it('8 · renders with the edit title and CTA', async () => {
    mockRouteParams = { mode: 'edit', addressId: 'addr-1' };
    stub([address({ id: 'addr-1' })]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('screen-address-form')).toBeTruthy());
    expect(screen.getByText('บันทึกการแก้ไข')).toBeTruthy();
  });

  it('9 · prefills the existing values', async () => {
    mockRouteParams = { mode: 'edit', addressId: 'addr-1' };
    stub([
      address({
        id: 'addr-1',
        recipientName: 'สมหญิง ใจดี',
        recipientPhone: '+66812345678',
        addressLine: '88 หมู่ 4 ต.บุณฑริก',
        landmark: 'ใกล้ตลาด',
      }),
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('screen-address-form')).toBeTruthy());

    expect(screen.getByTestId('input-recipient-name').props.value).toBe('สมหญิง ใจดี');
    expect(screen.getByTestId('input-address-line').props.value).toBe('88 หมู่ 4 ต.บุณฑริก');
    expect(screen.getByTestId('input-landmark').props.value).toBe('ใกล้ตลาด');
  });

  it('10 · successful update sends only the changed fields and navigates back', async () => {
    mockRouteParams = { mode: 'edit', addressId: 'addr-1' };
    const { updateAddress } = stub([address({ id: 'addr-1', recipientName: 'สมหญิง ใจดี' })]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('screen-address-form')).toBeTruthy());

    fireEvent.changeText(screen.getByTestId('input-recipient-name'), 'สมหญิง ใหม่');
    fireEvent.press(screen.getByTestId('button-save-address'));

    await waitFor(() => expect(updateAddress).toHaveBeenCalled());
    expect(updateAddress).toHaveBeenCalledWith('addr-1', { recipientName: 'สมหญิง ใหม่' });
    expect(mockNavigate).toHaveBeenCalledWith('Address', {
      selectedId: 'addr-1',
      toast: 'บันทึกการแก้ไขแล้ว',
    });
  });

  it('11c · the current default is locked on and cannot be cleared', async () => {
    mockRouteParams = { mode: 'edit', addressId: 'addr-1' };
    stub([
      address({ id: 'addr-1', isDefault: true }),
      address({ id: 'addr-2', label: 'ที่ทำงาน' }),
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('screen-address-form')).toBeTruthy());

    const toggle = screen.getByTestId('switch-address-default');
    expect(toggle.props.value).toBe(true);
    expect(toggle.props.disabled).toBe(true);
  });

  it('12 · pressing delete opens a confirmation naming the address', async () => {
    mockRouteParams = { mode: 'edit', addressId: 'addr-1' };
    stub([
      address({ id: 'addr-1', label: 'บ้านของฉัน', isDefault: false }),
      address({ id: 'addr-2', label: 'ที่ทำงาน', isDefault: true }),
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('screen-address-form')).toBeTruthy());

    fireEvent.press(screen.getByTestId('button-delete-address'));

    expect(Alert.alert).toHaveBeenCalledWith(
      'ลบที่อยู่นี้?',
      expect.stringContaining('บ้านของฉัน'),
      expect.any(Array),
    );
  });

  it('13 · archive is blocked with an inline note when the address is the default and others exist', async () => {
    mockRouteParams = { mode: 'edit', addressId: 'addr-1' };
    stub([
      address({ id: 'addr-1', isDefault: true }),
      address({ id: 'addr-2', label: 'ที่ทำงาน' }),
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('screen-address-form')).toBeTruthy());

    expect(screen.queryByTestId('button-delete-address')).toBeNull();
    expect(screen.getByTestId('address-delete-blocked-note')).toBeTruthy();
  });

  it('13b · archive is allowed on the default address when it is the only one', async () => {
    mockRouteParams = { mode: 'edit', addressId: 'addr-1' };
    stub([address({ id: 'addr-1', isDefault: true })]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('screen-address-form')).toBeTruthy());

    expect(screen.getByTestId('button-delete-address')).toBeTruthy();
    expect(screen.queryByTestId('address-delete-blocked-note')).toBeNull();
  });

  it('14 · confirming delete archives and navigates back with a toast', async () => {
    mockRouteParams = { mode: 'edit', addressId: 'addr-1' };
    const { archiveAddress } = stub([address({ id: 'addr-1', isDefault: false })]);
    (Alert.alert as jest.Mock).mockImplementation((_title, _msg, buttons) => {
      buttons?.[1]?.onPress?.();
    });
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('screen-address-form')).toBeTruthy());

    fireEvent.press(screen.getByTestId('button-delete-address'));

    await waitFor(() => expect(archiveAddress).toHaveBeenCalledWith('addr-1'));
    expect(mockNavigate).toHaveBeenCalledWith('Address', { toast: 'ลบที่อยู่แล้ว' });
  });

  it('cancelling the delete confirmation archives nothing', async () => {
    mockRouteParams = { mode: 'edit', addressId: 'addr-1' };
    const { archiveAddress } = stub([address({ id: 'addr-1', isDefault: false })]);
    (Alert.alert as jest.Mock).mockImplementation((_title, _msg, buttons) => {
      buttons?.[0]?.onPress?.();
    });
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('screen-address-form')).toBeTruthy());

    fireEvent.press(screen.getByTestId('button-delete-address'));

    expect(archiveAddress).not.toHaveBeenCalled();
  });
});
