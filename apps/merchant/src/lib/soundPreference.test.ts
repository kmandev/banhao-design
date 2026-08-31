import { getSoundPreference, setSoundPreference } from './soundPreference';

describe('sound preference storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to enabled when nothing is stored', () => {
    expect(getSoundPreference()).toBe(true);
  });

  it('persists a disabled preference', () => {
    setSoundPreference(false);
    expect(getSoundPreference()).toBe(false);
  });

  it('persists a re-enabled preference', () => {
    setSoundPreference(false);
    setSoundPreference(true);
    expect(getSoundPreference()).toBe(true);
  });

  it('survives being read multiple times (a stand-in for surviving a reload)', () => {
    setSoundPreference(false);
    expect(getSoundPreference()).toBe(false);
    expect(getSoundPreference()).toBe(false);
  });

  it('is SSR-safe: reading when storage throws behaves as if nothing is stored', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(getSoundPreference()).toBe(true);
    spy.mockRestore();
  });

  it('does not throw when localStorage.setItem is unavailable', () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(() => setSoundPreference(false)).not.toThrow();
    spy.mockRestore();
  });
});
