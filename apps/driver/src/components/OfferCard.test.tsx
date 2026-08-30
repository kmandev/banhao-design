import { fireEvent, render, screen } from '@testing-library/react-native';
import { OfferCard, type OfferCardOffer } from './OfferCard';

const OFFER: OfferCardOffer = {
  offerId: 'offer-1',
  roundNo: 1,
  offeredAt: '2026-08-25T14:39:36.000Z',
  expiresAt: '2026-08-25T14:40:36.000Z',
};

describe('OfferCard', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-25T14:39:55.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders the round number and a live countdown', () => {
    render(<OfferCard offer={OFFER} onAccept={jest.fn()} onDecline={jest.fn()} />);

    expect(screen.getByText('งานรอบที่ 1')).toBeTruthy();
    expect(screen.getByText('งานใหม่')).toBeTruthy();
    expect(screen.getByText('00:41')).toBeTruthy();
  });

  it('calls onAccept and onDecline', () => {
    const onAccept = jest.fn();
    const onDecline = jest.fn();
    render(<OfferCard offer={OFFER} onAccept={onAccept} onDecline={onDecline} />);

    fireEvent.press(screen.getByTestId(`button-accept-${OFFER.offerId}`));
    fireEvent.press(screen.getByTestId(`button-decline-${OFFER.offerId}`));

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('shows the acting state and keeps both buttons in a loading state while busy', () => {
    render(<OfferCard offer={OFFER} busy onAccept={jest.fn()} onDecline={jest.fn()} />);

    expect(screen.getByText('กำลังส่งคำขอรับงาน')).toBeTruthy();
    expect(screen.getByTestId(`button-accept-${OFFER.offerId}`).props.accessibilityState.busy).toBe(true);
    expect(screen.getByTestId(`button-decline-${OFFER.offerId}`).props.accessibilityState.busy).toBe(true);
  });

  it('does not call onAccept/onDecline when disabled by another card being busy', () => {
    const onAccept = jest.fn();
    const onDecline = jest.fn();
    render(<OfferCard offer={OFFER} disabled onAccept={onAccept} onDecline={onDecline} />);

    fireEvent.press(screen.getByTestId(`button-accept-${OFFER.offerId}`));
    fireEvent.press(screen.getByTestId(`button-decline-${OFFER.offerId}`));

    expect(onAccept).not.toHaveBeenCalled();
    expect(onDecline).not.toHaveBeenCalled();
  });

  it('renders the expired treatment and note, with both buttons still enabled — server decides expiry', () => {
    const expiredOffer: OfferCardOffer = { ...OFFER, expiresAt: '2026-08-25T14:00:00.000Z' };
    const onAccept = jest.fn();
    render(<OfferCard offer={expiredOffer} onAccept={onAccept} onDecline={jest.fn()} />);

    expect(screen.getByText('หมดเวลารับ')).toBeTruthy();
    expect(screen.getByText('งานนี้เลยเวลารับแล้ว จะหายไปจากรายการเมื่อระบบอัปเดตรอบถัดไป')).toBeTruthy();

    fireEvent.press(screen.getByTestId(`button-accept-${expiredOffer.offerId}`));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('treats a null expiresAt as expired', () => {
    const nullExpiry: OfferCardOffer = { ...OFFER, expiresAt: null };
    render(<OfferCard offer={nullExpiry} onAccept={jest.fn()} onDecline={jest.fn()} />);

    expect(screen.getByText('หมดเวลารับ')).toBeTruthy();
  });
});
