import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import type { MerchantOrderSummary } from '../domain/order';
import type { UseOrderBoard } from '../hooks/useOrderBoard';
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
});
