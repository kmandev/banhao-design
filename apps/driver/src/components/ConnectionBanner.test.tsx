import { render, screen } from '@testing-library/react-native';
import { ConnectionBanner } from './ConnectionBanner';

describe('ConnectionBanner', () => {
  it('renders nothing when not visible', () => {
    render(<ConnectionBanner visible={false} testID="banner" />);
    expect(screen.queryByTestId('banner')).toBeNull();
  });

  it('renders the default message when visible', () => {
    render(<ConnectionBanner visible testID="banner" />);
    expect(screen.getByText('เชื่อมต่อไม่ได้ — ข้อมูลอาจไม่เป็นปัจจุบัน')).toBeTruthy();
  });

  it('renders a caller-supplied message', () => {
    render(<ConnectionBanner visible message="ไม่มีสัญญาณ" testID="banner" />);
    expect(screen.getByText('ไม่มีสัญญาณ')).toBeTruthy();
  });
});
