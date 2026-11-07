import { act, render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { NotificationsScreen } from './NotificationsScreen';
import { repositories } from '../repositories';
import type { AppNotification } from '../mocks/types';
import type { NotificationRepository } from '../repositories/types';

/**
 * H-5B — tap-to-mark-read against a stubbed notification repository.
 *
 * `repositories` is monkey-patched directly, matching `OrdersScreen.test.tsx`'s
 * own convention for this exact shape of test.
 */

const mockListNotifications = jest.fn();
const mockMarkNotificationRead = jest.fn();
const mockNavigate = jest.fn();
/** The latest focus callback the screen registered, so a test can simulate returning to the tab. */
const mockFocus: { current: (() => void) | null } = { current: null };

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const react = jest.requireActual('react');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate }),
    // Runs the callback once on mount (the first focus), as the real hook does,
    // and keeps it so a test can fire a later focus.
    useFocusEffect: (callback: () => void) => {
      react.useEffect(() => {
        mockFocus.current = callback;
        callback();
      }, [callback]);
    },
  };
});

function stub() {
  const notificationsRepo: NotificationRepository = {
    listNotifications: mockListNotifications,
    markNotificationRead: mockMarkNotificationRead,
  };
  (repositories as unknown as { notifications: NotificationRepository }).notifications =
    notificationsRepo;
}

function renderScreen() {
  return render(
    <NavigationContainer>
      <NotificationsScreen />
    </NavigationContainer>,
  );
}

const UNREAD: AppNotification = {
  id: 'n1',
  glyph: '🛵',
  title: 'ไรเดอร์กำลังไปส่ง',
  body: 'ออเดอร์ #BH000125 กำลังเดินทางมาหาคุณ',
  time: '18:52',
  read: false,
};

const READ: AppNotification = {
  id: 'n2',
  glyph: '🎉',
  title: 'ส่วนลด BANHAO7',
  body: 'ลด ฿10 เมื่อสั่งขั้นต่ำ ฿100 วันนี้เท่านั้น',
  time: 'เมื่อวาน',
  read: true,
};

beforeEach(() => {
  mockListNotifications.mockReset();
  mockMarkNotificationRead.mockReset();
  mockNavigate.mockReset();
  mockMarkNotificationRead.mockResolvedValue(undefined);
  stub();
});

it('renders the loading state while notifications are in flight', () => {
  mockListNotifications.mockReturnValue(new Promise(() => {}));
  renderScreen();

  expect(screen.getByText('กำลังโหลด…')).toBeTruthy();
});

it('renders the approved empty state', async () => {
  mockListNotifications.mockResolvedValue([]);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('state-notifications-empty')).toBeTruthy());
  expect(screen.getByText('ยังไม่มีแจ้งเตือน')).toBeTruthy();
});

it('renders the shared offline copy when the read fails with a network error', async () => {
  mockListNotifications.mockRejectedValue(new Error('Network request failed'));
  renderScreen();

  await waitFor(() => expect(screen.getByText('โหลดแจ้งเตือนไม่สำเร็จ')).toBeTruthy());
});

it('tapping an unread notification calls markNotificationRead with its id', async () => {
  mockListNotifications.mockResolvedValue([UNREAD, READ]);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId(`notification-card-${UNREAD.id}`)).toBeTruthy());
  fireEvent.press(screen.getByTestId(`notification-card-${UNREAD.id}`));

  await waitFor(() => expect(mockMarkNotificationRead).toHaveBeenCalledWith(UNREAD.id));
});

it('marks the tapped card read once the call resolves — the unread dot disappears', async () => {
  mockListNotifications.mockResolvedValue([UNREAD]);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId(`notification-card-${UNREAD.id}`)).toBeTruthy());
  expect(screen.getByLabelText('ยังไม่ได้อ่าน')).toBeTruthy();

  fireEvent.press(screen.getByTestId(`notification-card-${UNREAD.id}`));

  await waitFor(() => expect(screen.queryByLabelText('ยังไม่ได้อ่าน')).toBeNull());
});

it('a read notification stays renderable and tapping it again does not call the repository', async () => {
  mockListNotifications.mockResolvedValue([READ]);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId(`notification-card-${READ.id}`)).toBeTruthy());
  expect(screen.getByText('ส่วนลด BANHAO7')).toBeTruthy();
  expect(screen.queryByLabelText('ยังไม่ได้อ่าน')).toBeNull();

  fireEvent.press(screen.getByTestId(`notification-card-${READ.id}`));

  expect(mockMarkNotificationRead).not.toHaveBeenCalled();
});

it('does not crash and leaves the card unread when markNotificationRead fails', async () => {
  mockMarkNotificationRead.mockRejectedValue(new Error('connection reset'));
  mockListNotifications.mockResolvedValue([UNREAD]);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId(`notification-card-${UNREAD.id}`)).toBeTruthy());
  fireEvent.press(screen.getByTestId(`notification-card-${UNREAD.id}`));

  await waitFor(() => expect(mockMarkNotificationRead).toHaveBeenCalledWith(UNREAD.id));
  // Visual state preserved — still shows the unread dot, no crash, no new error UI.
  expect(screen.getByLabelText('ยังไม่ได้อ่าน')).toBeTruthy();
  expect(screen.getByTestId('screen-notifications')).toBeTruthy();
});

// DEC-068 D1 — a notification that names an order opens that order.
const WITH_ORDER: AppNotification = {
  id: 'n3',
  glyph: '🔔',
  title: 'ส่งถึงแล้ว',
  body: 'ขอให้อร่อยกับมื้อนี้',
  time: '12:00',
  read: false,
  orderId: 'order-77',
};

it('tapping a notification that carries an orderId opens that order and still marks it read', async () => {
  mockListNotifications.mockResolvedValue([WITH_ORDER]);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId(`notification-card-${WITH_ORDER.id}`)).toBeTruthy());
  fireEvent.press(screen.getByTestId(`notification-card-${WITH_ORDER.id}`));

  expect(mockNavigate).toHaveBeenCalledWith('OrderDetail', { orderId: 'order-77' });
  await waitFor(() => expect(mockMarkNotificationRead).toHaveBeenCalledWith(WITH_ORDER.id));
});

it('opens the order even when the notification was already read', async () => {
  mockListNotifications.mockResolvedValue([{ ...WITH_ORDER, read: true }]);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId(`notification-card-${WITH_ORDER.id}`)).toBeTruthy());
  fireEvent.press(screen.getByTestId(`notification-card-${WITH_ORDER.id}`));

  expect(mockNavigate).toHaveBeenCalledWith('OrderDetail', { orderId: 'order-77' });
  expect(mockMarkNotificationRead).not.toHaveBeenCalled();
});

it('opens the order even when marking it read fails', async () => {
  mockMarkNotificationRead.mockRejectedValue(new Error('connection reset'));
  mockListNotifications.mockResolvedValue([WITH_ORDER]);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId(`notification-card-${WITH_ORDER.id}`)).toBeTruthy());
  fireEvent.press(screen.getByTestId(`notification-card-${WITH_ORDER.id}`));

  expect(mockNavigate).toHaveBeenCalledWith('OrderDetail', { orderId: 'order-77' });
});

it('does not navigate for a notification with no orderId', async () => {
  mockListNotifications.mockResolvedValue([UNREAD]);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId(`notification-card-${UNREAD.id}`)).toBeTruthy());
  fireEvent.press(screen.getByTestId(`notification-card-${UNREAD.id}`));

  expect(mockNavigate).not.toHaveBeenCalled();
});

describe('refreshing when the customer returns to the tab', () => {
  it('does not fetch twice on first open — the mount fetch covers the first focus', async () => {
    mockListNotifications.mockResolvedValue([UNREAD]);
    renderScreen();

    await waitFor(() => expect(screen.getByTestId(`notification-card-${UNREAD.id}`)).toBeTruthy());
    expect(mockListNotifications).toHaveBeenCalledTimes(1);
  });

  it('fetches again on a later focus, so events that arrived meanwhile appear', async () => {
    mockListNotifications.mockResolvedValueOnce([UNREAD]).mockResolvedValue([UNREAD, WITH_ORDER]);
    renderScreen();

    await waitFor(() => expect(screen.getByTestId(`notification-card-${UNREAD.id}`)).toBeTruthy());
    expect(screen.queryByTestId(`notification-card-${WITH_ORDER.id}`)).toBeNull();

    act(() => mockFocus.current?.());

    await waitFor(() => expect(screen.getByTestId(`notification-card-${WITH_ORDER.id}`)).toBeTruthy());
    expect(mockListNotifications).toHaveBeenCalledTimes(2);
  });
});
