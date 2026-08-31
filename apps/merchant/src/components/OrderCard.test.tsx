import { fireEvent, render, screen } from '@testing-library/react';
import type { MerchantOrderSummary } from '../domain/order';
import { OrderCard } from './OrderCard';

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

const NOW = Date.parse('2026-08-31T04:42:00.000Z');

describe('OrderCard — approved fields', () => {
  it('renders orderNumber, name, and money using MerchantOrderSummary fields only', () => {
    render(<OrderCard order={order({ id: '1', grandTotalSatang: 18500 })} now={NOW} />);

    expect(screen.getByText('#BH-20260831-0007')).toBeInTheDocument();
    expect(screen.getByText('คุณสมชาย ใจดี')).toBeInTheDocument();
    expect(screen.getByText('฿185.00')).toBeInTheDocument();
  });

  it('never renders recipientPhoneSnapshot on the card face', () => {
    render(<OrderCard order={order({ id: '1', recipientPhoneSnapshot: '+66899999999' })} now={NOW} />);
    expect(screen.queryByText('+66899999999')).not.toBeInTheDocument();
  });

  it('returns nothing for a state with no board presentation', () => {
    const { container } = render(<OrderCard order={order({ id: '1', state: 'DELIVERED' })} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('OrderCard — PAID', () => {
  it('shows the new-order chip and a disabled, non-functional primary action', () => {
    render(<OrderCard order={order({ id: '1', state: 'PAID' })} now={NOW} />);

    expect(screen.getByText('ใหม่ · รอตอบรับ')).toBeInTheDocument();
    expect(screen.getByText('PAID')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /รับออเดอร์/ });
    expect(button).toBeDisabled();
  });

  it('shows the new-arrival banner for an order placed under 30 seconds ago', () => {
    render(<OrderCard order={order({ id: '1', state: 'PAID', placedAt: new Date(NOW - 5_000).toISOString() })} now={NOW} />);
    expect(screen.getByText(/ออเดอร์ใหม่ · เพิ่งเข้ามา/)).toBeInTheDocument();
  });

  it('does not show the arrival banner once past 30 seconds', () => {
    render(<OrderCard order={order({ id: '1', state: 'PAID', placedAt: new Date(NOW - 60_000).toISOString() })} now={NOW} />);
    expect(screen.queryByText(/ออเดอร์ใหม่ · เพิ่งเข้ามา/)).not.toBeInTheDocument();
  });

  it('shows the timeout banner and a disabled contact-admin action once the accept window has elapsed', () => {
    render(
      <OrderCard order={order({ id: '1', state: 'PAID', placedAt: new Date(NOW - 400_000).toISOString() })} now={NOW} />,
    );

    expect(screen.getByText('หมดเวลาตอบรับ · ติดต่อผู้ดูแลระบบ')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /ติดต่อผู้ดูแลระบบ/ });
    expect(button).toBeDisabled();
  });
});

describe('OrderCard — MERCHANT_ACCEPTED / PREPARING', () => {
  it('MERCHANT_ACCEPTED shows a disabled "เริ่มทำอาหาร" action', () => {
    render(
      <OrderCard
        order={order({ id: '1', state: 'MERCHANT_ACCEPTED', acceptedAt: '2026-08-31T04:39:00.000Z' })}
        now={NOW}
      />,
    );
    expect(screen.getByRole('button', { name: /เริ่มทำอาหาร/ })).toBeDisabled();
  });

  it('PREPARING shows a disabled "อาหารพร้อม" action', () => {
    render(
      <OrderCard order={order({ id: '1', state: 'PREPARING', acceptedAt: '2026-08-31T04:34:00.000Z' })} now={NOW} />,
    );
    expect(screen.getByRole('button', { name: /อาหารพร้อม/ })).toBeDisabled();
  });
});

describe('OrderCard — READY_FOR_PICKUP', () => {
  it('renders the waiting strip as a status region, not a button', () => {
    render(
      <OrderCard order={order({ id: '1', state: 'READY_FOR_PICKUP', readyAt: '2026-08-31T04:38:00.000Z' })} now={NOW} />,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('รอไรเดอร์มารับ');
  });
});

// ---------------------------------------------------------------------------
// M-2.7 — action wiring. The tests above deliberately pass no `onAction` and
// assert the unwired card still renders a disabled control; the tests below
// supply one. Both are real contracts: a card with no handler must never look
// pressable.
// ---------------------------------------------------------------------------

describe('OrderCard — wired actions', () => {
  it.each([
    ['PAID', 'รับออเดอร์', 'accept'],
    ['MERCHANT_ACCEPTED', 'เริ่มทำอาหาร', 'start-preparing'],
    ['PREPARING', 'อาหารพร้อม', 'mark-ready'],
  ] as const)('%s renders an enabled %s that issues %s', (state, label, command) => {
    const onAction = jest.fn();
    const subject = order({ id: '1', state, acceptedAt: '2026-08-31T04:39:00.000Z' });
    render(<OrderCard order={subject} now={NOW} onAction={onAction} />);

    const button = screen.getByRole('button', { name: label });
    expect(button).toBeEnabled();

    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(subject, command);
  });

  it('never wires the expired card — BQ-013 is open and there is no endpoint', () => {
    const onAction = jest.fn();
    render(
      <OrderCard
        order={order({ id: '1', state: 'PAID', placedAt: new Date(NOW - 400_000).toISOString() })}
        now={NOW}
        onAction={onAction}
      />,
    );

    const button = screen.getByRole('button', { name: /ติดต่อผู้ดูแลระบบ/ });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('keeps READY_FOR_PICKUP a non-tappable status even when a handler is supplied', () => {
    const onAction = jest.fn();
    render(
      <OrderCard
        order={order({ id: '1', state: 'READY_FOR_PICKUP', readyAt: '2026-08-31T04:38:00.000Z' })}
        now={NOW}
        onAction={onAction}
      />,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe('OrderCard — pending', () => {
  it('disables the action and marks it busy while pending', () => {
    render(<OrderCard order={order({ id: '1', state: 'PAID' })} now={NOW} onAction={jest.fn()} pending />);

    const button = screen.getByRole('button', { name: 'รับออเดอร์' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('does not issue a second command while pending', () => {
    const onAction = jest.fn();
    render(<OrderCard order={order({ id: '1', state: 'PAID' })} now={NOW} onAction={onAction} pending />);

    fireEvent.click(screen.getByRole('button', { name: 'รับออเดอร์' }));
    expect(onAction).not.toHaveBeenCalled();
  });

  it('keeps the design label while pending rather than substituting copy', () => {
    render(<OrderCard order={order({ id: '1', state: 'PAID' })} now={NOW} onAction={jest.fn()} pending />);
    expect(screen.getByRole('button', { name: 'รับออเดอร์' })).toBeInTheDocument();
  });

  it('is not busy when not pending', () => {
    render(<OrderCard order={order({ id: '1', state: 'PAID' })} now={NOW} onAction={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'รับออเดอร์' })).toHaveAttribute('aria-busy', 'false');
  });
});

describe('OrderCard — action failure', () => {
  it('shows the message as an alert and leaves the action pressable for a retry', () => {
    const onAction = jest.fn();
    render(
      <OrderCard
        order={order({ id: '1', state: 'PAID' })}
        now={NOW}
        onAction={onAction}
        actionError="ทำรายการไม่สำเร็จ · ลองอีกครั้ง"
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('ทำรายการไม่สำเร็จ · ลองอีกครั้ง');

    const button = screen.getByRole('button', { name: 'รับออเดอร์' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('keeps the card and its order data visible when a command failed', () => {
    render(
      <OrderCard order={order({ id: '1', state: 'PAID' })} now={NOW} onAction={jest.fn()} actionError="ล้มเหลว" />,
    );

    expect(screen.getByText('#BH-20260831-0007')).toBeInTheDocument();
    expect(screen.getByText('คุณสมชาย ใจดี')).toBeInTheDocument();
    expect(screen.getByText('฿185.00')).toBeInTheDocument();
  });

  it('renders no alert when there is no failure', () => {
    render(<OrderCard order={order({ id: '1', state: 'PAID' })} now={NOW} onAction={jest.fn()} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
