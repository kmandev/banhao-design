import {
  ACCEPT_WINDOW_SECONDS,
  ACTIVE_DELIVERY_STATES,
  DISPATCHABLE_DELIVERY_STATES,
  ROUND_INTERVAL_SECONDS,
  offerExpiryFor,
  roundNumberFor,
} from './dispatch-policy';

/**
 * DEC-037's four locked values, asserted as values.
 *
 * These tests exist so that changing a number silently is impossible: any edit
 * to the policy has to edit an assertion that names the decision it comes from,
 * which is the point at which someone notices they are changing DEC-037 rather
 * than tuning a constant.
 */
describe('dispatch policy — DEC-037', () => {
  it("the rider accept window is 60 seconds — BQ-020, and neither of the design's contradictory figures", () => {
    expect(ACCEPT_WINDOW_SECONDS).toBe(60);
    expect(ACCEPT_WINDOW_SECONDS).not.toBe(12);
    expect(ACCEPT_WINDOW_SECONDS).not.toBe(20);
  });

  it('the round interval is 60 seconds, matching the one-minute tick DEC-APP-010 fixes', () => {
    expect(ROUND_INTERVAL_SECONDS).toBe(60);
    expect(ROUND_INTERVAL_SECONDS).not.toBe(30);
  });

  it('expires_at is exactly offered_at + 60 seconds', () => {
    const offeredAt = new Date('2026-08-24T10:00:00.000Z');

    expect(offerExpiryFor(offeredAt)).toBe('2026-08-24T10:01:00.000Z');
    expect(Date.parse(offerExpiryFor(offeredAt)) - offeredAt.getTime()).toBe(60_000);
  });

  it('dispatch covers both searching states — DEC-021 sends a reassigned delivery back to broadcast', () => {
    expect([...DISPATCHABLE_DELIVERY_STATES]).toEqual(['RIDER_SEARCHING', 'RIDER_REASSIGNING']);
  });

  it("the active-delivery set is the schema's rider-engaged states, and excludes terminal and unassigned ones", () => {
    const active: string[] = [...ACTIVE_DELIVERY_STATES];

    expect(active).toEqual([
      'RIDER_ASSIGNED',
      'RIDER_REASSIGNING',
      'AT_MERCHANT',
      'PICKED_UP',
      'EN_ROUTE',
    ]);
    // Terminal states never hold a rider's slot, or a rider could never work again.
    expect(active).not.toContain('DELIVERED');
    expect(active).not.toContain('FAILED');
    expect(active).not.toContain('ABANDONED');
    // These two have no rider at all.
    expect(active).not.toContain('UNASSIGNED');
    expect(active).not.toContain('RIDER_SEARCHING');
  });
});

describe('roundNumberFor — deterministic, clock-derived round numbering', () => {
  const createdAt = '2026-08-24T10:00:00.000Z';

  it('two ticks inside the same 60-second window compute the SAME round, so the unique constraint absorbs the second', () => {
    const first = roundNumberFor(createdAt, new Date('2026-08-24T10:00:05.000Z'));
    const second = roundNumberFor(createdAt, new Date('2026-08-24T10:00:55.000Z'));

    expect(first).toBe(second);
    expect(first).toBe(1);
  });

  it('each following minute is the next round', () => {
    expect(roundNumberFor(createdAt, new Date('2026-08-24T10:01:00.000Z'))).toBe(2);
    expect(roundNumberFor(createdAt, new Date('2026-08-24T10:02:30.000Z'))).toBe(3);
    expect(roundNumberFor(createdAt, new Date('2026-08-24T10:09:59.000Z'))).toBe(10);
  });

  it('never returns a value the round_no > 0 CHECK would reject, even under clock skew', () => {
    expect(roundNumberFor(createdAt, new Date('2026-08-24T09:59:00.000Z'))).toBe(1);
    expect(roundNumberFor('not-a-date', new Date('2026-08-24T10:00:00.000Z'))).toBe(1);
  });
});
