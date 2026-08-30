import { render, screen } from '@testing-library/react-native';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders the icon, headline and detail', () => {
    render(<EmptyState icon="📭" headline="ยังไม่มีงาน" detail="เมื่อมีงานใหม่เข้ามา ระบบจะแสดงที่หน้านี้ทันที" />);

    expect(screen.getByText('📭')).toBeTruthy();
    expect(screen.getByText('ยังไม่มีงาน')).toBeTruthy();
    expect(screen.getByText('เมื่อมีงานใหม่เข้ามา ระบบจะแสดงที่หน้านี้ทันที')).toBeTruthy();
  });

  it('omits the detail line when none is given', () => {
    render(<EmptyState icon="📭" headline="ยังไม่มีงาน" testID="empty" />);
    expect(screen.getByTestId('empty')).toBeTruthy();
  });
});
