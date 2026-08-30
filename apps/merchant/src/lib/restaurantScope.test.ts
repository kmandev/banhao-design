import {
  getStoredRestaurantId,
  setStoredRestaurantId,
  clearStoredRestaurantId,
  markSessionExpired,
  consumeSessionExpired,
} from './restaurantScope';

describe('restaurant scope storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('returns null when nothing is stored', () => {
    expect(getStoredRestaurantId()).toBeNull();
  });

  it('round-trips a stored restaurant id', () => {
    setStoredRestaurantId('rest-1');
    expect(getStoredRestaurantId()).toBe('rest-1');
  });

  it('clears a stored restaurant id', () => {
    setStoredRestaurantId('rest-1');
    clearStoredRestaurantId();
    expect(getStoredRestaurantId()).toBeNull();
  });
});

describe('session-expired flag', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('is false when never marked', () => {
    expect(consumeSessionExpired()).toBe(false);
  });

  it('is true exactly once after being marked — reading it consumes it', () => {
    markSessionExpired();
    expect(consumeSessionExpired()).toBe(true);
    expect(consumeSessionExpired()).toBe(false);
  });
});
