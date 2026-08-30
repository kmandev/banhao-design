import { fireEvent, render, screen } from '@testing-library/react-native';
import { ErrorState } from './ErrorState';

describe('ErrorState', () => {
  it('renders headline, detail and a default retry label', () => {
    render(<ErrorState headline="โหลดสถานะไรเดอร์ไม่สำเร็จ" detail="ตรวจการเชื่อมต่ออินเทอร์เน็ต แล้วลองอีกครั้ง" onRetry={jest.fn()} />);

    expect(screen.getByText('โหลดสถานะไรเดอร์ไม่สำเร็จ')).toBeTruthy();
    expect(screen.getByText('ตรวจการเชื่อมต่ออินเทอร์เน็ต แล้วลองอีกครั้ง')).toBeTruthy();
    expect(screen.getByText('ลองอีกครั้ง')).toBeTruthy();
  });

  it('renders the raw server message when given, unparaphrased', () => {
    render(<ErrorState headline="h" serverMessage="network request failed" onRetry={jest.fn()} testID="error" />);
    expect(screen.getByTestId('error-server-message')).toBeTruthy();
    expect(screen.getByText('network request failed')).toBeTruthy();
  });

  it('omits the server message line when none is given', () => {
    render(<ErrorState headline="h" onRetry={jest.fn()} testID="error" />);
    expect(screen.queryByTestId('error-server-message')).toBeNull();
  });

  it('calls onRetry when the retry button is pressed', () => {
    const onRetry = jest.fn();
    render(<ErrorState headline="h" onRetry={onRetry} testID="error" />);

    fireEvent.press(screen.getByTestId('error-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('accepts a custom retry label', () => {
    render(<ErrorState headline="h" onRetry={jest.fn()} retryLabel="รีเฟรช" />);
    expect(screen.getByText('รีเฟรช')).toBeTruthy();
  });

  it('accepts a retryTestID override, for callers migrating a pre-existing testID', () => {
    const onRetry = jest.fn();
    render(<ErrorState headline="h" onRetry={onRetry} testID="my-error" retryTestID="button-retry-legacy" />);

    expect(screen.queryByTestId('my-error-retry')).toBeNull();
    fireEvent.press(screen.getByTestId('button-retry-legacy'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
