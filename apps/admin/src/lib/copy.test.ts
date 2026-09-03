import { ageLabel, escalationLabel } from './copy';

describe('escalationLabel', () => {
  it('translates the escalation ids the pipeline can actually raise', () => {
    expect(escalationLabel('ESC-NORIDER')).toBe('ไม่มีไรเดอร์รับงาน');
    expect(escalationLabel('ESC-UNKNOWN')).toBe('ระบบไม่รู้ว่าต้องทำอะไรต่อ');
  });

  it('renders an unknown id as itself rather than hiding it', () => {
    expect(escalationLabel('ESC-SOMETHING-NEW')).toBe('ESC-SOMETHING-NEW');
  });
});

describe('ageLabel', () => {
  const now = Date.parse('2026-09-03T12:00:00.000Z');

  it('reports an age, never a judgement about whether it is too long', () => {
    expect(ageLabel('2026-09-03T11:59:30.000Z', now)).toBe('30 วินาที');
    expect(ageLabel('2026-09-03T11:46:00.000Z', now)).toBe('14 นาที');
    expect(ageLabel('2026-09-03T09:00:00.000Z', now)).toBe('3 ชั่วโมง');
    expect(ageLabel('2026-09-01T12:00:00.000Z', now)).toBe('2 วัน');
  });

  it('never renders a negative age from a clock skew', () => {
    expect(ageLabel('2026-09-03T12:05:00.000Z', now)).toBe('0 วินาที');
  });
});
