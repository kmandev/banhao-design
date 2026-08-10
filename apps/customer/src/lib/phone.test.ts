import { formatThaiPhone } from './phone';

/**
 * DEF-05. Presentation only — the canonical E.164 identity is never rewritten.
 * The Customer design writes Thai mobile numbers as `081 234 5678`.
 */
describe('formatThaiPhone', () => {
  it('formats the stored E.164 form', () => {
    expect(formatThaiPhone('+66812345678')).toBe('081 234 5678');
  });

  it('formats the same digits without the plus', () => {
    expect(formatThaiPhone('66812345678')).toBe('081 234 5678');
  });

  it('formats a national number that is already local', () => {
    expect(formatThaiPhone('0812345678')).toBe('081 234 5678');
  });

  it('ignores separators already present', () => {
    expect(formatThaiPhone('+66 81-234-5678')).toBe('081 234 5678');
  });

  it('returns an empty string for a missing number', () => {
    expect(formatThaiPhone(null)).toBe('');
    expect(formatThaiPhone(undefined)).toBe('');
    expect(formatThaiPhone('')).toBe('');
  });

  it('returns anything unrecognised unchanged rather than inventing a format', () => {
    expect(formatThaiPhone('+1 415 555 0100')).toBe('+1 415 555 0100');
    expect(formatThaiPhone('12345')).toBe('12345');
  });

  it('does not mutate its input', () => {
    const stored = '+66812345678';
    formatThaiPhone(stored);
    expect(stored).toBe('+66812345678');
  });
});
