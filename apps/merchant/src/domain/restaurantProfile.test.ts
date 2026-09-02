import {
  fromSaveResponse,
  hasBlockingIssue,
  isPlausibleThaiPhone,
  toDraft,
  toRequest,
  validateProfileDraft,
} from './restaurantProfile';

describe('toDraft', () => {
  it('maps null optional fields to empty strings', () => {
    expect(
      toDraft({ name: 'ร้านตามสั่งป้าสมร', description: null, phone: null, addressLine: null }),
    ).toEqual({ name: 'ร้านตามสั่งป้าสมร', description: '', phone: '', addressLine: '' });
  });

  it('reads addressLine from a snake_case Supabase row (address_line)', () => {
    expect(
      toDraft({
        name: 'ร้านตามสั่งป้าสมร',
        description: null,
        phone: null,
        address_line: '123 ถ.สถลมาร์ค',
      }),
    ).toEqual({ name: 'ร้านตามสั่งป้าสมร', description: '', phone: '', addressLine: '123 ถ.สถลมาร์ค' });
  });
});

describe('toRequest', () => {
  it('trims every field', () => {
    expect(
      toRequest({ name: '  ร้าน  ', description: ' คำอธิบาย ', phone: ' 081 ', addressLine: ' ที่อยู่ ' }),
    ).toEqual({ name: 'ร้าน', description: 'คำอธิบาย', phone: '081', addressLine: 'ที่อยู่' });
  });
});

describe('fromSaveResponse', () => {
  it('is the same mapping as toDraft, for the API response shape', () => {
    expect(
      fromSaveResponse({
        restaurantId: 'rest-1',
        name: 'ร้าน',
        description: null,
        phone: null,
        addressLine: null,
        updatedAt: '2026-09-02T00:00:00.000Z',
      }),
    ).toEqual({ name: 'ร้าน', description: '', phone: '', addressLine: '' });
  });
});

describe('isPlausibleThaiPhone', () => {
  it.each(['0812345678', '081-234-5678', '021234567'])('accepts %s', (phone) => {
    expect(isPlausibleThaiPhone(phone)).toBe(true);
  });

  it.each(['abc', '12', '081-234-56789012', '081 234 5678'])('rejects %s', (phone) => {
    expect(isPlausibleThaiPhone(phone)).toBe(false);
  });
});

describe('validateProfileDraft', () => {
  const BASE = { name: 'ร้าน', description: '', phone: '', addressLine: 'ที่อยู่' };

  it('flags an empty name as required', () => {
    expect(validateProfileDraft({ ...BASE, name: '  ' }).nameRequired).toBe(true);
  });

  it('does not flag phone when empty — phone is optional', () => {
    expect(validateProfileDraft({ ...BASE, phone: '' }).phoneInvalid).toBe(false);
  });

  it('flags an implausible non-empty phone', () => {
    expect(validateProfileDraft({ ...BASE, phone: 'not-a-phone' }).phoneInvalid).toBe(true);
  });

  it('does not flag a plausible phone', () => {
    expect(validateProfileDraft({ ...BASE, phone: '081-234-5678' }).phoneInvalid).toBe(false);
  });

  it('flags an empty address as advisory only', () => {
    const issues = validateProfileDraft({ ...BASE, addressLine: '' });
    expect(issues.addressAdvisory).toBe(true);
    expect(hasBlockingIssue(issues)).toBe(false);
  });

  it('name required and invalid phone both block save', () => {
    expect(hasBlockingIssue(validateProfileDraft({ ...BASE, name: '' }))).toBe(true);
    expect(hasBlockingIssue(validateProfileDraft({ ...BASE, phone: 'bad' }))).toBe(true);
  });

  it('a fully valid draft has no blocking issue', () => {
    expect(hasBlockingIssue(validateProfileDraft(BASE))).toBe(false);
  });
});
