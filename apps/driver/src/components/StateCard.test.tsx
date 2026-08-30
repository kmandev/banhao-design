import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { StateCard } from './StateCard';

describe('StateCard', () => {
  it('renders the headline, detail and meta', () => {
    render(
      <StateCard variant="online" headline="กำลังรับงาน" detail="ระบบจะส่งงานใหม่มาให้" meta="ตำแหน่งล่าสุด 05:00" />,
    );

    expect(screen.getByText('กำลังรับงาน')).toBeTruthy();
    expect(screen.getByText('ระบบจะส่งงานใหม่มาให้')).toBeTruthy();
    expect(screen.getByText('ตำแหน่งล่าสุด 05:00')).toBeTruthy();
  });

  it('omits the meta line when none is given', () => {
    render(<StateCard variant="offline" headline="ปิดรับงาน" detail="ยังไม่ได้เปิดรับงาน" testID="state-card" />);
    expect(screen.queryByTestId('state-card-meta')).toBeNull();
  });

  it.each(['online', 'offline'] as const)('renders the action for %s', (variant) => {
    render(
      <StateCard
        variant={variant}
        headline="h"
        detail="d"
        action={<Text>toggle</Text>}
        testID="state-card"
      />,
    );

    expect(screen.getByTestId('state-card-action')).toBeTruthy();
    expect(screen.getByText('toggle')).toBeTruthy();
  });

  it.each(['pending', 'blocked'] as const)(
    'never renders an action for %s, even if the caller passes one — DEC-UX-006',
    (variant) => {
      render(
        <StateCard
          variant={variant}
          headline="h"
          detail="d"
          action={<Text>toggle</Text>}
          testID="state-card"
        />,
      );

      expect(screen.queryByTestId('state-card-action')).toBeNull();
      expect(screen.queryByText('toggle')).toBeNull();
    },
  );

  it('uses the default testID when none is given', () => {
    render(<StateCard variant="online" headline="h" detail="d" />);
    expect(screen.getByTestId('state-card')).toBeTruthy();
  });

  it.each(['online', 'offline'] as const)('renders a status dot for %s', (variant) => {
    render(<StateCard variant={variant} headline="h" detail="d" testID="state-card" />);
    expect(screen.getByTestId('state-card-dot')).toBeTruthy();
  });

  it.each(['pending', 'blocked'] as const)('renders no status dot for %s', (variant) => {
    render(<StateCard variant={variant} headline="h" detail="d" testID="state-card" />);
    expect(screen.queryByTestId('state-card-dot')).toBeNull();
  });
});
