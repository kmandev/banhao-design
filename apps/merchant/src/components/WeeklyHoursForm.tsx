'use client';

import { useMemo, useState } from 'react';
import { colors, spacing } from '@banhao/ui/theme';
import { useRestaurantHours } from '../hooks/useRestaurantHours';
import { HOURS_VALIDATION_MESSAGES, THAI_DAY_NAMES, hoursCopy } from '../lib/menuCopy';
import { bangkokDayOfWeek } from '../lib/menuDisplay';
import { repositories, type MerchantHoursRepository } from '../repositories';
import { ConfirmDialog } from './ConfirmDialog';
import { ErrorState } from './ErrorState';
import { Spinner } from './Spinner';
import * as m from '../lib/menuStyles';

/**
 * M-12 — the weekly schedule.
 *
 * All seven days are always rendered (M12-D02): a merchant reads this screen
 * to verify a week, and showing only the days that have rows would make a
 * mistakenly-closed Sunday invisible — exactly the error this screen exists to
 * catch.
 *
 * Each day is a `<fieldset>` with a `<legend>` carrying its Thai name, so a
 * screen reader announces which day a field belongs to. A second interval
 * announces itself as `ช่วงที่ 2` rather than repeating the same label.
 *
 * ## Times
 *
 * Native `<input type="time">`, keyboard-typable, no custom dropdown that
 * traps focus. The timezone is stated once in the header and never per field:
 * repeating it beside fourteen inputs would suggest a conversion is happening,
 * and none is (M12-D07).
 */
export function WeeklyHoursForm({
  restaurantId,
  /** Injectable so a test can pin "today" rather than depend on when it runs. */
  now = new Date(),
  repository = repositories.merchantHours,
}: {
  restaurantId: string;
  now?: Date;
  repository?: MerchantHoursRepository;
}) {
  const hours = useRestaurantHours(restaurantId, repository);
  const [discarding, setDiscarding] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const today = useMemo(() => bangkokDayOfWeek(now), [now]);

  const issuesByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const issue of hours.issues) {
      map.set(`${issue.dayOfWeek}-${issue.intervalIndex}`, HOURS_VALIDATION_MESSAGES[issue.code]);
    }
    return map;
  }, [hours.issues]);

  if (hours.state.status === 'loading') {
    return <Spinner label={hoursCopy.loading} />;
  }

  if (hours.state.status === 'error') {
    return hours.state.forbidden ? (
      <ErrorState title={hoursCopy.saveForbidden} />
    ) : (
      <ErrorState
        title={hoursCopy.loadFailed}
        retryLabel={hoursCopy.retry}
        onRetry={hours.reload}
      />
    );
  }

  const saving = hours.saveState.status === 'saving';
  const invalid = hours.issues.length > 0;
  const empty = hours.draft.every((day) => !day.isOpen);
  const todayDay = hours.draft.find((day) => day.dayOfWeek === today);

  return (
    <div style={m.contentPage} data-testid="weekly-hours-form">
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.textPrimary, margin: 0 }}>
          {hoursCopy.pageTitle}
        </h1>
        {/* Stated once, not per field — no conversion is happening. */}
        <p style={{ ...m.fieldHint, marginTop: 4 }}>{hoursCopy.timezoneNote}</p>
      </div>

      <div style={m.panel} data-testid="today-panel">
        <strong style={{ fontSize: 14, color: colors.textPrimary }}>
          {hoursCopy.today} · {THAI_DAY_NAMES[today]}
        </strong>
        <p style={{ ...m.fieldHint, marginTop: 4 }}>
          {todayDay?.isOpen && todayDay.intervals.length > 0
            ? todayDay.intervals.map((interval) => `${interval.opensAt}–${interval.closesAt}`).join(' · ')
            : hoursCopy.todayClosed}
        </p>
        {/* Not "you are open": whether the shop is open right now also depends
            on restaurants.status and temporary close, neither of which this
            screen can see or set (M12-D09). */}
        <p style={{ ...m.fieldHint, marginTop: 4 }}>{hoursCopy.customerSeesThis}</p>
      </div>

      {empty ? (
        <div style={{ ...m.panel }} data-testid="hours-empty">
          <h2 style={{ fontSize: 16, color: colors.textPrimary, margin: 0 }}>{hoursCopy.emptyTitle}</h2>
          <p style={{ ...m.fieldHint, marginTop: spacing.sm }}>{hoursCopy.emptyBody}</p>
        </div>
      ) : null}

      {hours.draft.map((day) => {
        const dayName = THAI_DAY_NAMES[day.dayOfWeek];
        const isToday = day.dayOfWeek === today;

        return (
          <fieldset
            key={day.dayOfWeek}
            style={{
              ...m.panel,
              display: 'flex',
              flexDirection: 'column',
              gap: spacing.sm,
              backgroundColor: day.isOpen ? colors.surfaceRaised : colors.surface,
            }}
            data-testid={`hours-day-${day.dayOfWeek}`}
          >
            <legend style={{ ...m.fieldLabel, fontSize: 15 }}>
              {dayName}
              {isToday ? <span style={m.badge}>{hoursCopy.today}</span> : null}
            </legend>

            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' }}>
              <button
                type="button"
                role="switch"
                aria-checked={day.isOpen}
                aria-label={hoursCopy.dayToggleLabel(dayName)}
                onClick={() => {
                  hours.setDayOpen(day.dayOfWeek, !day.isOpen);
                  setAnnouncement(hoursCopy.dayAnnouncement(dayName, !day.isOpen));
                }}
                style={m.switchHitArea}
                data-testid={`hours-toggle-${day.dayOfWeek}`}
              >
                <span style={m.switchTrack(day.isOpen, false)} aria-hidden>
                  <span style={m.switchKnob} />
                </span>
              </button>
              {/* The เปิด / ปิด text is always present — colour never carries
                  the state alone. */}
              <span style={{ fontSize: 13, color: day.isOpen ? colors.success : colors.textMuted }}>
                {day.isOpen ? hoursCopy.open : hoursCopy.closed}
              </span>

              {day.isOpen ? (
                <button
                  type="button"
                  style={{ ...m.secondaryButton, minHeight: m.TOUCH_TARGET, marginLeft: 'auto' }}
                  aria-label={hoursCopy.copyToAllLabel}
                  onClick={() => {
                    hours.copyToAllDays(day.dayOfWeek);
                    setAnnouncement(hoursCopy.copiedAnnouncement(6));
                  }}
                  data-testid={`hours-copy-${day.dayOfWeek}`}
                >
                  {hoursCopy.copyToAll}
                </button>
              ) : null}
            </div>

            {!day.isOpen ? (
              <p style={{ ...m.fieldHint, color: colors.textSubtle }}>{hoursCopy.closedAllDay}</p>
            ) : null}

            {day.isOpen
              ? day.intervals.map((interval, index) => {
                  const error = issuesByKey.get(`${day.dayOfWeek}-${index}`);
                  const errorId = `hours-error-${day.dayOfWeek}-${index}`;

                  return (
                    <div
                      key={index}
                      style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      {day.intervals.length > 1 ? (
                        <span style={m.badge}>{hoursCopy.intervalLabel(index)}</span>
                      ) : null}

                      <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 12, color: colors.textMuted }}>{hoursCopy.opensAt}</span>
                        <input
                          type="time"
                          style={{ ...m.textInput, width: 140 }}
                          value={interval.opensAt}
                          aria-label={`${hoursCopy.opensAt} ${dayName} ${hoursCopy.intervalLabel(index)}`}
                          aria-invalid={error ? true : undefined}
                          aria-describedby={error ? errorId : undefined}
                          onChange={(event) =>
                            hours.setInterval(day.dayOfWeek, index, { opensAt: event.target.value })
                          }
                          data-testid={`hours-opens-${day.dayOfWeek}-${index}`}
                        />
                      </label>

                      <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 12, color: colors.textMuted }}>{hoursCopy.closesAt}</span>
                        <input
                          type="time"
                          style={{ ...m.textInput, width: 140 }}
                          value={interval.closesAt}
                          aria-label={`${hoursCopy.closesAt} ${dayName} ${hoursCopy.intervalLabel(index)}`}
                          aria-invalid={error ? true : undefined}
                          aria-describedby={error ? errorId : undefined}
                          onChange={(event) =>
                            hours.setInterval(day.dayOfWeek, index, { closesAt: event.target.value })
                          }
                          data-testid={`hours-closes-${day.dayOfWeek}-${index}`}
                        />
                      </label>

                      <button
                        type="button"
                        style={m.iconButton}
                        aria-label={hoursCopy.removeIntervalLabel(dayName, index)}
                        onClick={() => hours.removeInterval(day.dayOfWeek, index)}
                        data-testid={`hours-remove-${day.dayOfWeek}-${index}`}
                      >
                        ✕
                      </button>

                      {error ? (
                        <p id={errorId} style={{ ...m.fieldError, width: '100%' }} role="alert">
                          {error}
                        </p>
                      ) : null}
                    </div>
                  );
                })
              : null}

            {day.isOpen ? (
              <button
                type="button"
                style={{ ...m.secondaryButton, alignSelf: 'flex-start', minHeight: m.TOUCH_TARGET }}
                aria-label={hoursCopy.addIntervalLabel(dayName)}
                onClick={() => hours.addInterval(day.dayOfWeek)}
                data-testid={`hours-add-${day.dayOfWeek}`}
              >
                + {hoursCopy.addInterval}
              </button>
            ) : null}
          </fieldset>
        );
      })}

      {/* Stated above the button, because it is what the button does. */}
      <p style={m.fieldHint}>{hoursCopy.replaceWarning}</p>

      {hours.saveState.status === 'failed' ? (
        <div role="alert" style={{ ...m.panel, borderColor: colors.danger }} data-testid="hours-save-error">
          <strong style={{ color: colors.danger, fontSize: 14 }}>
            {hours.saveState.forbidden ? hoursCopy.saveForbidden : hoursCopy.saveFailed}
          </strong>
          {/* Deliberately does NOT claim the previous week survived: the write
              is delete-then-insert, so that would not be true in every
              outcome (M12-D08). */}
          {hours.saveState.forbidden ? null : (
            <p style={{ ...m.fieldHint, marginTop: 4 }}>{hoursCopy.saveFailedHint}</p>
          )}
        </div>
      ) : null}

      {hours.saveState.status === 'saved' ? (
        <p style={{ fontSize: 14, color: colors.success }} role="status" data-testid="hours-saved">
          {hoursCopy.saved}
        </p>
      ) : null}

      <div style={{ display: 'flex', gap: spacing.sm }}>
        <button
          type="button"
          style={{ ...m.secondaryButton, flex: 1 }}
          onClick={() => (hours.dirty ? setDiscarding(true) : undefined)}
          data-testid="hours-cancel"
        >
          {hoursCopy.cancel}
        </button>
        <button
          type="button"
          style={{ ...m.primaryButton, flex: 1, opacity: !hours.dirty || invalid || saving ? 0.6 : 1 }}
          // Focusable with aria-disabled so the reason can be heard, never a
          // silent dead control (M-12 §08).
          aria-disabled={!hours.dirty || invalid || saving}
          onClick={() => {
            if (!hours.dirty || invalid || saving) return;
            void hours.save();
          }}
          data-testid="hours-save"
        >
          {saving ? hoursCopy.saving : hoursCopy.save}
        </button>
      </div>

      {invalid ? (
        <p style={m.fieldError} data-testid="hours-invalid-count">
          {hoursCopy.invalidCount(hours.issues.length)}
        </p>
      ) : null}

      <span style={m.visuallyHidden} aria-live="polite" data-testid="hours-announcement">
        {invalid
          ? hoursCopy.invalidCount(hours.issues.length)
          : !hours.dirty
            ? hoursCopy.noChanges
            : announcement}
      </span>

      <ConfirmDialog
        open={discarding}
        title={hoursCopy.discardTitle}
        body={[]}
        confirmLabel={hoursCopy.discardConfirm}
        cancelLabel={hoursCopy.cancel}
        onConfirm={() => {
          hours.reset();
          setDiscarding(false);
        }}
        onCancel={() => setDiscarding(false)}
        testId="hours-discard-dialog"
      />
    </div>
  );
}
