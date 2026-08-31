import { act, render, screen, fireEvent } from '@testing-library/react';
import type { MerchantOrderSummary } from '../domain/order';
import type { UseOrderBoard } from '../hooks/useOrderBoard';
import { OrderBoard } from './OrderBoard';

/**
 * Header-chrome tests for M-03 (connection pill, sound bell, `ออเดอร์วันนี้
 * N`) — a separate file from `OrderBoard.test.tsx` so that file's existing,
 * already-passing M-2.6/M-2.7 coverage is left completely untouched.
 *
 * Same mocking boundary as `OrderBoard.test.tsx`: only `useOrderBoard` is
 * mocked. `useOrderAlerts`'s own two seams (`../lib/alertSound`,
 * `../lib/soundPreference`) are mocked here too, for the same reason
 * `useOrderAlerts.test.ts` mocks them — no real `AudioContext`/`localStorage`
 * behaviour is under test in this file, only what `OrderBoard` renders from
 * the hook's return value.
 */

let mockUseOrderBoard: jest.Mock<UseOrderBoard, [string | null]>;

jest.mock('../hooks/useOrderBoard', () => ({
  useOrderBoard: (restaurantId: string | null) =>
    (globalThis as unknown as { __useOrderBoardMock: jest.Mock }).__useOrderBoardMock(restaurantId),
}));

const playMock = jest.fn<Promise<{ played: boolean; reason?: string }>, []>();
jest.mock('../lib/alertSound', () => ({
  createAlertPlayer: () => ({ play: () => playMock() }),
}));

let storedPreference = true;
jest.mock('../lib/soundPreference', () => ({
  getSoundPreference: () => storedPreference,
  setSoundPreference: (value: boolean) => {
    storedPreference = value;
  },
}));

function order(overrides: Partial<MerchantOrderSummary> & { id: string }): MerchantOrderSummary {
  return {
    orderNumber: `BH-${overrides.id}`,
    state: 'PAID',
    restaurantId: 'rest-a',
    recipientNameSnapshot: 'คุณสมชาย ใจดี',
    recipientPhoneSnapshot: '+66812345678',
    grandTotalSatang: 18500,
    placedAt: new Date(Date.now() - 60_000).toISOString(),
    acceptedAt: null,
    readyAt: null,
    pickedUpAt: null,
    ...overrides,
  };
}

function boardState(overrides: Partial<UseOrderBoard>): UseOrderBoard {
  return {
    orders: [],
    loading: false,
    error: null,
    realtimeStatus: 'SUBSCRIBED',
    refetch: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  mockUseOrderBoard = jest.fn();
  (globalThis as unknown as { __useOrderBoardMock: jest.Mock }).__useOrderBoardMock = mockUseOrderBoard;
  storedPreference = true;
  playMock.mockReset();
  playMock.mockResolvedValue({ played: true });
});

describe('OrderBoard — connection pill', () => {
  it('shows the connected pill when Realtime is SUBSCRIBED', async () => {
    mockUseOrderBoard.mockReturnValue(boardState({ realtimeStatus: 'SUBSCRIBED' }));
    await act(async () => render(<OrderBoard restaurantId="rest-a" />));
    expect(screen.getByText('เชื่อมต่ออยู่')).toBeInTheDocument();
  });

  it('shows the degraded pill when Realtime has dropped', async () => {
    mockUseOrderBoard.mockReturnValue(boardState({ realtimeStatus: 'CHANNEL_ERROR' }));
    await act(async () => render(<OrderBoard restaurantId="rest-a" />));
    expect(screen.getByText('กำลังเชื่อมต่อใหม่')).toBeInTheDocument();
  });
});

describe("OrderBoard — ออเดอร์วันนี้ count", () => {
  it("renders today's order count derived from the board's own orders", async () => {
    const today = new Date().toISOString();
    mockUseOrderBoard.mockReturnValue(
      boardState({
        orders: [
          order({ id: '1', placedAt: today }),
          order({ id: '2', placedAt: today, state: 'DELIVERED' }),
        ],
      }),
    );
    await act(async () => render(<OrderBoard restaurantId="rest-a" />));
    expect(screen.getByText('ออเดอร์วันนี้ 2')).toBeInTheDocument();
  });
});

describe('OrderBoard — sound bell', () => {
  it('renders enabled by default, with an accessible toggle', async () => {
    mockUseOrderBoard.mockReturnValue(boardState({}));
    await act(async () => render(<OrderBoard restaurantId="rest-a" />));
    expect(screen.getByRole('button', { name: 'เสียงแจ้งเตือน · เปิด' })).toBeInTheDocument();
  });

  it('toggles to the off label on click and persists the choice', async () => {
    mockUseOrderBoard.mockReturnValue(boardState({}));
    await act(async () => render(<OrderBoard restaurantId="rest-a" />));

    fireEvent.click(screen.getByRole('button', { name: 'เสียงแจ้งเตือน · เปิด' }));
    expect(await screen.findByRole('button', { name: 'เสียงแจ้งเตือน · ปิด' })).toBeInTheDocument();
    expect(storedPreference).toBe(false);
  });

  it('starts muted when the stored preference is off', async () => {
    storedPreference = false;
    mockUseOrderBoard.mockReturnValue(boardState({}));
    await act(async () => render(<OrderBoard restaurantId="rest-a" />));
    expect(await screen.findByRole('button', { name: 'เสียงแจ้งเตือน · ปิด' })).toBeInTheDocument();
  });
});
