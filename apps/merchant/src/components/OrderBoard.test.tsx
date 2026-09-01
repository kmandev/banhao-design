import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { MerchantOrderSummary } from '../domain/order';
import type { UseOrderBoard } from '../hooks/useOrderBoard';
import { repositories } from '../repositories';
import { OrderBoard } from './OrderBoard';

/**
 * Component-level tests for the Order Board (M-2.6). `useOrderBoard` (M-2.5)
 * is the only seam mocked — Supabase and Realtime are never touched by this
 * component, so there is nothing else to stub.
 */

let mockUseOrderBoard: jest.Mock<UseOrderBoard, [string | null]>;

jest.mock('../hooks/useOrderBoard', () => ({
  useOrderBoard: (restaurantId: string | null) =>
    (globalThis as unknown as { __useOrderBoardMock: jest.Mock }).__useOrderBoardMock(restaurantId),
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
});

describe('OrderBoard — column layout and state mapping', () => {
  it('renders all three columns with their exact titles', () => {
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [] }));
    render(<OrderBoard restaurantId="rest-a" />);

    expect(screen.getByRole('heading', { name: 'ใหม่ · รอตอบรับ' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'กำลังทำ' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'พร้อมให้ไรเดอร์รับ' })).toBeInTheDocument();
  });

  it('PAID appears in the new-order column', () => {
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [order({ id: '1', state: 'PAID' })] }));
    render(<OrderBoard restaurantId="rest-a" />);
    expect(screen.getByTestId('order-card-1')).toBeInTheDocument();
  });

  it('MERCHANT_ACCEPTED and PREPARING both land in the preparing column', () => {
    mockUseOrderBoard.mockReturnValue(
      boardState({
        orders: [
          order({ id: '1', state: 'MERCHANT_ACCEPTED', acceptedAt: new Date().toISOString() }),
          order({ id: '2', state: 'PREPARING', acceptedAt: new Date().toISOString() }),
        ],
      }),
    );
    render(<OrderBoard restaurantId="rest-a" />);

    expect(screen.getByTestId('order-card-1')).toBeInTheDocument();
    expect(screen.getByTestId('order-card-2')).toBeInTheDocument();
  });

  it('READY_FOR_PICKUP appears in the ready-for-pickup column', () => {
    mockUseOrderBoard.mockReturnValue(
      boardState({ orders: [order({ id: '1', state: 'READY_FOR_PICKUP', readyAt: new Date().toISOString() })] }),
    );
    render(<OrderBoard restaurantId="rest-a" />);
    expect(screen.getByTestId('order-card-1')).toBeInTheDocument();
  });

  it('never renders a card for a terminal/off-board state', () => {
    mockUseOrderBoard.mockReturnValue(
      boardState({
        orders: [
          order({ id: '1', state: 'DELIVERED' }),
          order({ id: '2', state: 'CANCELLED' }),
          order({ id: '3', state: 'PICKED_UP' }),
          order({ id: '4', state: 'DELIVERING' }),
        ],
      }),
    );
    render(<OrderBoard restaurantId="rest-a" />);

    expect(screen.queryByTestId('order-card-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('order-card-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('order-card-3')).not.toBeInTheDocument();
    expect(screen.queryByTestId('order-card-4')).not.toBeInTheDocument();
  });

  it('renders exactly one card per order id — including a READY_FOR_PICKUP order, which the tablet tray must not render a second time', () => {
    // Duplicate-by-id prevention on the INPUT is M-2.5's own contract
    // (useOrderBoard's Map-keyed reconciliation); what this asserts is that
    // OrderBoard itself introduces no second copy on top of a clean input —
    // in particular, a READY_FOR_PICKUP order must appear once in the DOM,
    // not once in the desktop column and again in the tablet tray body.
    mockUseOrderBoard.mockReturnValue(
      boardState({
        orders: [
          order({ id: '1', state: 'PAID' }),
          order({ id: '2', state: 'READY_FOR_PICKUP', readyAt: new Date().toISOString() }),
        ],
      }),
    );
    render(<OrderBoard restaurantId="rest-a" />);

    expect(screen.getAllByTestId('order-card-1')).toHaveLength(1);
    expect(screen.getAllByTestId('order-card-2')).toHaveLength(1);
  });
});

describe('OrderBoard — empty / loading / error', () => {
  it('renders the exact approved empty copy for column 1', () => {
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [] }));
    render(<OrderBoard restaurantId="rest-a" />);
    expect(screen.getByText('ยังไม่มีออเดอร์ใหม่')).toBeInTheDocument();
  });

  it('loading is visually distinct from empty — no empty copy renders while loading', () => {
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [], loading: true }));
    render(<OrderBoard restaurantId="rest-a" />);

    expect(screen.queryByText('ยังไม่มีออเดอร์ใหม่')).not.toBeInTheDocument();
    expect(screen.getByText('กำลังโหลดออเดอร์')).toBeInTheDocument();
  });

  it('error (with nothing loaded) is distinct from empty — no empty copy renders', () => {
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [], error: 'network error' }));
    render(<OrderBoard restaurantId="rest-a" />);

    expect(screen.queryByText('ยังไม่มีออเดอร์ใหม่')).not.toBeInTheDocument();
    expect(screen.getByText('โหลดออเดอร์ไม่สำเร็จ')).toBeInTheDocument();
  });

  it('retry in the error state calls refetch', () => {
    const refetch = jest.fn();
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [], error: 'network error', refetch }));
    render(<OrderBoard restaurantId="rest-a" />);

    screen.getByRole('button', { name: 'ลองใหม่อีกครั้ง' }).click();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('a background refetch error preserves already-loaded orders instead of blanking the board', () => {
    mockUseOrderBoard.mockReturnValue(
      boardState({ orders: [order({ id: '1', state: 'PAID' })], error: 'network error' }),
    );
    render(<OrderBoard restaurantId="rest-a" />);

    expect(screen.getByTestId('order-card-1')).toBeInTheDocument();
    expect(screen.queryByText('โหลดออเดอร์ไม่สำเร็จ')).not.toBeInTheDocument();
  });
});

describe('OrderBoard — realtime connection state', () => {
  it('renders the exact approved reconnecting copy when the subscription is degraded', () => {
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [], realtimeStatus: 'CHANNEL_ERROR' }));
    render(<OrderBoard restaurantId="rest-a" />);
    expect(screen.getByText('การเชื่อมต่อหลุด · กำลังเชื่อมต่อใหม่')).toBeInTheDocument();
  });

  it('does not render the reconnecting banner while connected', () => {
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [], realtimeStatus: 'SUBSCRIBED' }));
    render(<OrderBoard restaurantId="rest-a" />);
    expect(screen.queryByText('การเชื่อมต่อหลุด · กำลังเชื่อมต่อใหม่')).not.toBeInTheDocument();
  });

  it('does not render the reconnecting banner during the initial CONNECTING phase', () => {
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [], loading: true, realtimeStatus: 'CONNECTING' }));
    render(<OrderBoard restaurantId="rest-a" />);
    expect(screen.queryByText('การเชื่อมต่อหลุด · กำลังเชื่อมต่อใหม่')).not.toBeInTheDocument();
  });
});

describe('OrderBoard — restaurant scope', () => {
  it('passes the given restaurantId straight into useOrderBoard', () => {
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [] }));
    render(<OrderBoard restaurantId="rest-xyz" />);
    expect(mockUseOrderBoard).toHaveBeenCalledWith('rest-xyz');
  });

  it('passes null through unchanged rather than substituting a stored value', () => {
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [] }));
    render(<OrderBoard restaurantId={null} />);
    expect(mockUseOrderBoard).toHaveBeenCalledWith(null);
  });
});

describe('OrderBoard — ready-for-pickup tray (tablet)', () => {
  it('toggles the tray open and closed without any timer', () => {
    mockUseOrderBoard.mockReturnValue(
      boardState({ orders: [order({ id: '1', state: 'READY_FOR_PICKUP', readyAt: new Date().toISOString() })] }),
    );
    render(<OrderBoard restaurantId="rest-a" />);

    // The toggle is CSS-hidden at desktop width (`.banhao-board-ready-toggle`,
    // visible only under the tablet `@media (max-width: 1024px)` rule) — it
    // exists in the DOM at every width, only its visibility changes. Queried
    // by testid rather than role+name: jsdom does not evaluate the media
    // query, and `dom-accessibility-api` returns an empty computed name for
    // a `display:none` element even with an explicit `aria-label` — a
    // testing-environment limitation, not a real accessibility gap (a sighted
    // tablet user only ever sees this control when it is actually visible,
    // where its aria-label reads correctly).
    const toggle = screen.getByTestId('ready-tray-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('OrderBoard — no data-layer or Realtime duplication', () => {
  const source = readFileSync(join(__dirname, 'OrderBoard.tsx'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('never imports or calls the Supabase client', () => {
    expect(code).not.toMatch(/from '\.\.\/lib\/supabase'/);
    expect(code).not.toMatch(/@supabase\/supabase-js/);
  });

  it('never opens a channel or registers postgres_changes', () => {
    expect(code).not.toMatch(/\.channel\(/);
    expect(code).not.toMatch(/postgres_changes/);
  });

  it('introduces no timer or polling loop', () => {
    expect(code).not.toMatch(/setInterval/);
    expect(code).not.toMatch(/setTimeout/);
  });

  it('goes through useOrderBoard, not a second repository', () => {
    expect(code).not.toMatch(/from '\.\.\/repositories'/);
    expect(code).toMatch(/from '\.\.\/hooks\/useOrderBoard'/);
  });

  // M-2.7 — the same discipline for the write path.
  it('issues commands through the useOrderActions seam, never its own fetch', () => {
    expect(code).toMatch(/from '\.\.\/hooks\/useOrderActions'/);
    expect(code).not.toMatch(/fetch\(/);
    expect(code).not.toMatch(/apiClient/);
  });
});

// ---------------------------------------------------------------------------
// M-2.7 — board ↔ action integration.
//
// `useOrderActions` runs for real here; only the repository underneath it is
// mocked. That is the point: these tests prove a click travels
// OrderCard → OrderBoard → useOrderActions → repository, and — critically —
// that a *successful* command does not move the card. Only `useOrderBoard`
// (i.e. Realtime) may do that.
// ---------------------------------------------------------------------------

jest.mock('../repositories', () => ({
  repositories: {
    merchantOrders: {
      listRestaurantOrders: jest.fn(),
      transitionOrder: jest.fn(),
    },
  },
}));

const transitionOrder = repositories.merchantOrders.transitionOrder as jest.Mock;

describe('OrderBoard — order actions (M-2.7)', () => {
  beforeEach(() => {
    transitionOrder.mockReset();
    transitionOrder.mockResolvedValue({ orderId: 'o1', state: 'MERCHANT_ACCEPTED' });
  });

  /**
   * M-05 changed the accept trigger: `รับออเดอร์` opens the confirmation
   * dialog and the command is issued only after a prep time is chosen and
   * confirmed. Every M-2.7 assertion below is unchanged in substance — it just
   * reaches the command through the step the merchant now actually takes.
   */
  function acceptThroughDialog(button: HTMLElement, prepMinutes = 20) {
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('radio', { name: `${prepMinutes} นาที` }));
    fireEvent.click(screen.getByTestId('accept-dialog-confirm'));
  }

  it('routes a card action to the repository with the order id and command', async () => {
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [order({ id: 'o1', state: 'PAID' })] }));
    render(<OrderBoard restaurantId="rest-a" />);

    acceptThroughDialog(screen.getByRole('button', { name: 'รับออเดอร์' }));

    await waitFor(() =>
      expect(transitionOrder).toHaveBeenCalledWith('o1', { command: 'accept', prepMinutes: 20 }),
    );
  });

  it.each([
    ['MERCHANT_ACCEPTED', 'เริ่มทำอาหาร', 'start-preparing'],
    ['PREPARING', 'อาหารพร้อม', 'mark-ready'],
  ] as const)('routes the %s action as %s', async (state, label, command) => {
    mockUseOrderBoard.mockReturnValue(
      boardState({ orders: [order({ id: 'o1', state, acceptedAt: new Date(Date.now() - 120_000).toISOString() })] }),
    );
    render(<OrderBoard restaurantId="rest-a" />);

    fireEvent.click(screen.getByRole('button', { name: label }));

    await waitFor(() => expect(transitionOrder).toHaveBeenCalledWith('o1', { command }));
  });

  it('does not move the card on a successful command — Realtime remains authoritative', async () => {
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [order({ id: 'o1', state: 'PAID' })] }));
    render(<OrderBoard restaurantId="rest-a" />);

    acceptThroughDialog(screen.getByRole('button', { name: 'รับออเดอร์' }));
    await waitFor(() => expect(transitionOrder).toHaveBeenCalledTimes(1));

    // The board state the component was given still says PAID, so the card
    // must still be the PAID card. Nothing may promote it locally.
    expect(screen.getByTestId('order-card-o1')).toHaveAttribute('data-state', 'PAID');
    expect(screen.getByRole('button', { name: 'รับออเดอร์' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'เริ่มทำอาหาร' })).not.toBeInTheDocument();
  });

  it('moves the card only when the board reports the new state', async () => {
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [order({ id: 'o1', state: 'PAID' })] }));
    const view = render(<OrderBoard restaurantId="rest-a" />);

    acceptThroughDialog(screen.getByRole('button', { name: 'รับออเดอร์' }));
    await waitFor(() => expect(transitionOrder).toHaveBeenCalledTimes(1));

    // Realtime lands: useOrderBoard now reports MERCHANT_ACCEPTED.
    mockUseOrderBoard.mockReturnValue(
      boardState({
        orders: [
          order({ id: 'o1', state: 'MERCHANT_ACCEPTED', acceptedAt: new Date(Date.now() - 1000).toISOString() }),
        ],
      }),
    );
    view.rerender(<OrderBoard restaurantId="rest-a" />);

    expect(screen.getByTestId('order-card-o1')).toHaveAttribute('data-state', 'MERCHANT_ACCEPTED');
    // ...and the pending state resolves with it, leaving the next command live.
    const next = screen.getByRole('button', { name: 'เริ่มทำอาหาร' });
    expect(next).toBeEnabled();
    expect(next).toHaveAttribute('aria-busy', 'false');
  });

  it('issues one request for a double click on the same card', async () => {
    let release!: (value: unknown) => void;
    transitionOrder.mockReturnValue(new Promise((res) => {
      release = res;
    }));

    mockUseOrderBoard.mockReturnValue(boardState({ orders: [order({ id: 'o1', state: 'PAID' })] }));
    render(<OrderBoard restaurantId="rest-a" />);

    fireEvent.click(screen.getByRole('button', { name: 'รับออเดอร์' }));
    fireEvent.click(screen.getByRole('radio', { name: '20 นาที' }));

    const confirm = screen.getByTestId('accept-dialog-confirm');
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(transitionOrder).toHaveBeenCalledTimes(1));

    await act(async () => {
      release({ orderId: 'o1', state: 'MERCHANT_ACCEPTED' });
    });
  });

  it('leaves other cards interactive while one is pending', async () => {
    let release!: (value: unknown) => void;
    transitionOrder.mockReturnValue(new Promise((res) => {
      release = res;
    }));

    mockUseOrderBoard.mockReturnValue(
      boardState({
        orders: [
          order({ id: 'o1', state: 'PAID', placedAt: new Date(Date.now() - 60_000).toISOString() }),
          order({ id: 'o2', state: 'PAID', placedAt: new Date(Date.now() - 90_000).toISOString() }),
        ],
      }),
    );
    render(<OrderBoard restaurantId="rest-a" />);

    const [first, second] = screen.getAllByRole('button', { name: 'รับออเดอร์' });
    acceptThroughDialog(first!);

    await waitFor(() => expect(first!).toBeDisabled());
    expect(second!).toBeEnabled();
    expect(second!).toHaveAttribute('aria-busy', 'false');

    await act(async () => {
      release({ orderId: 'o1', state: 'MERCHANT_ACCEPTED' });
    });
  });

  it('surfaces a failure inline, keeps the card, and allows a retry', async () => {
    transitionOrder.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'INVALID_TRANSITION' }));

    mockUseOrderBoard.mockReturnValue(
      boardState({
        orders: [
          order({ id: 'o1', state: 'MERCHANT_ACCEPTED', acceptedAt: new Date(Date.now() - 120_000).toISOString() }),
        ],
      }),
    );
    render(<OrderBoard restaurantId="rest-a" />);

    // A start-preparing failure still reports on the card — M-05 only moved
    // the *accept* failure into its own dialog.
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มทำอาหาร' }));

    await waitFor(() =>
      expect(screen.getByTestId('order-action-error-o1')).toHaveTextContent(
        'ออเดอร์นี้ถูกเปลี่ยนสถานะไปแล้ว · กระดานจะอัปเดตเอง',
      ),
    );

    // The board is intact — one failed command never blanks it.
    expect(screen.getByTestId('order-card-o1')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'กำลังทำ' })).toBeInTheDocument();

    // ...and the action is live again.
    const retry = screen.getByRole('button', { name: 'เริ่มทำอาหาร' });
    expect(retry).toBeEnabled();

    transitionOrder.mockResolvedValue({ orderId: 'o1', state: 'PREPARING' });
    fireEvent.click(retry);

    await waitFor(() => expect(transitionOrder).toHaveBeenCalledTimes(2));
  });

  it('never issues a command for a READY_FOR_PICKUP card', () => {
    mockUseOrderBoard.mockReturnValue(
      boardState({
        orders: [order({ id: 'o1', state: 'READY_FOR_PICKUP', readyAt: new Date(Date.now() - 60_000).toISOString() })],
      }),
    );
    render(<OrderBoard restaurantId="rest-a" />);

    fireEvent.click(screen.getByTestId('order-card-o1'));
    expect(transitionOrder).not.toHaveBeenCalled();
  });

  it('scopes every command to the order it was issued from, never a sibling', async () => {
    mockUseOrderBoard.mockReturnValue(
      boardState({
        orders: [
          order({ id: 'o1', state: 'PAID', placedAt: new Date(Date.now() - 60_000).toISOString() }),
          order({ id: 'o2', state: 'PAID', placedAt: new Date(Date.now() - 90_000).toISOString() }),
        ],
      }),
    );
    render(<OrderBoard restaurantId="rest-a" />);

    acceptThroughDialog(screen.getAllByRole('button', { name: 'รับออเดอร์' })[1]!);

    await waitFor(() => expect(transitionOrder).toHaveBeenCalledTimes(1));
    expect(transitionOrder).toHaveBeenCalledWith('o2', { command: 'accept', prepMinutes: 20 });
  });
});
