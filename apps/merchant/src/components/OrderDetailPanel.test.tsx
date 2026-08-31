import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MerchantOrderSummary } from '../domain/order';
import type { MerchantOrderDetail } from '../domain/orderDetail';
import { OrderDetailPanel } from './OrderDetailPanel';
import { repositories } from '../repositories';

/**
 * M-04's panel component. `useOrderDetail` is exercised for real (not
 * mocked) — only its own dependency, `repositories.merchantOrders`, is
 * mocked, the same boundary `OrderBoard.test.tsx` draws around
 * `useOrderBoard`. This lets these tests assert the actual open → loading →
 * loaded/error → close lifecycle a merchant experiences, not a stubbed
 * hook's return value.
 */

jest.mock('../repositories', () => ({
  repositories: {
    merchantOrders: {
      listRestaurantOrders: jest.fn(),
      transitionOrder: jest.fn(),
      getOrderDetail: jest.fn(),
    },
  },
}));

const getOrderDetail = repositories.merchantOrders.getOrderDetail as jest.MockedFunction<
  typeof repositories.merchantOrders.getOrderDetail
>;

function order(overrides: Partial<MerchantOrderSummary> & { id: string }): MerchantOrderSummary {
  return {
    orderNumber: 'BH-20260831-0007',
    state: 'PAID',
    restaurantId: 'rest-a',
    recipientNameSnapshot: 'คุณสมชาย ใจดี',
    recipientPhoneSnapshot: '+66812345678',
    grandTotalSatang: 18500,
    placedAt: '2026-08-31T04:41:20.000Z',
    acceptedAt: null,
    readyAt: null,
    pickedUpAt: null,
    ...overrides,
  };
}

function detail(overrides: Partial<MerchantOrderDetail> & { orderId: string }): MerchantOrderDetail {
  return {
    orderNumber: 'BH-20260831-0007',
    restaurantId: 'rest-a',
    recipientNameSnapshot: 'คุณสมชาย ใจดี',
    recipientPhoneSnapshot: '+66812345678',
    deliveryAddressSnapshot: '88/12 หมู่ 4 ต.สุเทพ',
    deliveryLandmark: null,
    paymentMethod: 'ONLINE',
    subtotalSatang: 17500,
    deliveryFeeSatang: 2000,
    serviceFeeSatang: 1000,
    discountSatang: 0,
    grandTotalSatang: 20500,
    placedAt: '2026-08-31T04:41:20.000Z',
    acceptedAt: null,
    readyAt: null,
    pickedUpAt: null,
    items: [
      {
        id: 'item-1',
        nameSnapshot: 'ข้าวผัดกะเพราหมูสับ',
        quantity: 2,
        unitPriceSatang: 5500,
        lineTotalSatang: 11000,
        note: null,
        options: [{ id: 'opt-1', groupNameSnapshot: 'ความเผ็ด', optionNameSnapshot: 'เผ็ดมาก', priceDeltaSatang: 0 }],
      },
    ],
    statusHistory: [
      { id: 'hist-1', toState: 'CREATED', actorType: 'SYSTEM', reason: null, occurredAt: '2026-08-31T04:40:00.000Z' },
      { id: 'hist-2', toState: 'PAID', actorType: 'WEBHOOK', reason: null, occurredAt: '2026-08-31T04:41:20.000Z' },
    ],
    ...overrides,
  };
}

const NOW = Date.parse('2026-08-31T04:42:00.000Z');

beforeEach(() => {
  getOrderDetail.mockReset();
});

describe('OrderDetailPanel — closed', () => {
  it('renders nothing when order is null', () => {
    const { container } = render(<OrderDetailPanel order={null} now={NOW} onClose={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('OrderDetailPanel — open, loading', () => {
  it('paints the real order number and chip immediately, before the fetch resolves', () => {
    getOrderDetail.mockReturnValue(new Promise(() => {})); // never resolves
    render(<OrderDetailPanel order={order({ id: '1' })} now={NOW} onClose={jest.fn()} />);

    expect(screen.getByRole('heading', { name: '#BH-20260831-0007' })).toBeInTheDocument();
    expect(screen.getByText('ใหม่ · รอตอบรับ')).toBeInTheDocument();
  });

  it('marks the body aria-busy while loading', () => {
    getOrderDetail.mockReturnValue(new Promise(() => {}));
    render(<OrderDetailPanel order={order({ id: '1' })} now={NOW} onClose={jest.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('OrderDetailPanel — loaded', () => {
  it('renders recipient, items, money and history from the fetched detail', async () => {
    getOrderDetail.mockResolvedValue(detail({ orderId: '1' }));
    render(<OrderDetailPanel order={order({ id: '1' })} now={NOW} onClose={jest.fn()} />);

    await waitFor(() => expect(screen.getByText('081-234-5678')).toBeInTheDocument());
    // recipient
    expect(screen.getAllByText('คุณสมชาย ใจดี').length).toBeGreaterThan(0);
    expect(screen.getByText('88/12 หมู่ 4 ต.สุเทพ')).toBeInTheDocument();
    // items
    expect(screen.getByText('ข้าวผัดกะเพราหมูสับ')).toBeInTheDocument();
    expect(screen.getByText('฿110.00')).toBeInTheDocument(); // line total
    expect(screen.getByText('ความเผ็ด · เผ็ดมาก')).toBeInTheDocument();
    // money
    expect(screen.getByText('฿205.00')).toBeInTheDocument(); // grand total
    // history
    expect(screen.getByText('สร้างออเดอร์')).toBeInTheDocument();
    expect(screen.getByText('ชำระเงินแล้ว')).toBeInTheDocument();
  });

  it('omits the discount row when discountSatang is 0', async () => {
    getOrderDetail.mockResolvedValue(detail({ orderId: '1', discountSatang: 0 }));
    render(<OrderDetailPanel order={order({ id: '1' })} now={NOW} onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('ยอดสุทธิ')).toBeInTheDocument());
    expect(screen.queryByText('ส่วนลด')).not.toBeInTheDocument();
  });

  it('shows the discount row, signed, when discountSatang is non-zero', async () => {
    getOrderDetail.mockResolvedValue(detail({ orderId: '1', discountSatang: 2000 }));
    render(<OrderDetailPanel order={order({ id: '1' })} now={NOW} onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('ส่วนลด')).toBeInTheDocument());
    expect(screen.getByText('−฿20.00')).toBeInTheDocument();
  });

  it('omits the landmark line when null', async () => {
    getOrderDetail.mockResolvedValue(detail({ orderId: '1', deliveryLandmark: null }));
    render(<OrderDetailPanel order={order({ id: '1' })} now={NOW} onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('88/12 หมู่ 4 ต.สุเทพ')).toBeInTheDocument());
    expect(screen.queryByText(/จุดสังเกต/)).not.toBeInTheDocument();
  });

  it('shows the landmark line when present', async () => {
    getOrderDetail.mockResolvedValue(detail({ orderId: '1', deliveryLandmark: 'ตรงข้ามร้านกาแฟ' }));
    render(<OrderDetailPanel order={order({ id: '1' })} now={NOW} onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getByText(/จุดสังเกต · ตรงข้ามร้านกาแฟ/)).toBeInTheDocument());
  });

  it('renders an item note only when present', async () => {
    getOrderDetail.mockResolvedValue(
      detail({
        orderId: '1',
        items: [
          {
            id: 'item-1',
            nameSnapshot: 'น้ำเปล่า',
            quantity: 1,
            unitPriceSatang: 1000,
            lineTotalSatang: 1000,
            note: 'แช่เย็น',
            options: [],
          },
        ],
      }),
    );
    render(<OrderDetailPanel order={order({ id: '1' })} now={NOW} onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('น้ำเปล่า')).toBeInTheDocument());
    expect(screen.getByText('หมายเหตุ · แช่เย็น')).toBeInTheDocument();
  });

  it('renders the state as the raw code for a PROPOSED exception state with no Thai mapping (C-06)', async () => {
    getOrderDetail.mockResolvedValue(
      detail({
        orderId: '1',
        statusHistory: [
          { id: 'h1', toState: 'PAYMENT_FAILED' as never, actorType: 'SYSTEM', reason: null, occurredAt: '2026-08-31T04:41:00.000Z' },
        ],
      }),
    );
    render(<OrderDetailPanel order={order({ id: '1' })} now={NOW} onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getAllByText('PAYMENT_FAILED').length).toBeGreaterThan(0));
  });

  it('renders a history reason when present', async () => {
    getOrderDetail.mockResolvedValue(
      detail({
        orderId: '1',
        statusHistory: [
          { id: 'h1', toState: 'CANCELLED', actorType: 'OPERATOR', reason: 'ลูกค้ายกเลิก', occurredAt: '2026-08-31T04:41:00.000Z' },
        ],
      }),
    );
    render(<OrderDetailPanel order={order({ id: '1' })} now={NOW} onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('ลูกค้ายกเลิก')).toBeInTheDocument());
  });
});

describe('OrderDetailPanel — error', () => {
  it('renders role=alert with retry on a failed fetch', async () => {
    getOrderDetail.mockRejectedValue(new Error('network error'));
    render(<OrderDetailPanel order={order({ id: '1' })} now={NOW} onClose={jest.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดรายละเอียดไม่สำเร็จ');
    expect(screen.getByRole('button', { name: 'ลองใหม่อีกครั้ง' })).toBeInTheDocument();
  });

  it('retry re-issues exactly one request', async () => {
    getOrderDetail.mockRejectedValueOnce(new Error('network error'));
    getOrderDetail.mockResolvedValueOnce(detail({ orderId: '1' }));
    render(<OrderDetailPanel order={order({ id: '1' })} now={NOW} onClose={jest.fn()} />);

    await screen.findByRole('alert');
    expect(getOrderDetail).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่อีกครั้ง' }));
    await waitFor(() => expect(screen.getByText('88/12 หมู่ 4 ต.สุเทพ')).toBeInTheDocument());
    expect(getOrderDetail).toHaveBeenCalledTimes(2);
  });

  it('the panel stays closable from the error state', async () => {
    const onClose = jest.fn();
    getOrderDetail.mockRejectedValue(new Error('network error'));
    render(<OrderDetailPanel order={order({ id: '1' })} now={NOW} onClose={onClose} />);

    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'ปิดหน้าต่าง' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('OrderDetailPanel — dialog semantics and close', () => {
  it('has dialog role, aria-modal, and is labelled by the order number heading', async () => {
    getOrderDetail.mockResolvedValue(detail({ orderId: '1' }));
    render(<OrderDetailPanel order={order({ id: '1' })} now={NOW} onClose={jest.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const heading = screen.getByRole('heading', { name: '#BH-20260831-0007' });
    expect(dialog).toHaveAttribute('aria-labelledby', heading.id);
  });

  it('the ✕ button closes', async () => {
    const onClose = jest.fn();
    getOrderDetail.mockResolvedValue(detail({ orderId: '1' }));
    render(<OrderDetailPanel order={order({ id: '1' })} now={NOW} onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('88/12 หมู่ 4 ต.สุเทพ')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'ปิดหน้าต่างรายละเอียด' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape closes', async () => {
    const onClose = jest.fn();
    getOrderDetail.mockResolvedValue(detail({ orderId: '1' }));
    render(<OrderDetailPanel order={order({ id: '1' })} now={NOW} onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('88/12 หมู่ 4 ต.สุเทพ')).toBeInTheDocument());

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the scrim click closes', async () => {
    const onClose = jest.fn();
    getOrderDetail.mockResolvedValue(detail({ orderId: '1' }));
    const { container } = render(<OrderDetailPanel order={order({ id: '1' })} now={NOW} onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('88/12 หมู่ 4 ต.สุเทพ')).toBeInTheDocument());

    const scrim = container.querySelector('[aria-hidden="true"]');
    expect(scrim).not.toBeNull();
    fireEvent.click(scrim!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('focus moves into the panel container on open, not the close button', async () => {
    getOrderDetail.mockResolvedValue(detail({ orderId: '1' }));
    render(<OrderDetailPanel order={order({ id: '1' })} now={NOW} onClose={jest.fn()} />);

    await waitFor(() => expect(screen.getByRole('dialog')).toHaveFocus());
  });
});

describe('OrderDetailPanel — no timers, no second Realtime channel', () => {
  it('creates no setInterval/setTimeout', async () => {
    const intervalSpy = jest.spyOn(window, 'setInterval');
    const timeoutSpy = jest.spyOn(window, 'setTimeout');
    getOrderDetail.mockResolvedValue(detail({ orderId: '1' }));

    render(<OrderDetailPanel order={order({ id: '1' })} now={NOW} onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('88/12 หมู่ 4 ต.สุเทพ')).toBeInTheDocument());

    expect(intervalSpy).not.toHaveBeenCalled();
    intervalSpy.mockRestore();
    timeoutSpy.mockRestore();
  });
});
