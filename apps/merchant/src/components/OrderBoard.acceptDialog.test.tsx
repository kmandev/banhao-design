import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MerchantOrderSummary } from '../domain/order';
import type { UseOrderBoard } from '../hooks/useOrderBoard';
import { OrderBoard } from './OrderBoard';
import { repositories } from '../repositories';

/**
 * M-05 board-integration tests — design
 * `docs/design/BANHAO M-05 Merchant Accept Confirmation.dc.html`.
 *
 * A separate file from `OrderBoard.test.tsx`, `OrderBoard.detailPanel.test.tsx`
 * and `OrderBoard.headerAlerts.test.tsx`, so their M-2.6/M-2.7/M-03/M-04
 * coverage stays where it is. Same mocking boundary those files draw:
 * `useOrderBoard` is mocked (this component never touches Supabase or
 * Realtime itself), and the repository seam is mocked so a command's
 * resolution is under the test's control.
 *
 * The load-bearing assertion running through the whole file: **HTTP success
 * never closes this dialog.** The board — i.e. Realtime — moving the order
 * off `PAID` is the only thing that does.
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
      transitionOrder: jest.fn(),
      getOrderDetail: jest.fn(),
    },
    // M-13. Never resolves — irrelevant to M-05's own accept-dialog tests.
    merchantAvailability: {
      getAvailability: jest.fn(() => new Promise(() => {})),
      setAvailability: jest.fn(() => new Promise(() => {})),
    },
  },
}));

const transitionOrder = repositories.merchantOrders.transitionOrder as jest.Mock;
const getOrderDetail = repositories.merchantOrders.getOrderDetail as jest.Mock;

/** Placed 60s ago — comfortably inside the 180s accept window's `normal` phase. */
function order(overrides: Partial<MerchantOrderSummary> & { id: string }): MerchantOrderSummary {
  return {
    orderNumber: `BH-${overrides.id}`,
    state: 'PAID',
    restaurantId: 'rest-a',
    recipientNameSnapshot: 'คุณสมชาย ใจดี',
    recipientPhoneSnapshot: '+66812345678',
    grandTotalSatang: 24800,
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

function renderBoardWithPaidOrder(overrides: Partial<MerchantOrderSummary> = {}) {
  mockUseOrderBoard.mockReturnValue(boardState({ orders: [order({ id: 'o1', ...overrides })] }));
  return render(<OrderBoard restaurantId="rest-a" />);
}

const acceptButton = () => screen.getByRole('button', { name: 'รับออเดอร์' });
const dialog = () => screen.queryByTestId('accept-confirm-dialog');
const confirmButton = () => screen.getByTestId('accept-dialog-confirm');
const preset = (minutes: number) => screen.getByRole('radio', { name: `${minutes} นาที` });

/** A command that never settles, so the in-flight state can be inspected. */
function neverResolves() {
  transitionOrder.mockReturnValue(new Promise(() => {}));
}

beforeEach(() => {
  mockUseOrderBoard = jest.fn();
  (globalThis as unknown as { __useOrderBoardMock: jest.Mock }).__useOrderBoardMock = mockUseOrderBoard;
  transitionOrder.mockReset();
  transitionOrder.mockResolvedValue({ orderId: 'o1', state: 'MERCHANT_ACCEPTED' });
  getOrderDetail.mockReset();
  getOrderDetail.mockReturnValue(new Promise(() => {}));
});

// ---------------------------------------------------------------------------
// Opening — the trigger change (M05-D02)
// ---------------------------------------------------------------------------

describe('M-05 — opening', () => {
  it('clicking รับออเดอร์ opens the dialog', () => {
    renderBoardWithPaidOrder();

    expect(dialog()).not.toBeInTheDocument();
    fireEvent.click(acceptButton());

    expect(dialog()).toBeInTheDocument();
  });

  it('opening the dialog issues no command — รับออเดอร์ no longer accepts anything by itself', () => {
    renderBoardWithPaidOrder();

    fireEvent.click(acceptButton());

    expect(transitionOrder).not.toHaveBeenCalled();
  });

  it('names the order it is about, so the dialog subject is unambiguous', () => {
    renderBoardWithPaidOrder();
    fireEvent.click(acceptButton());

    expect(screen.getByRole('heading', { name: /รับออเดอร์/ })).toHaveTextContent('#BH-o1');
    expect(screen.getByTestId('accept-confirm-dialog')).toHaveTextContent('คุณสมชาย ใจดี');
  });

  it('is a modal dialog with the M-04 scrim', () => {
    renderBoardWithPaidOrder();
    fireEvent.click(acceptButton());

    expect(screen.getByTestId('accept-confirm-dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByTestId('accept-dialog-scrim')).toBeInTheDocument();
  });

  it('leaves the board rendered behind it', () => {
    renderBoardWithPaidOrder();
    fireEvent.click(acceptButton());

    expect(screen.getByRole('heading', { name: 'ใหม่ · รอตอบรับ' })).toBeInTheDocument();
    expect(screen.getByTestId('order-card-o1')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Prep-time selection (M05-D03, D04, D11)
// ---------------------------------------------------------------------------

describe('M-05 — prep-time selection', () => {
  it('offers exactly the five presets, with nothing preselected', () => {
    renderBoardWithPaidOrder();
    fireEvent.click(acceptButton());

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(5);
    expect(radios.map((r) => r.getAttribute('data-preset'))).toEqual(['10', '20', '30', '45', '60']);
    for (const radio of radios) expect(radio).toHaveAttribute('aria-checked', 'false');
  });

  it('offers no confirmation while nothing is selected', () => {
    renderBoardWithPaidOrder();
    fireEvent.click(acceptButton());

    // Kept focusable and told why, rather than removed (M05-D03).
    expect(confirmButton()).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(confirmButton());
    expect(transitionOrder).not.toHaveBeenCalled();
  });

  it.each([10, 20, 30, 45, 60])('selecting %i นาที enables confirmation', (minutes) => {
    renderBoardWithPaidOrder();
    fireEvent.click(acceptButton());

    fireEvent.click(preset(minutes));

    expect(preset(minutes)).toHaveAttribute('aria-checked', 'true');
    expect(confirmButton()).toHaveAttribute('aria-disabled', 'false');
  });

  it('is a single tab stop — only the checked option is tabbable, or the first when none is', () => {
    renderBoardWithPaidOrder();
    fireEvent.click(acceptButton());

    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1']);

    fireEvent.click(preset(45));
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('tabindex'))).toEqual(['-1', '-1', '-1', '0', '-1']);
  });

  it('moves and selects with the arrow keys', () => {
    renderBoardWithPaidOrder();
    fireEvent.click(acceptButton());

    fireEvent.keyDown(preset(10), { key: 'ArrowRight' });
    expect(preset(20)).toHaveAttribute('aria-checked', 'true');

    fireEvent.keyDown(preset(20), { key: 'ArrowRight' });
    expect(preset(30)).toHaveAttribute('aria-checked', 'true');

    fireEvent.keyDown(preset(30), { key: 'ArrowLeft' });
    expect(preset(20)).toHaveAttribute('aria-checked', 'true');
  });

  it('Enter on a preset selects it and does NOT submit (M05-D04)', () => {
    renderBoardWithPaidOrder();
    fireEvent.click(acceptButton());

    fireEvent.keyDown(preset(30), { key: 'Enter' });

    expect(preset(30)).toHaveAttribute('aria-checked', 'true');
    expect(transitionOrder).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();
  });

  it('Space on a preset selects it and does not submit either', () => {
    renderBoardWithPaidOrder();
    fireEvent.click(acceptButton());

    fireEvent.keyDown(preset(60), { key: ' ' });

    expect(preset(60)).toHaveAttribute('aria-checked', 'true');
    expect(transitionOrder).not.toHaveBeenCalled();
  });

  it('restates the chosen value in words — colour is never the only signal', () => {
    renderBoardWithPaidOrder();
    fireEvent.click(acceptButton());
    fireEvent.click(preset(20));

    expect(screen.getByTestId('accept-dialog-summary')).toHaveTextContent('ร้านใช้เวลาทำอาหารประมาณ 20 นาที');
  });
});

// ---------------------------------------------------------------------------
// Confirming — one POST, and the dialog does not close on HTTP success
// ---------------------------------------------------------------------------

describe('M-05 — confirming', () => {
  it('sends exactly one accept, carrying the chosen prep time', async () => {
    renderBoardWithPaidOrder();
    fireEvent.click(acceptButton());
    fireEvent.click(preset(20));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(transitionOrder).toHaveBeenCalledTimes(1));
    expect(transitionOrder).toHaveBeenCalledWith('o1', { command: 'accept', prepMinutes: 20 });
  });

  it('sends one accept for a double click on confirm', async () => {
    neverResolves();
    renderBoardWithPaidOrder();
    fireEvent.click(acceptButton());
    fireEvent.click(preset(30));

    const confirm = confirmButton();
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(transitionOrder).toHaveBeenCalledTimes(1));
  });

  it('goes busy and inert rather than closing, while the command is unresolved', async () => {
    neverResolves();
    renderBoardWithPaidOrder();
    fireEvent.click(acceptButton());
    fireEvent.click(preset(20));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(confirmButton()).toBeDisabled());
    expect(dialog()).toHaveAttribute('aria-busy', 'true');
    // The chosen value stays legible — it is the fact the merchant is waiting on.
    expect(preset(20)).toHaveAttribute('aria-checked', 'true');
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
  });

  it('stays open after the request succeeds — HTTP 200 is not the fact being waited on', async () => {
    renderBoardWithPaidOrder();
    fireEvent.click(acceptButton());
    fireEvent.click(preset(20));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(transitionOrder).toHaveBeenCalledTimes(1));
    // The board still reports PAID, so the order has not actually moved.
    expect(dialog()).toBeInTheDocument();
    expect(screen.getByTestId('order-card-o1')).toHaveAttribute('data-state', 'PAID');
  });

  it('closes only once the board reports the order is no longer PAID', async () => {
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [order({ id: 'o1', state: 'PAID' })] }));
    const view = render(<OrderBoard restaurantId="rest-a" />);

    fireEvent.click(acceptButton());
    fireEvent.click(preset(20));
    fireEvent.click(confirmButton());
    await waitFor(() => expect(transitionOrder).toHaveBeenCalledTimes(1));
    expect(dialog()).toBeInTheDocument();

    // Realtime lands.
    mockUseOrderBoard.mockReturnValue(
      boardState({
        orders: [
          order({ id: 'o1', state: 'MERCHANT_ACCEPTED', acceptedAt: new Date(Date.now() - 1000).toISOString() }),
        ],
      }),
    );
    await act(async () => {
      view.rerender(<OrderBoard restaurantId="rest-a" />);
    });

    expect(dialog()).not.toBeInTheDocument();
    expect(screen.getByTestId('order-card-o1')).toHaveAttribute('data-state', 'MERCHANT_ACCEPTED');
  });

  it('returns focus to the originating card when Realtime closes it', async () => {
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [order({ id: 'o1', state: 'PAID' })] }));
    const view = render(<OrderBoard restaurantId="rest-a" />);

    const opener = acceptButton();
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(preset(20));
    fireEvent.click(confirmButton());
    await waitFor(() => expect(transitionOrder).toHaveBeenCalledTimes(1));

    mockUseOrderBoard.mockReturnValue(
      boardState({
        orders: [
          order({ id: 'o1', state: 'MERCHANT_ACCEPTED', acceptedAt: new Date(Date.now() - 1000).toISOString() }),
        ],
      }),
    );
    await act(async () => {
      view.rerender(<OrderBoard restaurantId="rest-a" />);
    });

    // The `MERCHANT_ACCEPTED` card renders a non-tappable waiting *status*,
    // not a button, so the originating `รับออเดอร์` element no longer exists.
    // Focus therefore takes the board's documented fallback rather than being
    // dropped on `<body>` — the same fallback M-04 already uses when its
    // opener has left the DOM. (The design names the `ออเดอร์ใหม่` column
    // heading as the fallback target; this reuses the shipped board-container
    // target instead of introducing a second focus-fallback mechanism.)
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByTestId('order-card-o1')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Failure (M05-D07)
// ---------------------------------------------------------------------------

describe('M-05 — failure', () => {
  it('keeps the dialog and the selection on a retryable failure, and retries in place', async () => {
    transitionOrder.mockRejectedValueOnce(new Error('offline'));
    renderBoardWithPaidOrder();

    fireEvent.click(acceptButton());
    fireEvent.click(preset(45));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(screen.getByTestId('accept-dialog-error')).toBeInTheDocument());
    // The existing mapper's copy, not a second vocabulary.
    expect(screen.getByTestId('accept-dialog-error')).toHaveTextContent('ทำรายการไม่สำเร็จ · ลองอีกครั้ง');
    expect(screen.getByTestId('accept-dialog-error')).toHaveTextContent('ออเดอร์ยังอยู่ที่ ออเดอร์ใหม่');

    expect(dialog()).toBeInTheDocument();
    expect(preset(45)).toHaveAttribute('aria-checked', 'true');
    expect(confirmButton()).toHaveAttribute('aria-disabled', 'false');

    transitionOrder.mockResolvedValue({ orderId: 'o1', state: 'MERCHANT_ACCEPTED' });
    fireEvent.click(confirmButton());

    await waitFor(() => expect(transitionOrder).toHaveBeenCalledTimes(2));
    expect(transitionOrder).toHaveBeenLastCalledWith('o1', { command: 'accept', prepMinutes: 45 });
  });

  it('removes confirmation on INVALID_TRANSITION — retrying cannot succeed', async () => {
    transitionOrder.mockRejectedValue(Object.assign(new Error('nope'), { code: 'INVALID_TRANSITION' }));
    renderBoardWithPaidOrder();

    fireEvent.click(acceptButton());
    fireEvent.click(preset(20));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(screen.getByTestId('accept-dialog-error')).toBeInTheDocument());
    expect(screen.getByTestId('accept-dialog-error')).toHaveTextContent(
      'ออเดอร์นี้ถูกเปลี่ยนสถานะไปแล้ว · กระดานจะอัปเดตเอง',
    );
    expect(screen.queryByTestId('accept-dialog-confirm')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByTestId('accept-dialog-dismiss')).toHaveTextContent('ปิด');
  });

  it('removes confirmation on NOT_RESTAURANT_MEMBER — an authorization answer, not a transient fault', async () => {
    transitionOrder.mockRejectedValue(Object.assign(new Error('nope'), { code: 'NOT_RESTAURANT_MEMBER' }));
    renderBoardWithPaidOrder();

    fireEvent.click(acceptButton());
    fireEvent.click(preset(20));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(screen.getByTestId('accept-dialog-error')).toBeInTheDocument());
    expect(screen.getByTestId('accept-dialog-error')).toHaveTextContent('ไม่มีสิทธิ์จัดการออเดอร์นี้');
    expect(screen.queryByTestId('accept-dialog-confirm')).not.toBeInTheDocument();
  });

  it('never fabricates MERCHANT_ACCEPTED on a failure — the card stays PAID', async () => {
    transitionOrder.mockRejectedValue(new Error('offline'));
    renderBoardWithPaidOrder();

    fireEvent.click(acceptButton());
    fireEvent.click(preset(20));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(screen.getByTestId('accept-dialog-error')).toBeInTheDocument());
    expect(screen.getByTestId('order-card-o1')).toHaveAttribute('data-state', 'PAID');
  });
});

// ---------------------------------------------------------------------------
// Dismissal (design §07)
// ---------------------------------------------------------------------------

describe('M-05 — dismissal', () => {
  it('Escape closes while idle', () => {
    renderBoardWithPaidOrder();
    fireEvent.click(acceptButton());

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(dialog()).not.toBeInTheDocument();
    expect(transitionOrder).not.toHaveBeenCalled();
  });

  it('Escape is ignored in flight — the command cannot be recalled', async () => {
    neverResolves();
    renderBoardWithPaidOrder();
    fireEvent.click(acceptButton());
    fireEvent.click(preset(20));
    fireEvent.click(confirmButton());
    await waitFor(() => expect(confirmButton()).toBeDisabled());

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(dialog()).toBeInTheDocument();
  });

  it('a scrim click closes while idle', () => {
    renderBoardWithPaidOrder();
    fireEvent.click(acceptButton());

    fireEvent.click(screen.getByTestId('accept-dialog-scrim'));

    expect(dialog()).not.toBeInTheDocument();
  });

  it('a scrim click is ignored in flight', async () => {
    neverResolves();
    renderBoardWithPaidOrder();
    fireEvent.click(acceptButton());
    fireEvent.click(preset(20));
    fireEvent.click(confirmButton());
    await waitFor(() => expect(confirmButton()).toBeDisabled());

    fireEvent.click(screen.getByTestId('accept-dialog-scrim'));

    expect(dialog()).toBeInTheDocument();
  });

  it('ยกเลิก closes and sends nothing', () => {
    renderBoardWithPaidOrder();
    fireEvent.click(acceptButton());
    fireEvent.click(preset(20));

    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));

    expect(dialog()).not.toBeInTheDocument();
    expect(transitionOrder).not.toHaveBeenCalled();
  });

  it('returns focus to the originating card on cancel', () => {
    renderBoardWithPaidOrder();
    const opener = acceptButton();
    opener.focus();
    fireEvent.click(opener);

    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));

    expect(document.activeElement).toBe(acceptButton());
  });

  it('discards the selection — reopening starts unanswered again', () => {
    renderBoardWithPaidOrder();
    fireEvent.click(acceptButton());
    fireEvent.click(preset(60));
    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));

    fireEvent.click(acceptButton());

    for (const radio of screen.getAllByRole('radio')) expect(radio).toHaveAttribute('aria-checked', 'false');
    expect(confirmButton()).toHaveAttribute('aria-disabled', 'true');
  });
});

// ---------------------------------------------------------------------------
// Expiry (M05-D10) — reported by the existing acceptWindowState, never enforced
// ---------------------------------------------------------------------------

describe('M-05 — expiry', () => {
  /** Placed 200s ago: past MERCHANT_ACCEPT_WINDOW_SECONDS = 180. */
  const EXPIRED_PLACED_AT = () => new Date(Date.now() - 200_000).toISOString();

  it('an already-expired card offers no accept trigger at all, so M-05 never opens for it', () => {
    mockUseOrderBoard.mockReturnValue(
      boardState({ orders: [order({ id: 'o1', state: 'PAID', placedAt: EXPIRED_PLACED_AT() })] }),
    );
    render(<OrderBoard restaurantId="rest-a" />);

    // Unchanged from M-2.7: the expired card's action has no endpoint,
    // because BQ-013 is still OPEN. M-05 does not give it one.
    expect(screen.queryByRole('button', { name: 'รับออเดอร์' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ติดต่อผู้ดูแลระบบ/ })).toBeDisabled();
    expect(dialog()).not.toBeInTheDocument();
  });

  it('replaces the body in place when the window expires while the dialog is open', async () => {
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [order({ id: 'o1', state: 'PAID' })] }));
    const view = render(<OrderBoard restaurantId="rest-a" />);

    fireEvent.click(acceptButton());
    fireEvent.click(preset(20));
    expect(screen.getByTestId('accept-dialog-confirm')).toBeInTheDocument();

    // The same order, now past the 3-minute window. `now` is read per render.
    mockUseOrderBoard.mockReturnValue(
      boardState({ orders: [order({ id: 'o1', state: 'PAID', placedAt: EXPIRED_PLACED_AT() })] }),
    );
    await act(async () => {
      view.rerender(<OrderBoard restaurantId="rest-a" />);
    });

    expect(dialog()).toBeInTheDocument();
    expect(screen.getByTestId('accept-dialog-expired')).toHaveTextContent('หมดเวลาตอบรับ · ติดต่อผู้ดูแลระบบ');
    expect(screen.queryByTestId('accept-dialog-confirm')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByTestId('accept-dialog-dismiss')).toHaveTextContent('ปิด');
  });

  it('an expired order cannot be accepted — no command is issued and ปิด just closes', async () => {
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [order({ id: 'o1', state: 'PAID' })] }));
    const view = render(<OrderBoard restaurantId="rest-a" />);

    fireEvent.click(acceptButton());
    fireEvent.click(preset(20));

    mockUseOrderBoard.mockReturnValue(
      boardState({ orders: [order({ id: 'o1', state: 'PAID', placedAt: EXPIRED_PLACED_AT() })] }),
    );
    await act(async () => {
      view.rerender(<OrderBoard restaurantId="rest-a" />);
    });

    fireEvent.click(screen.getByTestId('accept-dialog-dismiss'));

    expect(dialog()).not.toBeInTheDocument();
    expect(transitionOrder).not.toHaveBeenCalled();
    // BQ-013 untouched: nothing was rejected, cancelled or auto-actioned.
    expect(screen.getByTestId('order-card-o1')).toHaveAttribute('data-state', 'PAID');
  });
});

// ---------------------------------------------------------------------------
// M-04 / M-05 exclusivity
// ---------------------------------------------------------------------------

describe('M-04 and M-05 exclusivity', () => {
  it('opening M-05 clears any open M-04 detail panel — never two scrims', () => {
    renderBoardWithPaidOrder();

    fireEvent.click(screen.getByRole('button', { name: /เปิดรายละเอียด/ }));
    expect(screen.getByTestId('order-detail-panel')).toBeInTheDocument();

    fireEvent.click(acceptButton());

    expect(screen.queryByTestId('order-detail-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('accept-confirm-dialog')).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('opening M-04 clears any open M-05 confirmation state', () => {
    renderBoardWithPaidOrder();

    fireEvent.click(acceptButton());
    fireEvent.click(preset(20));
    expect(screen.getByTestId('accept-confirm-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /เปิดรายละเอียด/ }));

    expect(screen.queryByTestId('accept-confirm-dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('order-detail-panel')).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('M-04 remains read-only — it offers no accept action of its own', () => {
    renderBoardWithPaidOrder();

    fireEvent.click(screen.getByRole('button', { name: /เปิดรายละเอียด/ }));

    const panel = screen.getByTestId('order-detail-panel');
    expect(panel).not.toHaveTextContent('ยืนยันรับออเดอร์');
    expect(panel.querySelector('[data-preset]')).toBeNull();
  });
});
