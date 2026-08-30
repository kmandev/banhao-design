import { render, fireEvent, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { Button } from './Button';
import { sizes } from '../theme/tokens';

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

  describe('size', () => {
    function minHeightOf(testID: string): number | undefined {
      const button = screen.getByTestId(testID);
      const flattened = StyleSheet.flatten(button.props.style);
      return flattened.minHeight;
    }

    it('matches the existing default height when size is omitted', () => {
      render(<Button label="ยืนยัน" testID="btn" />);
      expect(minHeightOf('btn')).toBe(sizes.buttonHeight);
    });

    it('renders sm at the same height as the default (52)', () => {
      render(<Button label="ยืนยัน" size="sm" testID="btn" />);
      expect(minHeightOf('btn')).toBe(52);
      expect(minHeightOf('btn')).toBe(sizes.buttonHeight);
    });

    it('renders md at 56', () => {
      render(<Button label="ยืนยัน" size="md" testID="btn" />);
      expect(minHeightOf('btn')).toBe(56);
    });

    it('renders lg at 60', () => {
      render(<Button label="ยืนยัน" size="lg" testID="btn" />);
      expect(minHeightOf('btn')).toBe(60);
    });

    it('every variant still renders and responds to press at every size', () => {
      const variants = ['primary', 'secondary', 'ghost'] as const;
      const sizesToCheck = ['sm', 'md', 'lg'] as const;

      for (const variant of variants) {
        for (const size of sizesToCheck) {
          const onPress = jest.fn();
          const testID = `btn-${variant}-${size}`;
          render(<Button label="ยืนยัน" variant={variant} size={size} onPress={onPress} testID={testID} />);

          fireEvent.press(screen.getByTestId(testID));
          expect(onPress).toHaveBeenCalledTimes(1);
        }
      }
    });
  });

  it('default rendering (no size) is equivalent to the pre-T2.1 Button', () => {
    const onPress = jest.fn();
    render(<Button label="ยืนยัน" onPress={onPress} testID="btn" />);

    const button = screen.getByTestId('btn');
    const flattened = StyleSheet.flatten(button.props.style);

    expect(flattened.minHeight).toBe(sizes.buttonHeight);
    expect(screen.getByText('ยืนยัน')).toBeTruthy();

    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
