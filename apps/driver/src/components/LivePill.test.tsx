import { render, screen } from '@testing-library/react-native';
import { LivePill } from './LivePill';

describe('LivePill', () => {
  it('renders the default label', () => {
    render(<LivePill testID="pill" />);
    expect(screen.getByText('อัปเดตอยู่')).toBeTruthy();
  });

  it('renders a caller-supplied label', () => {
    render(<LivePill label="อัปเดตอยู่ · ตรวจงานใหม่ทุก 15 วินาที" testID="pill" />);
    expect(screen.getByText('อัปเดตอยู่ · ตรวจงานใหม่ทุก 15 วินาที')).toBeTruthy();
  });
});
