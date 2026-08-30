import { fireEvent, render, screen } from '@testing-library/react-native';
import { ListRow } from './ListRow';

describe('ListRow', () => {
  it('renders title, subtitle, icon and trailing', () => {
    render(<ListRow icon="📦" title="งานที่เสนอ" subtitle="1 งานใหม่" trailing="›" />);

    expect(screen.getByText('📦')).toBeTruthy();
    expect(screen.getByText('งานที่เสนอ')).toBeTruthy();
    expect(screen.getByText('1 งานใหม่')).toBeTruthy();
    expect(screen.getByText('›')).toBeTruthy();
  });

  it('omits subtitle and trailing when not given', () => {
    render(<ListRow title="งานที่เสนอ" testID="row" />);
    expect(screen.queryByTestId('row-subtitle')).toBeNull();
    expect(screen.queryByTestId('row-trailing')).toBeNull();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    render(<ListRow title="งานที่เสนอ" onPress={onPress} testID="row" />);

    fireEvent.press(screen.getByTestId('row'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is not a button when there is no onPress', () => {
    render(<ListRow title="งานที่เสนอ" testID="row" />);
    expect(screen.getByTestId('row').props.accessibilityRole).toBeUndefined();
  });

  describe('badge', () => {
    it('renders the count and hides trailing when badge is set', () => {
      render(<ListRow title="งานที่เสนอ" trailing="›" badge={2} testID="row" />);

      expect(screen.getByTestId('row-badge')).toBeTruthy();
      expect(screen.getByText('2')).toBeTruthy();
      expect(screen.queryByTestId('row-trailing')).toBeNull();
    });

    it('renders a 0 badge when explicitly given — the component never special-cases zero', () => {
      render(<ListRow title="งานที่เสนอ" badge={0} testID="row" />);
      expect(screen.getByTestId('row-badge')).toBeTruthy();
      expect(screen.getByText('0')).toBeTruthy();
    });

    it('falls back to trailing when badge is omitted', () => {
      render(<ListRow title="งานที่เสนอ" trailing="›" testID="row" />);
      expect(screen.queryByTestId('row-badge')).toBeNull();
      expect(screen.getByTestId('row-trailing')).toBeTruthy();
    });
  });
});
