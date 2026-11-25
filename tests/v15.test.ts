// 1.5: routine items measured as an amount or with a stopwatch, and routines added to a day count
// what was already logged that day.
import { describe, expect, it } from 'vitest';
import {
  addToDay,
  completeRoutineItem,
  createDefaultData,
  createRoutine,
  createSeason,
  findOrCreateActivity,
  fmtItemPlan,
  itemProgress,
  itemRemaining,
  nextRoutineItem,
  normalizeData,
  routineLengthLabel,
  routineMinutes,
  routineProgress,
  startRoutineOnDay,
  undoRoutineItem,
} from '../src/renderer/lib/journal';

const TODAY = '2026-11-25';

function setup() {
  const data = createDefaultData();
  const season = createSeason(data, 24, '2026-11-01');
  const day = season.days.find((d) => d.date === TODAY)!;
  const shots = findOrCreateActivity(data, 'sec-training', 'Shots', 'amount');
  const aerials = findOrCreateActivity(data, 'sec-training', 'Aerials', 'time');
  const routine = createRoutine(data, 'Mix', [
    { activityId: 'act-freeplay', minutes: 10 },
    { activityId: shots.id, kind: 'amount', minutes: 0, amount: 50 },
    { activityId: aerials.id, kind: 'stopwatch', minutes: 0 },
  ]);
  return { data, season, day, shots, aerials, routine };
}

const entry = (day: any, activityId: string, measure: 'time' | 'amount') => day.entries.find((e: any) => e.activityId === activityId && e.measure === measure);

describe('routine item kinds', () => {
  it('saves time, amount and stopwatch items, dropping incomplete ones', () => {
    const data = createDefaultData();
    const r = createRoutine(data, 'R', [
      { activityId: 'act-freeplay', kind: 'amount', minutes: 0, amount: 0 }, // dropped: no amount
      { activityId: 'act-freeplay', kind: 'amount', minutes: 5, amount: 20 }, // minutes ignored
      { activityId: 'act-freeplay', kind: 'stopwatch', minutes: 7, amount: 3 }, // kept, no time or amount
      { activityId: 'act-freeplay', kind: 'time', minutes: 15 },
      { activityId: '', kind: 'stopwatch', minutes: 0 }, // dropped: no activity
    ]);
    expect(r.items.map(({ id, ...i }) => i)).toEqual([
      { activityId: 'act-freeplay', kind: 'amount', minutes: 0, amount: 20, note: undefined },
      { activityId: 'act-freeplay', kind: 'stopwatch', minutes: 0, note: undefined },
      { activityId: 'act-freeplay', minutes: 15, note: undefined }, // 'time' is stored like 1.4 items
    ]);
    expect(routineMinutes(r.items)).toBe(15);
    expect(routineLengthLabel(r.items)).toBe('15m + stopwatch');
    expect(r.items.map(fmtItemPlan)).toEqual(['20×', 'Stopwatch', '15m']);
  });

  it('logs amounts as a count and stopwatch items as the time timed', () => {
    const { day, shots, aerials, routine } = setup();
    const dr = startRoutineOnDay(day, routine);
    const [free, shot, sw] = dr.items;

    completeRoutineItem(day, dr.id, shot.id);
    expect(entry(day, shots.id, 'amount')).toMatchObject({ amount: 50 });
    undoRoutineItem(day, dr.id, shot.id);
    expect(entry(day, shots.id, 'amount')).toBeUndefined();
    completeRoutineItem(day, dr.id, shot.id, 42); // logged a different amount
    expect(entry(day, shots.id, 'amount')).toMatchObject({ amount: 42 });
    expect(itemProgress(dr.items[1])).toBe(42);

    // A stopwatch item ticked by hand adds nothing; the stopwatch passes the time.
    completeRoutineItem(day, dr.id, sw.id);
    expect(entry(day, aerials.id, 'time')).toBeUndefined();
    undoRoutineItem(day, dr.id, sw.id);
    completeRoutineItem(day, dr.id, sw.id, 17);
    expect(entry(day, aerials.id, 'time')).toMatchObject({ minutes: 17 });

    expect(nextRoutineItem(dr)?.id).toBe(free.id);
    completeRoutineItem(day, dr.id, free.id);
    expect(routineProgress(dr)).toMatchObject({ done: 3, total: 3, minutesDone: 10, minutesTotal: 10, stopwatchMinutes: 17, complete: true });
  });

  it('migrates 1.4 routines (no kind) as timed items and keeps the file stable', () => {
    const { data, day, routine } = setup();
    startRoutineOnDay(day, routine);
    (data.routines[0].items[0] as any).kind = undefined;
    const back = normalizeData(JSON.parse(JSON.stringify(data)));
    expect(back.routines[0].items.map((i) => i.kind)).toEqual([undefined, 'amount', 'stopwatch']);
    expect(normalizeData(JSON.parse(JSON.stringify(back)))).toEqual(back);
  });
});

describe('adding a routine to a day counts what was already logged', () => {
  it('ticks off items already done, shows partial progress and more than planned', () => {
    const { day, shots, aerials, routine } = setup();
    addToDay(day, { activityId: 'act-freeplay', measure: 'time', minutes: 4 });
    addToDay(day, { activityId: shots.id, measure: 'amount', amount: 80 });
    addToDay(day, { activityId: aerials.id, measure: 'time', minutes: 12 });
    const dr = startRoutineOnDay(day, routine);
    const [free, shot, sw] = dr.items;

    // Partly done: 4 of 10 minutes, the rest is what the timer / tick adds.
    expect(free).toMatchObject({ prior: 4 });
    expect(free.done).toBeUndefined();
    expect(itemRemaining(free)).toBe(6);
    // Did more than planned: done, showing 80 instead of 50.
    expect(shot).toMatchObject({ prior: 80, done: true });
    expect(itemProgress(shot)).toBe(80);
    // Stopwatch: any time already logged counts.
    expect(sw).toMatchObject({ prior: 12, done: true });
    expect(nextRoutineItem(dr)?.id).toBe(free.id);

    // Ticking adds only what's left, unticking takes only that off again.
    completeRoutineItem(day, dr.id, free.id);
    expect(entry(day, 'act-freeplay', 'time')).toMatchObject({ minutes: 10 });
    expect(itemProgress(dr.items[0])).toBe(10);
    expect(routineProgress(dr)).toMatchObject({ done: 3, minutesDone: 10, stopwatchMinutes: 12, complete: true });
    undoRoutineItem(day, dr.id, free.id);
    expect(entry(day, 'act-freeplay', 'time')).toMatchObject({ minutes: 4 });
    expect(dr.items[0]).toMatchObject({ prior: 4, done: false });

    // Unticking an item covered by earlier work: it stops counting, the logged amount stays on the day.
    undoRoutineItem(day, dr.id, shot.id);
    expect(entry(day, shots.id, 'amount')).toMatchObject({ amount: 80 });
    expect(dr.items[1].prior).toBeUndefined();
    expect(itemRemaining(dr.items[1])).toBe(50);
  });

  it('spreads an activity over its items in order and gives the extra to the last one', () => {
    const data = createDefaultData();
    const season = createSeason(data, 24, '2026-11-01');
    const day = season.days.find((d) => d.date === TODAY)!;
    const r = createRoutine(data, 'Freeplay twice', [
      { activityId: 'act-freeplay', minutes: 10 },
      { activityId: 'act-freeplay', minutes: 5 },
    ]);
    addToDay(day, { activityId: 'act-freeplay', measure: 'time', minutes: 12 });
    let dr = startRoutineOnDay(day, r);
    expect(dr.items.map((i) => [i.prior, !!i.done])).toEqual([
      [10, true],
      [2, false],
    ]);

    // More than both: the last item shows the extra.
    const day2 = season.days.find((d) => d.date === '2026-11-26')!;
    addToDay(day2, { activityId: 'act-freeplay', measure: 'time', minutes: 20 });
    dr = startRoutineOnDay(day2, r);
    expect(dr.items.map((i) => [i.prior, !!i.done])).toEqual([
      [10, true],
      [10, true],
    ]);
  });

  it("doesn't count what the day's other routines already count", () => {
    const { day, routine } = setup();
    const first = startRoutineOnDay(day, routine);
    completeRoutineItem(day, first.id, first.items[0].id); // logs 10 min of Freeplay
    addToDay(day, { activityId: 'act-freeplay', measure: 'time', minutes: 3 }); // logged outside the routine
    const second = startRoutineOnDay(day, routine);
    expect(second.items[0]).toMatchObject({ prior: 3 });
    expect(second.items[0].done).toBeUndefined();
  });

  it('leaves a routine untouched on an empty day', () => {
    const { day, routine } = setup();
    const dr = startRoutineOnDay(day, routine);
    expect(dr.items.every((i) => i.prior === undefined && !i.done)).toBe(true);
  });
});

describe('day page settings', () => {
  it('opens the tracked matches card by default, also for older files', () => {
    const old: any = createDefaultData();
    delete old.settings.dayMatchesOpen;
    expect(normalizeData(JSON.parse(JSON.stringify(old))).settings.dayMatchesOpen).toBe(true);
    old.settings.dayMatchesOpen = false;
    expect(normalizeData(JSON.parse(JSON.stringify(old))).settings.dayMatchesOpen).toBe(false);
  });
});
