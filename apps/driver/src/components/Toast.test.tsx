import { act, render, screen } from '@testing-library/react-native';
import { Toast } from './Toast';

describe('Toast', () => {
  it('renders nothing when message is null', () => {
    render(<Toast message={null} testID="toast" />);
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('renders the message when set', () => {
    render(<Toast message="งานนี้ถูกไรเดอร์คนอื่นรับไปแล้ว" testID="toast" />);
    expect(screen.getByText('งานนี้ถูกไรเดอร์คนอื่นรับไปแล้ว')).toBeTruthy();
  });

  it('calls onHide after the 4s hold', () => {
    jest.useFakeTimers();
    const onHide = jest.fn();
    render(<Toast message="OFFER_TAKEN" onHide={onHide} testID="toast" />);

    expect(onHide).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(4000);
    });

    expect(onHide).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('does not call onHide when there is no message', () => {
    jest.useFakeTimers();
    const onHide = jest.fn();
    render(<Toast message={null} onHide={onHide} testID="toast" />);

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(onHide).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
