import { fireEvent, render, screen } from '@testing-library/react-native';
import { StatusScreen, statusStripVariant } from './StatusScreen';
import type { RiderStatus } from '../domain/riderProfile';

/**
 * T2.2 — StatusScreen's redesign onto `StateCard`. No test file existed for
 * this screen before T2.2; this is new coverage, not a migration of
 * existing assertions.
 *
 * The one property this suite protects, same as before the redesign:
 * DEC-UX-006 — no toggle, no availability control, ever, on this screen.
 */
describe('statusStripVariant', () => {
  it.each<RiderStatus>(['REGISTERED', 'DOCUMENTS_SUBMITTED', 'PENDING_APPROVAL'])(
    '%s maps to pending',
    (status) => {
      expect(statusStripVariant(status)).toBe('pending');
    },
  );

  it.each<RiderStatus>(['DOCUMENTS_REJECTED', 'SUSPENDED', 'DEACTIVATED'])('%s maps to blocked', (status) => {
    expect(statusStripVariant(status)).toBe('blocked');
  });

  it('null (no rider record) maps to blocked', () => {
    expect(statusStripVariant(null)).toBe('blocked');
  });
});

describe('StatusScreen', () => {
  it('renders the pending variant with its headline and detail', () => {
    render(<StatusScreen status="PENDING_APPROVAL" fullName="สมชาย ใจดี" onSignOut={jest.fn()} />);

    expect(screen.getByTestId('screen-status')).toBeTruthy();
    expect(screen.getByText('รอตรวจสอบ')).toBeTruthy();
    expect(screen.getByText('อยู่ระหว่างรอการอนุมัติ ยังรับงานไม่ได้')).toBeTruthy();
  });

  it('renders the blocked variant for a suspended rider', () => {
    render(<StatusScreen status="SUSPENDED" fullName="สมชาย ใจดี" onSignOut={jest.fn()} />);

    expect(screen.getByText('ยังรับงานไม่ได้')).toBeTruthy();
    expect(screen.getByText('บัญชีถูกระงับชั่วคราว ยังรับงานไม่ได้')).toBeTruthy();
  });

  it('renders the no-rider-record copy when status is null', () => {
    render(<StatusScreen status={null} fullName={null} onSignOut={jest.fn()} />);
    expect(screen.getByText('บัญชีนี้ยังไม่ได้ลงทะเบียนเป็นไรเดอร์')).toBeTruthy();
  });

  it('never renders an action inside the state card — DEC-UX-006', () => {
    render(<StatusScreen status="PENDING_APPROVAL" fullName={null} onSignOut={jest.fn()} />);
    expect(screen.queryByTestId('rider-status-card-action')).toBeNull();
  });

  it('offers only sign-out', () => {
    const onSignOut = jest.fn();
    render(<StatusScreen status="SUSPENDED" fullName={null} onSignOut={onSignOut} />);

    fireEvent.press(screen.getByTestId('button-sign-out'));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
