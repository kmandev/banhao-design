import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { UseOrderBoard } from '../hooks/useOrderBoard';
import { OrderBoard } from './OrderBoard';
import { repositories } from '../repositories';

/**
 * M-13 board-integration tests — design
 * `docs/design/BANHAO MERCHANT - NORMAL BUSY PAUSE - AVAILABILITY FLOW.dc.html`.
 *
 * Same mocking boundary `OrderBoard.acceptDialog.test.tsx` draws:
 * `useOrderBoard` is mocked (never touches Supabase/Realtime), and the
 * repository seam is mocked so `getAvailability`/`setAvailability` are under
 * this test's control. `merchantOrders` stays a set of never-resolving
 * stand-ins — irrelevant to M-13's own pill/dialog behaviour.
 */

let mockUseOrderBoard: jest.Mock<UseOrderBoard, [string | null]>;

jest.mock('../hooks/useOrderBoard', () => ({
  useOrderBoard: (restaurantId: string | null) =>
    (globalThis as unknown as { __useOrderBoardMock: jest.Mock }).__useOrderBoardMock(restaurantId),
}));

jest.mock('../lib/alertSound', () => ({
  createAlertPlayer: () => ({ play: () => Promise.resolve({ played: true }) }),
}));

jest.mock('../lib/soundPreference', () => ({
  getSoundPreference: () => true,
  setSoundPreference: () => {},
}));

jest.mock('../repositories', () => ({
  repositories: {
    merchantOrders: {
      listRestaurantOrders: jest.fn(),
      transitionOrder: jest.fn(() => new Promise(() => {})),
      getOrderDetail: jest.fn(() => new Promise(() => {})),
    },
    merchantAvailability: {
      getAvailability: jest.fn(),
      setAvailability: jest.fn(),
    },
  },
}));

const getAvailability = repositories.merchantAvailability.getAvailability as jest.Mock;
const setAvailability = repositories.merchantAvailability.setAvailability as jest.Mock;

function boardState(overrides: Partial<UseOrderBoard> = {}): UseOrderBoard {
  return {
    orders: [],
    loading: false,
    error: null,
    realtimeStatus: 'SUBSCRIBED',
    refetch: jest.fn(),
    ...overrides,
  };
}

function availabilityRow(overrides: Partial<{ availability_mode: 'NORMAL' | 'BUSY' | 'PAUSED'; busy_prep_minutes: number | null }> = {}) {
  return {
    id: 'rest-a',
    availability_mode: 'NORMAL' as const,
    busy_prep_minutes: null,
    updated_at: '2026-09-04T00:00:00.000Z',
    ...overrides,
  };
}

function renderBoard() {
  mockUseOrderBoard.mockReturnValue(boardState());
  return render(<OrderBoard restaurantId="rest-a" />);
}

const pill = () => screen.getByTestId('availability-pill');
const busyButton = () => screen.getByTestId('availability-action-busy');
const pauseButton = () => screen.getByTestId('availability-action-pause');
const resumeButton = () => screen.getByTestId('availability-action-resume');
const dialog = () => screen.queryByTestId('availability-dialog');
const confirmButton = () => screen.getByTestId('availability-dialog-confirm');
const preset = (minutes: number) => screen.getByRole('radio', { name: `${minutes} นาที` });

beforeEach(() => {
  mockUseOrderBoard = jest.fn();
  (globalThis as unknown as { __useOrderBoardMock: jest.Mock }).__useOrderBoardMock = mockUseOrderBoard;
  getAvailability.mockReset();
  setAvailability.mockReset();
  getAvailability.mockResolvedValue(availabilityRow());
});

describe('M-13 — the mode pill (server-confirmed state only)', () => {
  it('shows nothing while loading, then the current mode once loaded', async () => {
    renderBoard();
    expect(screen.queryByTestId('availability-pill')).not.toBeInTheDocument();

    await waitFor(() => expect(pill()).toHaveTextContent('เปิดปกติ'));
  });

  it('BUSY carries its minutes in the pill', async () => {
    getAvailability.mockResolvedValue(availabilityRow({ availability_mode: 'BUSY', busy_prep_minutes: 30 }));
    renderBoard();

    await waitFor(() => expect(pill()).toHaveTextContent('กำลังยุ่ง'));
    expect(pill()).toHaveTextContent('30 นาที');
  });

  it('PAUSED shows its own label and only a resume action', async () => {
    getAvailability.mockResolvedValue(availabilityRow({ availability_mode: 'PAUSED' }));
    renderBoard();

    await waitFor(() => expect(pill()).toHaveTextContent('หยุดรับออเดอร์ชั่วคราว'));
    expect(resumeButton()).toBeInTheDocument();
    expect(screen.queryByTestId('availability-action-busy')).not.toBeInTheDocument();
    expect(screen.queryByTestId('availability-action-pause')).not.toBeInTheDocument();
  });

  it('NORMAL and BUSY both offer the two forward actions, never Resume', async () => {
    renderBoard();
    await waitFor(() => expect(pill()).toHaveTextContent('เปิดปกติ'));

    expect(busyButton()).toBeInTheDocument();
    expect(pauseButton()).toBeInTheDocument();
    expect(screen.queryByTestId('availability-action-resume')).not.toBeInTheDocument();
  });
});

describe('M-13 — Busy dialog', () => {
  it('opens with nothing preselected, and issues no command by itself', async () => {
    renderBoard();
    await waitFor(() => expect(pill()).toBeInTheDocument());

    fireEvent.click(busyButton());

    expect(dialog()).toBeInTheDocument();
    expect(preset(20)).toHaveAttribute('aria-checked', 'false');
    expect(setAvailability).not.toHaveBeenCalled();
  });

  it('confirm is disabled until a preset is chosen', async () => {
    renderBoard();
    await waitFor(() => expect(pill()).toBeInTheDocument());
    fireEvent.click(busyButton());

    expect(confirmButton()).toBeDisabled();
    fireEvent.click(preset(20));
    expect(confirmButton()).not.toBeDisabled();
  });

  it('confirming sends { mode: BUSY, busyPrepMinutes } and closes on success', async () => {
    setAvailability.mockResolvedValue({
      restaurantId: 'rest-a',
      availabilityMode: 'BUSY',
      busyPrepMinutes: 20,
      updatedAt: '2026-09-04T01:00:00.000Z',
    });
    renderBoard();
    await waitFor(() => expect(pill()).toBeInTheDocument());
    fireEvent.click(busyButton());
    fireEvent.click(preset(20));

    await act(async () => {
      fireEvent.click(confirmButton());
    });

    expect(setAvailability).toHaveBeenCalledWith('rest-a', { mode: 'BUSY', busyPrepMinutes: 20 });
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    await waitFor(() => expect(pill()).toHaveTextContent('กำลังยุ่ง'));
  });

  it('a failed request leaves the dialog open with an inline error, and the pill unchanged', async () => {
    setAvailability.mockRejectedValue({ code: 'INVALID_TRANSITION' });
    renderBoard();
    await waitFor(() => expect(pill()).toHaveTextContent('เปิดปกติ'));
    fireEvent.click(busyButton());
    fireEvent.click(preset(20));

    await act(async () => {
      fireEvent.click(confirmButton());
    });

    expect(dialog()).toBeInTheDocument();
    expect(screen.getByTestId('availability-dialog-error')).toBeInTheDocument();
    expect(pill()).toHaveTextContent('เปิดปกติ');
  });

  it('offers exactly the five presets 10/20/30/45/60, same as M-05', async () => {
    renderBoard();
    await waitFor(() => expect(pill()).toBeInTheDocument());
    fireEvent.click(busyButton());

    for (const minutes of [10, 20, 30, 45, 60]) {
      expect(preset(minutes)).toBeInTheDocument();
    }
  });
});

describe('M-13 — Pause dialog', () => {
  it('opens with a confirmation, states in-flight orders continue, and issues no command by itself', async () => {
    renderBoard();
    await waitFor(() => expect(pill()).toBeInTheDocument());

    fireEvent.click(pauseButton());

    expect(dialog()).toBeInTheDocument();
    expect(screen.getByText(/ออเดอร์ที่มีอยู่แล้วดำเนินการตามปกติ/)).toBeInTheDocument();
    expect(setAvailability).not.toHaveBeenCalled();
  });

  it('confirming sends { mode: PAUSED } and closes on success', async () => {
    setAvailability.mockResolvedValue({
      restaurantId: 'rest-a',
      availabilityMode: 'PAUSED',
      busyPrepMinutes: null,
      updatedAt: '2026-09-04T01:00:00.000Z',
    });
    renderBoard();
    await waitFor(() => expect(pill()).toBeInTheDocument());
    fireEvent.click(pauseButton());

    await act(async () => {
      fireEvent.click(confirmButton());
    });

    expect(setAvailability).toHaveBeenCalledWith('rest-a', { mode: 'PAUSED' });
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    await waitFor(() => expect(pill()).toHaveTextContent('หยุดรับออเดอร์ชั่วคราว'));
  });
});

describe('M-13 — Resume (AV-T2/AV-T5, one tap, no dialog)', () => {
  it('clicking resume from PAUSED sends { mode: NORMAL } with no dialog', async () => {
    getAvailability.mockResolvedValue(availabilityRow({ availability_mode: 'PAUSED' }));
    setAvailability.mockResolvedValue({
      restaurantId: 'rest-a',
      availabilityMode: 'NORMAL',
      busyPrepMinutes: null,
      updatedAt: '2026-09-04T01:00:00.000Z',
    });
    renderBoard();
    await waitFor(() => expect(pill()).toHaveTextContent('หยุดรับออเดอร์ชั่วคราว'));

    await act(async () => {
      fireEvent.click(resumeButton());
    });

    expect(dialog()).not.toBeInTheDocument();
    expect(setAvailability).toHaveBeenCalledWith('rest-a', { mode: 'NORMAL' });
    await waitFor(() => expect(pill()).toHaveTextContent('เปิดปกติ'));
  });

  it('resume from Busy always returns to Normal, never back to the previous Busy value (AV-D02)', async () => {
    getAvailability.mockResolvedValue(availabilityRow({ availability_mode: 'PAUSED' }));
    setAvailability.mockResolvedValue({
      restaurantId: 'rest-a',
      availabilityMode: 'NORMAL',
      busyPrepMinutes: null,
      updatedAt: '2026-09-04T01:00:00.000Z',
    });
    renderBoard();
    await waitFor(() => expect(pill()).toHaveTextContent('หยุดรับออเดอร์ชั่วคราว'));

    await act(async () => {
      fireEvent.click(resumeButton());
    });

    expect(setAvailability).toHaveBeenCalledWith('rest-a', { mode: 'NORMAL' });
    expect(setAvailability).not.toHaveBeenCalledWith('rest-a', expect.objectContaining({ mode: 'BUSY' }));
  });
});

describe('M-13 — no leakage', () => {
  it('renders no supervisor/L4/AI-ops surface anywhere on the board', async () => {
    renderBoard();
    await waitFor(() => expect(pill()).toBeInTheDocument());

    expect(screen.queryByText(/supervisor|ผู้ควบคุม|\bAI[\s-]?ops\b/i)).not.toBeInTheDocument();
  });

  it('renders no auto-pause threshold, window, duration or cooldown value anywhere', async () => {
    renderBoard();
    await waitFor(() => expect(pill()).toBeInTheDocument());
    fireEvent.click(pauseButton());

    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/threshold|cooldown|\d+\s*(minutes|ครั้ง)\s*(auto|อัตโนมัติ)/i);
  });
});
