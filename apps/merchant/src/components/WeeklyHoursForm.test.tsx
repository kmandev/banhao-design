import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RestaurantHoursDay } from '@banhao/validation';
import type { MerchantHoursRepository } from '../repositories';
import { WeeklyHoursForm } from './WeeklyHoursForm';

/**
 * M-12 — the weekly schedule form.
 *
 * The single most important group of assertions in this file is the day
 * mapping: **0 = Sunday … 6 = Saturday**. An off-by-one here would open every
 * shop on the wrong day, silently, and would look completely normal on screen.
 * So the mapping is asserted by name, by round trip through a save, and across
 * the whole cycle — not just once.
 *
 * `now` is injected rather than read from the clock, so "today" is pinned and
 * the suite does not pass or fail depending on when it runs.
 */

/** A Wednesday, in Bangkok terms. */
const WEDNESDAY = new Date('2026-08-19T05:00:00Z');

function makeRepository(
  overrides: Partial<MerchantHoursRepository> = {},
  days: RestaurantHoursDay[] = [],
): MerchantHoursRepository {
  return {
    listHours: jest.fn().mockResolvedValue(days),
    saveHours: jest.fn().mockImplementation((_id: string, input: { days: RestaurantHoursDay[] }) =>
      Promise.resolve({
        restaurantId: 'rest-1',
        days: input.days.filter((day) => day.intervals.length > 0),
      }),
    ),
    ...overrides,
  };
}

async function renderForm(repository = makeRepository()) {
  render(<WeeklyHoursForm restaurantId="rest-1" now={WEDNESDAY} repository={repository} />);
  await screen.findByTestId('weekly-hours-form');
  return repository;
}

const openMonday = async () => {
  fireEvent.click(screen.getByTestId('hours-toggle-1'));
  fireEvent.change(screen.getByTestId('hours-opens-1-0'), { target: { value: '08:00' } });
  fireEvent.change(screen.getByTestId('hours-closes-1-0'), { target: { value: '20:00' } });
};

describe('WeeklyHoursForm — the seven days', () => {
  it('renders all seven, always, so a mistakenly-closed day is visible (M12-D02)', async () => {
    await renderForm();

    for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek += 1) {
      expect(screen.getByTestId(`hours-day-${dayOfWeek}`)).toBeInTheDocument();
    }
  });

  /** The load-bearing mapping assertion. 0 is Sunday, 6 is Saturday. */
  it('labels day 0 อาทิตย์ and day 6 เสาร์', async () => {
    await renderForm();

    expect(within(screen.getByTestId('hours-day-0')).getByText(/อาทิตย์/)).toBeInTheDocument();
    expect(within(screen.getByTestId('hours-day-1')).getByText(/จันทร์/)).toBeInTheDocument();
    expect(within(screen.getByTestId('hours-day-6')).getByText(/เสาร์/)).toBeInTheDocument();
  });

  it('renders the days in 0–6 order, with no rotation', async () => {
    await renderForm();

    const legends = screen
      .getAllByRole('group')
      .map((node) => node.querySelector('legend')?.textContent ?? '');

    expect(legends.map((text) => text.replace('วันนี้', ''))).toEqual([
      'อาทิตย์',
      'จันทร์',
      'อังคาร',
      'พุธ',
      'พฤหัสบดี',
      'ศุกร์',
      'เสาร์',
    ]);
  });

  it('loads a stored day into the row it belongs to', async () => {
    // Day 6 is Saturday. If the mapping were shifted, this would land on Friday.
    await renderForm(
      makeRepository({}, [{ dayOfWeek: 6, intervals: [{ opensAt: '07:00', closesAt: '13:00' }] }]),
    );

    expect(screen.getByTestId('hours-opens-6-0')).toHaveValue('07:00');
    expect(screen.getByTestId('hours-toggle-0')).toHaveAttribute('aria-checked', 'false');
  });

  it('marks today from the Bangkok clock, not the device zone', async () => {
    await renderForm();

    // 2026-08-19 is a Wednesday — day 3.
    expect(within(screen.getByTestId('hours-day-3')).getByText('วันนี้')).toBeInTheDocument();
    expect(screen.getByTestId('today-panel')).toHaveTextContent('พุธ');
  });

  it('says วันนี้ร้านปิด when today has no hours', async () => {
    await renderForm();

    expect(screen.getByTestId('today-panel')).toHaveTextContent('วันนี้ร้านปิด');
  });

  it('does not claim the shop is open — only what the customer sees', async () => {
    await renderForm();

    // Whether the shop is open right now also depends on restaurants.status
    // and temporary close, neither of which this screen can see (M12-D09).
    expect(screen.getByTestId('today-panel')).toHaveTextContent('ลูกค้าเห็นเวลานี้ในหน้าร้านของคุณ');
  });
});

describe('WeeklyHoursForm — open, closed and split shifts', () => {
  it('treats a day with no rows as closed', async () => {
    await renderForm();

    expect(screen.getByTestId('hours-toggle-0')).toHaveAttribute('aria-checked', 'false');
    expect(within(screen.getByTestId('hours-day-0')).getByText('ปิดทั้งวัน')).toBeInTheDocument();
  });

  it('opens a day with one empty interval and no invented default (M12-D05)', async () => {
    await renderForm();

    fireEvent.click(screen.getByTestId('hours-toggle-1'));

    expect(screen.getByTestId('hours-opens-1-0')).toHaveValue('');
    expect(screen.getByTestId('hours-closes-1-0')).toHaveValue('');
  });

  it('keeps a day’s times when it is switched off and on again (M12-D04)', async () => {
    await renderForm(
      makeRepository({}, [{ dayOfWeek: 1, intervals: [{ opensAt: '08:00', closesAt: '20:00' }] }]),
    );

    fireEvent.click(screen.getByTestId('hours-toggle-1'));
    expect(screen.queryByTestId('hours-opens-1-0')).toBeNull();

    fireEvent.click(screen.getByTestId('hours-toggle-1'));
    // Not retyped — a merchant who toggled by accident gets their work back.
    expect(screen.getByTestId('hours-opens-1-0')).toHaveValue('08:00');
  });

  it('adds a second interval for a split shift', async () => {
    await renderForm(
      makeRepository({}, [{ dayOfWeek: 6, intervals: [{ opensAt: '07:00', closesAt: '13:00' }] }]),
    );

    fireEvent.click(screen.getByTestId('hours-add-6'));

    expect(screen.getByTestId('hours-opens-6-1')).toBeInTheDocument();
    expect(within(screen.getByTestId('hours-day-6')).getByText('ช่วงที่ 2')).toBeInTheDocument();
  });

  it('switches a day to closed when its last interval is removed', async () => {
    await renderForm(
      makeRepository({}, [{ dayOfWeek: 1, intervals: [{ opensAt: '08:00', closesAt: '20:00' }] }]),
    );

    fireEvent.click(screen.getByTestId('hours-remove-1-0'));

    expect(screen.getByTestId('hours-toggle-1')).toHaveAttribute('aria-checked', 'false');
  });

  it('copies one day to the other six, in the form only', async () => {
    const repository = await renderForm(
      makeRepository({}, [{ dayOfWeek: 1, intervals: [{ opensAt: '08:00', closesAt: '20:00' }] }]),
    );

    fireEvent.click(screen.getByTestId('hours-copy-1'));

    expect(screen.getByTestId('hours-opens-0-0')).toHaveValue('08:00');
    expect(screen.getByTestId('hours-opens-6-0')).toHaveValue('08:00');
    // Nothing is written until save.
    expect(repository.saveHours).not.toHaveBeenCalled();
  });
});

describe('WeeklyHoursForm — validation (M-12 §04)', () => {
  const setMonday = (opensAt: string, closesAt: string) => {
    fireEvent.click(screen.getByTestId('hours-toggle-1'));
    fireEvent.change(screen.getByTestId('hours-opens-1-0'), { target: { value: opensAt } });
    fireEvent.change(screen.getByTestId('hours-closes-1-0'), { target: { value: closesAt } });
  };

  it('reports a missing time', async () => {
    await renderForm();
    setMonday('08:00', '');

    expect(await screen.findByText('กรอกเวลาเปิดและเวลาปิด')).toBeInTheDocument();
  });

  it('reports equal times as a zero-length interval', async () => {
    await renderForm();
    setMonday('08:00', '08:00');

    expect(await screen.findByText('เวลาเปิดและเวลาปิดต้องไม่ตรงกัน')).toBeInTheDocument();
  });

  /**
   * M12-D06: the message names the limitation instead of blaming the entry.
   * A shop that genuinely trades 18:00–02:00 has not made a mistake.
   */
  it('names overnight trading as unsupported rather than as an error', async () => {
    await renderForm();
    setMonday('18:00', '02:00');

    expect(await screen.findByText('ยังไม่รองรับร้านที่ปิดหลังเที่ยงคืน')).toBeInTheDocument();
  });

  it('reports overlapping intervals on one day', async () => {
    await renderForm();
    setMonday('08:00', '14:00');
    fireEvent.click(screen.getByTestId('hours-add-1'));
    fireEvent.change(screen.getByTestId('hours-opens-1-1'), { target: { value: '12:00' } });
    fireEvent.change(screen.getByTestId('hours-closes-1-1'), { target: { value: '20:00' } });

    expect(await screen.findByText('ช่วงเวลาซ้อนกัน · ตรวจสอบอีกครั้ง')).toBeInTheDocument();
  });

  it('reports an exact duplicate as a duplicate, not an overlap', async () => {
    await renderForm();
    setMonday('08:00', '20:00');
    fireEvent.click(screen.getByTestId('hours-add-1'));
    fireEvent.change(screen.getByTestId('hours-opens-1-1'), { target: { value: '08:00' } });
    fireEvent.change(screen.getByTestId('hours-closes-1-1'), { target: { value: '20:00' } });

    expect(await screen.findByText('ช่วงเวลานี้ซ้ำกับช่วงก่อนหน้า')).toBeInTheDocument();
  });

  it('accepts touching intervals — a continuous day in two parts', async () => {
    await renderForm();
    setMonday('07:00', '13:00');
    fireEvent.click(screen.getByTestId('hours-add-1'));
    fireEvent.change(screen.getByTestId('hours-opens-1-1'), { target: { value: '13:00' } });
    fireEvent.change(screen.getByTestId('hours-closes-1-1'), { target: { value: '20:00' } });

    expect(screen.queryByTestId('hours-invalid-count')).toBeNull();
  });

  it('associates the message with both time inputs of the offending interval', async () => {
    await renderForm();
    setMonday('18:00', '02:00');

    await waitFor(() =>
      expect(screen.getByTestId('hours-opens-1-0')).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(screen.getByTestId('hours-opens-1-0')).toHaveAttribute('aria-describedby');
    expect(screen.getByTestId('hours-closes-1-0')).toHaveAttribute('aria-describedby');
  });

  it('counts the invalid intervals in the footer', async () => {
    await renderForm();
    setMonday('18:00', '02:00');

    expect(await screen.findByTestId('hours-invalid-count')).toHaveTextContent(
      'มี 1 ช่วงเวลาที่ยังไม่ถูกต้อง',
    );
  });

  it('sends no request while the form is invalid', async () => {
    const repository = await renderForm();
    setMonday('18:00', '02:00');

    fireEvent.click(screen.getByTestId('hours-save'));

    await waitFor(() => expect(screen.getByTestId('hours-save')).toHaveAttribute('aria-disabled', 'true'));
    expect(repository.saveHours).not.toHaveBeenCalled();
  });

  it('does not validate a closed day’s leftover times', async () => {
    await renderForm();
    setMonday('18:00', '02:00');
    expect(await screen.findByTestId('hours-invalid-count')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('hours-toggle-1'));

    // A closed day contributes no rows, so it cannot be wrong.
    await waitFor(() => expect(screen.queryByTestId('hours-invalid-count')).toBeNull());
  });
});

describe('WeeklyHoursForm — saving', () => {
  it('keeps save inert until something changed', async () => {
    await renderForm();

    expect(screen.getByTestId('hours-save')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('hours-announcement')).toHaveTextContent('ยังไม่มีการเปลี่ยนแปลง');
  });

  it('sends the whole week in one request, with the correct day numbers', async () => {
    const repository = await renderForm();
    await openMonday();
    fireEvent.click(screen.getByTestId('hours-save'));

    await waitFor(() => expect(repository.saveHours).toHaveBeenCalledTimes(1));
    expect(repository.saveHours).toHaveBeenCalledWith('rest-1', {
      days: [
        { dayOfWeek: 0, intervals: [] },
        { dayOfWeek: 1, intervals: [{ opensAt: '08:00', closesAt: '20:00' }] },
        { dayOfWeek: 2, intervals: [] },
        { dayOfWeek: 3, intervals: [] },
        { dayOfWeek: 4, intervals: [] },
        { dayOfWeek: 5, intervals: [] },
        { dayOfWeek: 6, intervals: [] },
      ],
    });
  });

  it('round-trips Saturday as day 6, not day 5', async () => {
    // The save-and-reload path is where a mapping bug would hide: the form
    // could render correctly and still write the wrong number.
    const repository = await renderForm();

    fireEvent.click(screen.getByTestId('hours-toggle-6'));
    fireEvent.change(screen.getByTestId('hours-opens-6-0'), { target: { value: '07:00' } });
    fireEvent.change(screen.getByTestId('hours-closes-6-0'), { target: { value: '13:00' } });
    fireEvent.click(screen.getByTestId('hours-save'));

    await waitFor(() => expect(repository.saveHours).toHaveBeenCalled());
    const sent = (repository.saveHours as jest.Mock).mock.calls[0][1] as {
      days: { dayOfWeek: number; intervals: unknown[] }[];
    };
    expect(sent.days.find((day) => day.intervals.length > 0)?.dayOfWeek).toBe(6);

    // And the reloaded week lands back on Saturday.
    await waitFor(() => expect(screen.getByTestId('hours-opens-6-0')).toHaveValue('07:00'));
  });

  it('reports success and leaves the form clean', async () => {
    await renderForm();
    await openMonday();
    fireEvent.click(screen.getByTestId('hours-save'));

    expect(await screen.findByTestId('hours-saved')).toHaveTextContent('บันทึกเวลาทำการแล้ว');
    await waitFor(() => expect(screen.getByTestId('hours-save')).toHaveAttribute('aria-disabled', 'true'));
  });

  /** M12-D08: the copy must be true in every outcome, including zero rows. */
  it('does not claim the previous week survived a failure', async () => {
    const saveHours = jest.fn().mockRejectedValue(new Error('offline'));
    await renderForm(makeRepository({ saveHours }));
    await openMonday();
    fireEvent.click(screen.getByTestId('hours-save'));

    const error = await screen.findByTestId('hours-save-error');
    expect(error).toHaveTextContent('บันทึกไม่สำเร็จ');
    expect(error).toHaveTextContent('ตรวจสอบเวลาทำการแล้วลองอีกครั้ง');
    expect(error.textContent).not.toContain('เวลาเดิม');
  });

  it('reverts every field on cancel, behind the discard guard', async () => {
    await renderForm(
      makeRepository({}, [{ dayOfWeek: 1, intervals: [{ opensAt: '08:00', closesAt: '20:00' }] }]),
    );

    fireEvent.change(screen.getByTestId('hours-opens-1-0'), { target: { value: '09:00' } });
    fireEvent.click(screen.getByTestId('hours-cancel'));
    fireEvent.click(await screen.findByTestId('hours-discard-dialog-confirm'));

    await waitFor(() => expect(screen.getByTestId('hours-opens-1-0')).toHaveValue('08:00'));
  });

  it('states that saving replaces the whole week', async () => {
    await renderForm();

    expect(screen.getByText('การบันทึกจะแทนที่เวลาทำการทั้งสัปดาห์')).toBeInTheDocument();
  });

  it('shows the empty state when no day has hours', async () => {
    await renderForm();

    expect(screen.getByTestId('hours-empty')).toHaveTextContent('ยังไม่ได้ตั้งเวลาทำการ');
    expect(screen.getByTestId('hours-empty')).toHaveTextContent('ลูกค้าจะเห็นว่าร้านปิด');
  });
});

describe('WeeklyHoursForm — accessibility', () => {
  it('gives every day a fieldset and a legend naming it', async () => {
    await renderForm();

    const groups = screen.getAllByRole('group');
    expect(groups).toHaveLength(7);
    expect(groups[0]?.tagName).toBe('FIELDSET');
  });

  it('exposes the day toggle as a switch with an accessible name', async () => {
    await renderForm();

    expect(screen.getByRole('switch', { name: 'เปิดร้านวันจันทร์' })).toBeInTheDocument();
  });

  it('announces a day being closed through a live region', async () => {
    await renderForm(
      makeRepository({}, [{ dayOfWeek: 1, intervals: [{ opensAt: '08:00', closesAt: '20:00' }] }]),
    );

    fireEvent.click(screen.getByTestId('hours-toggle-1'));

    expect(screen.getByTestId('hours-announcement')).toHaveTextContent('จันทร์: ปิด');
  });

  it('names the add and remove buttons per day and interval', async () => {
    await renderForm(
      makeRepository({}, [{ dayOfWeek: 6, intervals: [{ opensAt: '07:00', closesAt: '13:00' }] }]),
    );

    expect(screen.getByLabelText('เพิ่มช่วงเวลาวันเสาร์')).toBeInTheDocument();
    expect(screen.getByLabelText('ลบช่วงที่ 1 วันเสาร์')).toBeInTheDocument();
  });

  it('states the timezone once, not beside every field', async () => {
    await renderForm();

    expect(screen.getAllByText('เวลาประเทศไทย · แสดงแบบ 24 ชั่วโมง')).toHaveLength(1);
  });

  it('keeps the save button focusable while inert', async () => {
    await renderForm();

    expect(screen.getByTestId('hours-save')).not.toBeDisabled();
  });
});
