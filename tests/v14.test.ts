// 1.4: minutes only (hours unit removed), day/hour/minute formatting, training routines,
// Rocket League season suggestions and recordable shortcuts.
import { describe, expect, it } from 'vitest';
import {
  addToDay,
  completeRoutineItem,
  createDefaultData,
  createRoutine,
  createSeason,
  deleteSectionTree,
  createSection,
  findOrCreateActivity,
  nextRoutineItem,
  normalizeData,
  removeDayRoutine,
  routineProgress,
  startRoutineOnDay,
  undoRoutineItem,
} from '../src/renderer/lib/journal';
import { fmtMinutes } from '../src/renderer/lib/format';
import { currentSeason, missingSeasons, seasonCalendar, seasonSpan, suggestSeason, validSeasons } from '../src/shared/rlSeasons';
import { isPlainKey, recordKey, shortcutLabel } from '../src/renderer/lib/shortcut';

const TODAY = '2026-11-25';

describe('durations', () => {
  it('shows days, hours and minutes only when they are there', () => {
    expect(fmtMinutes(0)).toBe('0m');
    expect(fmtMinutes(45)).toBe('45m');
    expect(fmtMinutes(60)).toBe('1h');
    expect(fmtMinutes(65)).toBe('1h 5m');
    expect(fmtMinutes(1440)).toBe('1d');
    expect(fmtMinutes(1440 + 20)).toBe('1d 20m');
    expect(fmtMinutes(2 * 1440 + 3 * 60 + 7)).toBe('2d 3h 7m');
    expect(fmtMinutes(37.6)).toBe('38m');
    expect(fmtMinutes(-90)).toBe('-1h 30m');
    expect(fmtMinutes(undefined)).toBe('—');
  });
});

describe('minutes only', () => {
  it('drops the old hours unit from entries and activities (minutes were always stored)', () => {
    const data: any = createDefaultData();
    data.version = 2;
    data.activities[0].defaultUnit = 'hr';
    const s = createSeason(data, 21, '2026-11-01');
    s.days[0].entries.push({ id: 'e', activityId: 'act-freeplay', measure: 'time', minutes: 90, unit: 'hr', createdAt: '' } as any);
    const d = normalizeData(JSON.parse(JSON.stringify(data)));
    expect(d.version).toBe(3);
    expect(d.seasons[0].days[0].entries[0]).toMatchObject({ minutes: 90 });
    expect(d.seasons[0].days[0].entries[0]).not.toHaveProperty('unit');
    expect(d.activities[0]).not.toHaveProperty('defaultUnit');
    expect(d.routines).toEqual([]);
    // Idempotent.
    expect(normalizeData(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });
});

describe('routines', () => {
  function setup() {
    const data = createDefaultData();
    const season = createSeason(data, 24, '2026-11-01');
    const day = season.days.find((d) => d.date === TODAY)!;
    const aerials = findOrCreateActivity(data, 'sec-training', 'Aerials', 'time');
    const routine = createRoutine(data, ' Warm-up ', [
      { activityId: 'act-freeplay', minutes: 10 },
      { activityId: aerials.id, minutes: 15, note: 'fast aerials' },
      { activityId: '', minutes: 5 }, // dropped: no activity
      { activityId: aerials.id, minutes: 0 }, // dropped: no time
    ]);
    return { data, season, day, aerials, routine };
  }

  it('saves only complete items', () => {
    const { data, routine } = setup();
    expect(routine.name).toBe('Warm-up');
    expect(routine.items).toHaveLength(2);
    expect(data.routines).toHaveLength(1);
  });

  it('copies the routine onto a day, ticks items off into the log and back', () => {
    const { day, aerials, routine } = setup();
    addToDay(day, { activityId: aerials.id, measure: 'time', minutes: 5 });
    const dr = startRoutineOnDay(day, routine);
    expect(dr.items.map((i) => i.id)).not.toEqual(routine.items.map((i) => i.id));
    expect(nextRoutineItem(dr)?.activityId).toBe('act-freeplay');

    expect(completeRoutineItem(day, dr.id, dr.items[0].id)).toBe(true);
    expect(completeRoutineItem(day, dr.id, dr.items[0].id)).toBe(false); // already done
    // A timer passes the time actually done.
    completeRoutineItem(day, dr.id, dr.items[1].id, 12);
    expect(day.entries.find((e) => e.activityId === 'act-freeplay')).toMatchObject({ minutes: 10 });
    expect(day.entries.find((e) => e.activityId === aerials.id)).toMatchObject({ minutes: 17, note: 'fast aerials' });
    // 1.5: the 5 min of Aerials logged before the routine was added count towards it (5 + 12).
    expect(routineProgress(dr)).toMatchObject({ done: 2, total: 2, minutesDone: 27, minutesTotal: 25, complete: true });
    expect(nextRoutineItem(dr)).toBeUndefined();

    // Unticking takes exactly its time off again; an entry that drops to 0 goes away.
    undoRoutineItem(day, dr.id, dr.items[1].id);
    expect(day.entries.find((e) => e.activityId === aerials.id)).toMatchObject({ minutes: 5 });
    undoRoutineItem(day, dr.id, dr.items[0].id);
    expect(day.entries.find((e) => e.activityId === 'act-freeplay')).toBeUndefined();
    expect(routineProgress(dr).done).toBe(0);

    // Editing the saved routine doesn't change the day's copy.
    routine.items[0].minutes = 99;
    expect(dr.items[0].minutes).toBe(10);

    removeDayRoutine(day, dr.id);
    expect(day.routines).toBeUndefined();
    expect(day.entries).toHaveLength(1); // logged time stays
  });

  it('drops deleted activities from saved routines', () => {
    const { data } = setup();
    const sec = createSection(data, 'Mechanics', '#fff', 'sec-training');
    const flicks = findOrCreateActivity(data, sec.id, 'Flicks', 'time');
    const r = createRoutine(data, 'Mech', [
      { activityId: flicks.id, minutes: 10 },
      { activityId: 'act-freeplay', minutes: 5 },
    ]);
    deleteSectionTree(data, sec.id);
    expect(r.items.map((i) => i.activityId)).toEqual(['act-freeplay']);
  });

  it('keeps routines through a save and load', () => {
    const { data, day, routine } = setup();
    startRoutineOnDay(day, routine);
    const back = normalizeData(JSON.parse(JSON.stringify(data)));
    expect(back.routines[0].items).toHaveLength(2);
    expect(back.seasons[0].days.find((d) => d.date === TODAY)!.routines).toHaveLength(1);
  });
});

describe('Rocket League season calendar', () => {
  const cal = seasonCalendar();

  it('knows the current season and its length', () => {
    expect(currentSeason(cal, TODAY)).toMatchObject({ number: 24, start: '2026-09-23', end: '2026-12-09', days: 77, estimated: false });
    expect(seasonSpan(cal, 15)).toMatchObject({ start: '2024-06-05', days: 91 });
  });

  it('estimates seasons after the last known one', () => {
    expect(currentSeason(cal, '2027-01-05')).toMatchObject({ number: 25, start: '2026-12-09', days: 91, estimated: true });
  });

  it('suggests the current season, then older ones the user is missing', () => {
    expect(suggestSeason(cal, [], TODAY)?.number).toBe(24);
    expect(suggestSeason(cal, [24], TODAY)?.number).toBe(23);
    expect(suggestSeason(cal, [24, 23, 21], TODAY)?.number).toBe(22);
    expect(missingSeasons(cal, [24, 22], TODAY).slice(0, 3).map((s) => s.number)).toEqual([23, 21, 20]);
  });

  it('merges downloaded dates and ignores bad ones', () => {
    expect(validSeasons([{ number: 25, start: '2026-12-09' }, { number: 'x' }, { number: 26, start: 'soon' }, null])).toEqual([{ number: 25, start: '2026-12-09' }]);
    const merged = seasonCalendar([{ number: 25, start: '2026-12-09', end: '2027-03-17' }]);
    expect(seasonSpan(merged, 25)).toMatchObject({ days: 98, estimated: false });
  });
});

describe('shortcuts', () => {
  const key = (code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}, k = '') => ({
    code,
    key: k,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...mods,
  });

  it('records any key or combination by physical key', () => {
    expect(recordKey(key('KeyP', { ctrlKey: true, altKey: true }, 'פ'))).toEqual({ kind: 'ok', accelerator: 'Control+Alt+P' });
    expect(recordKey(key('F9'))).toEqual({ kind: 'ok', accelerator: 'F9' });
    expect(recordKey(key('Numpad5', { shiftKey: true }))).toEqual({ kind: 'ok', accelerator: 'Shift+num5' });
    expect(recordKey(key('ControlLeft', { ctrlKey: true }, 'Control'))).toEqual({ kind: 'modifier' });
    expect(recordKey(key('Escape'))).toEqual({ kind: 'cancel' });
    expect(recordKey(key('Escape', { ctrlKey: true }))).toEqual({ kind: 'ok', accelerator: 'Control+Escape' });
    expect(recordKey(key('IntlBackslash', {}, '<')).kind).toBe('unsupported');
  });

  it('shows shortcuts readably', () => {
    expect(shortcutLabel('Control+Alt+P')).toBe('Ctrl + Alt + P');
    expect(shortcutLabel('Shift+num5')).toBe('Shift + Num 5');
    expect(shortcutLabel('')).toBe('Off');
    expect(isPlainKey('P')).toBe(true);
    expect(isPlainKey('Shift+P')).toBe(true);
    expect(isPlainKey('F9')).toBe(false);
    expect(isPlainKey('Alt+P')).toBe(false);
  });
});
