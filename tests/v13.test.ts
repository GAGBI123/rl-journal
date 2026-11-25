// 1.3: days are cleared instead of deleted (only the last day can be removed), closing a season
// removes the remaining days, and the stopwatch timer.
import { describe, expect, it } from 'vitest';
import { addOneDay, addToDay, clearDay, closeSeason, createDefaultData, createSeason, dayNumber, removeLastDay } from '../src/renderer/lib/journal';
import { displayMs, earlyMinutes, isCountUp, pauseTimer, type TimerState } from '../src/shared/timer';

const TODAY = '2026-11-25';

function setup() {
  const data = createDefaultData();
  const season = createSeason(data, 21, '2026-11-01');
  return { data, season, day: (date: string) => season.days.find((d) => d.date === date)! };
}

describe('season days', () => {
  it('clears a day but keeps it in the season', () => {
    const { data, season, day } = setup();
    addToDay(day(TODAY), { activityId: 'act-freeplay', measure: 'time', minutes: 30, unit: 'min' });
    day(TODAY).note = 'good session';
    day(TODAY).hideRecord = true;
    data.matches.push({ id: 'm', at: '', date: TODAY, seasonId: season.id, dayId: day(TODAY).id, entryId: 'x', activityId: 'act-3s', mode: '', result: 'win', source: 'game' });
    expect(clearDay(data, season.id, day(TODAY).id)).toBe(1);
    expect(season.days).toHaveLength(90);
    expect(day(TODAY)).toMatchObject({ entries: [] });
    expect(day(TODAY).note).toBeUndefined();
    expect(day(TODAY).hideRecord).toBeUndefined();
    expect(data.matches).toHaveLength(0);
  });

  it('removes only the last day and adds days back at the end', () => {
    const { data, season } = setup();
    const last = removeLastDay(data, season.id)!;
    expect(last.date).toBe('2027-01-29');
    expect(season.days).toHaveLength(89);
    const added = addOneDay(data, season.id)!;
    expect(added.date).toBe('2027-01-29');
    expect(dayNumber(season, added)).toBe(90);
    addOneDay(data, season.id);
    expect(season.days[season.days.length - 1].date).toBe('2027-01-30');
  });

  it('closing removes the remaining days after today but keeps logged ones', () => {
    const { data, season, day } = setup();
    addToDay(day('2026-12-01'), { activityId: 'act-freeplay', measure: 'time', minutes: 5, unit: 'min' }); // planned ahead
    const removed = closeSeason(data, season.id, TODAY);
    expect(season.status).toBe('closed');
    expect(season.days[season.days.length - 1].date).toBe('2026-12-01');
    expect(season.days.filter((d) => d.date > TODAY)).toHaveLength(1);
    expect(removed).toBe(90 - 25 - 1);
  });
});

describe('stopwatch', () => {
  const sw = (over: Partial<TimerState> = {}): TimerState => ({
    id: 's',
    activityId: 'act-freeplay',
    activityName: 'Freeplay',
    label: 'Training · Freeplay',
    seasonId: 's',
    dayId: 'd',
    date: TODAY,
    durationMs: 0,
    unit: 'min',
    mode: 'up',
    startedAt: 1_000_000,
    accumulatedMs: 0,
    createdAt: 1_000_000,
    ...over,
  });

  it('counts up instead of down and logs the time so far', () => {
    const t = sw();
    expect(isCountUp(t)).toBe(true);
    expect(displayMs(t, 1_000_000 + 37 * 60_000)).toBe(37 * 60_000);
    expect(earlyMinutes(t, 1_000_000 + 37.4 * 60_000)).toBe(37);
    const paused = pauseTimer(t, 1_000_000 + 10 * 60_000);
    expect(displayMs(paused, 9_999_999_999)).toBe(10 * 60_000);
  });

  it('a regular timer still shows the time left', () => {
    const t = sw({ mode: undefined, durationMs: 30 * 60_000 });
    expect(isCountUp(t)).toBe(false);
    expect(displayMs(t, 1_000_000 + 10 * 60_000)).toBe(20 * 60_000);
  });
});
