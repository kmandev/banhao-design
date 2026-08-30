import { act, render, screen } from '@testing-library/react-native';
import { Countdown } from './Countdown';

describe('Countdown', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-25T14:39:55.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders the no-expiry treatment for a null expiresAt', () => {
    render(<Countdown expiresAt={null} testID="cd" />);
    expect(screen.getByText('ไม่ระบุเวลา')).toBeTruthy();
  });

  it('derives the initial value from expiresAt alone', () => {
    render(<Countdown expiresAt="2026-08-25T14:40:36.000Z" testID="cd" />);
    expect(screen.getByText('00:41')).toBeTruthy();
  });

  it('ticks down once a second', () => {
    render(<Countdown expiresAt="2026-08-25T14:40:36.000Z" testID="cd" />);
    expect(screen.getByText('00:41')).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(screen.getByText('00:38')).toBeTruthy();
  });

  it('clamps at 00:00 and never goes negative', () => {
    render(<Countdown expiresAt="2026-08-25T14:39:57.000Z" testID="cd" />);

    act(() => {
      jest.advanceTimersByTime(10_000);
    });

    expect(screen.getByText('00:00')).toBeTruthy();
  });

  it('exposes a live region with a spoken label, never the bare digits', () => {
    render(<Countdown expiresAt="2026-08-25T14:40:36.000Z" testID="cd" />);

    const node = screen.getByTestId('cd');
    expect(node.props.accessibilityLiveRegion).toBe('polite');
    expect(node.props.accessibilityLabel).toBe('เหลือเวลารับงาน 41 วินาที');
  });
});
