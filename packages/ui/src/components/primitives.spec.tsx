import { render, fireEvent, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { Input, Stepper, PriceRow, Card } from './primitives';

describe('Input', () => {
  it('renders label and value', () => {
    render(<Input label="เบอร์มือถือ" value="0812345678" />);
    expect(screen.getByText('เบอร์มือถือ')).toBeTruthy();
    expect(screen.getByDisplayValue('0812345678')).toBeTruthy();
  });

  it('shows an error and marks it as an alert for screen readers', () => {
    render(<Input label="เบอร์มือถือ" error="เบอร์ไม่ถูกต้อง" />);

    const error = screen.getByText('เบอร์ไม่ถูกต้อง');
    expect(error.props.accessibilityRole).toBe('alert');
  });

  it('renders a prefix such as the dial code', () => {
    render(<Input prefix="+66" />);
    expect(screen.getByText('+66')).toBeTruthy();
  });
});

describe('Stepper', () => {
  it('increments and decrements', () => {
    const onIncrease = jest.fn();
    const onDecrease = jest.fn();
    render(<Stepper value={2} onIncrease={onIncrease} onDecrease={onDecrease} />);

    fireEvent.press(screen.getByLabelText('เพิ่มจำนวน'));
    fireEvent.press(screen.getByLabelText('ลดจำนวน'));

    expect(onIncrease).toHaveBeenCalledTimes(1);
    expect(onDecrease).toHaveBeenCalledTimes(1);
  });

  it('will not decrement below the minimum', () => {
    const onDecrease = jest.fn();
    render(<Stepper value={1} onIncrease={jest.fn()} onDecrease={onDecrease} />);

    fireEvent.press(screen.getByLabelText('ลดจำนวน'));

    expect(onDecrease).not.toHaveBeenCalled();
  });
});

describe('PriceRow', () => {
  it('renders label and amount', () => {
    render(<PriceRow label="ค่าส่ง" amount="฿15" />);
    expect(screen.getByText('ค่าส่ง')).toBeTruthy();
    expect(screen.getByText('฿15')).toBeTruthy();
  });
});

describe('Card', () => {
  it('is pressable only when given onPress', () => {
    const onPress = jest.fn();
    render(
      <Card onPress={onPress} testID="card">
        <Text>เนื้อหา</Text>
      </Card>,
    );

    fireEvent.press(screen.getByTestId('card'));
    expect(onPress).toHaveBeenCalled();
  });
});
