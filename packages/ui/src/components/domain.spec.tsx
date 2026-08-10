import { render, screen } from '@testing-library/react-native';
import { ListRow } from './domain';

/**
 * DEF-04. The selected state used to be the character `✓` (U+2713), which
 * IBM Plex Sans Thai does not contain — iOS substituted a glyph that reads as a
 * square-root sign. The mark is now drawn, so the guarantee worth asserting is
 * that no substitutable character is rendered.
 */
describe('ListRow selected state', () => {
  it('marks the selected row without relying on a font glyph', () => {
    render(<ListRow title="พร้อมเพย์ QR" selected testID="row" />);

    expect(screen.queryByText('✓')).toBeNull();
    expect(screen.queryByText('√')).toBeNull();
    expect(screen.getByTestId('row').props.accessibilityState).toEqual({ selected: true });
  });

  it('does not mark an unselected row', () => {
    render(<ListRow title="เงินสดปลายทาง" selected={false} testID="row" />);

    expect(screen.getByTestId('row').props.accessibilityState).toEqual({ selected: false });
  });
});
