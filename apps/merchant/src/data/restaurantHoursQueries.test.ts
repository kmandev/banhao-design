import { groupHoursByDay } from './restaurantHoursQueries';

describe('groupHoursByDay', () => {
  it('trims the seconds a time column renders', () => {
    expect(groupHoursByDay([{ day_of_week: 1, opens_at: '08:00:00', closes_at: '20:00:00' }])).toEqual([
      { dayOfWeek: 1, intervals: [{ opensAt: '08:00', closesAt: '20:00' }] },
    ]);
  });

  it('keeps both intervals of a split shift, ordered by opening time', () => {
    expect(
      groupHoursByDay([
        { day_of_week: 6, opens_at: '16:00:00', closes_at: '20:00:00' },
        { day_of_week: 6, opens_at: '07:00:00', closes_at: '13:00:00' },
      ]),
    ).toEqual([
      {
        dayOfWeek: 6,
        intervals: [
          { opensAt: '07:00', closesAt: '13:00' },
          { opensAt: '16:00', closesAt: '20:00' },
        ],
      },
    ]);
  });

  it('orders days ascending from 0', () => {
    expect(
      groupHoursByDay([
        { day_of_week: 6, opens_at: '07:00:00', closes_at: '13:00:00' },
        { day_of_week: 0, opens_at: '09:00:00', closes_at: '12:00:00' },
      ]).map((day) => day.dayOfWeek),
    ).toEqual([0, 6]);
  });

  it('omits a day with no rows — the absence is the closed state', () => {
    expect(groupHoursByDay([{ day_of_week: 3, opens_at: '08:00:00', closes_at: '20:00:00' }])).toHaveLength(1);
  });
});
