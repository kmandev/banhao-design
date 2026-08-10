import { render, fireEvent, screen } from '@testing-library/react-native';
import { Button } from './Button';

describe('Button', () => {
  it('renders its label', () => {
    render(<Button label="เพิ่มลงตะกร้า" />);
    expect(screen.getByText('เพิ่มลงตะกร้า')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    render(<Button label="ยืนยัน" onPress={onPress} testID="btn" />);

    fireEvent.press(screen.getByTestId('btn'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress when disabled', () => {
    const onPress = jest.fn();
    render(<Button label="ยืนยัน" onPress={onPress} disabled testID="btn" />);

    fireEvent.press(screen.getByTestId('btn'));

    expect(onPress).not.toHaveBeenCalled();
  });

  it('does not call onPress while loading', () => {
    const onPress = jest.fn();
    render(<Button label="ยืนยัน" onPress={onPress} loading testID="btn" />);

    fireEvent.press(screen.getByTestId('btn'));

    expect(onPress).not.toHaveBeenCalled();
  });

  it('hides the label and shows a spinner while loading', () => {
    render(<Button label="ยืนยัน" loading />);
    expect(screen.queryByText('ยืนยัน')).toBeNull();
  });

  it('renders trailing text, e.g. the price on a cart CTA', () => {
    render(<Button label="ยืนยันการสั่ง" trailing="฿130" />);
    expect(screen.getByText('฿130')).toBeTruthy();
  });

  it('exposes button role and disabled state to accessibility', () => {
    render(<Button label="ยืนยัน" disabled testID="btn" />);

    const button = screen.getByTestId('btn');
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityState.disabled).toBe(true);
  });
});
