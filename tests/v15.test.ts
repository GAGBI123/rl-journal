// 1.5: routine items measured as an amount or with a stopwatch, and routines count what the day
// already has (1.5.1: worked out from the log at all times, so nothing is counted twice).
import { describe, expect, it } from 'vitest';
import {
  addToDay,
  completeRoutineItem,
  createDefaultData,
  createRoutine,
  createSeason,
  findOrCreateActivity,
  fmtItemPlan,
  nextRoutineItem,
  normalizeData,
  routineLengthLabel,
  routineMinutes,
  routineItemState,
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
    expect(routineItemState(day, shot.id).progress).toBe(42);

    // A stopwatch item ticked by hand adds nothing; the stopwatch passes the time.
    completeRoutineItem(day, dr.id, sw.id);
    expect(entry(day, aerials.id, 'time')).toBeUndefined();
    undoRoutineItem(day, dr.id, sw.id);
    completeRoutineItem(day, dr.id, sw.id, 17);
    expect(entry(day, aerials.id, 'time')).toMatchObject({ minutes: 17 });

    expect(nextRoutineItem(day, dr)?.id).toBe(free.id);
    completeRoutineItem(day, dr.id, free.id);
    expect(routineProgress(day, dr)).toMatchObject({ done: 3, total: 3, minutesDone: 10, minutesTotal: 10, stopwatchMinutes: 17, complete: true });
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

describe('routines count what the day really has (never twice)', () => {
  const st = (day: any, id: string) => routineItemState(day, id);

  it('ticks off items already done, shows partial progress and more than planned', () => {
    const { day, shots, aerials, routine } = setup();
    addToDay(day, { activityId: 'act-freeplay', measure: 'time', minutes: 4 });
    addToDay(day, { activityId: shots.id, measure: 'amount', amount: 80 });
    addToDay(day, { activityId: aerials.id, measure: 'time', minutes: 12 });
    const dr = startRoutineOnDay(day, routine);
    const [free, shot, sw] = dr.items;

    // Partly done: 4 of 10 minutes, the rest is what the timer / tick adds.
    expect(st(day, free.id)).toEqual({ progress: 4, done: false, remaining: 6, outside: 4 });
    // Did more than planned: done, showing 80 instead of 50.
    expect(st(day, shot.id)).toMatchObject({ progress: 80, done: true, remaining: 0 });
    // Stopwatch: any time already logged counts.
    expect(st(day, sw.id)).toMatchObject({ progress: 12, done: true });
    expect(nextRoutineItem(day, dr)?.id).toBe(free.id);

    // Ticking adds only what's missing, unticking takes only that off again.
    completeRoutineItem(day, dr.id, free.id);
    expect(entry(day, 'act-freeplay', 'time')).toMatchObject({ minutes: 10 });
    expect(st(day, free.id)).toMatchObject({ progress: 10, done: true });
    expect(routineProgress(day, dr)).toMatchObject({ done: 3, minutesDone: 10, stopwatchMinutes: 12, complete: true });
    undoRoutineItem(day, dr.id, free.id);
    expect(entry(day, 'act-freeplay', 'time')).toMatchObject({ minutes: 4 });
    expect(st(day, free.id)).toMatchObject({ progress: 4, done: false });

    // Ticking an item that's already covered adds nothing.
    expect(completeRoutineItem(day, dr.id, shot.id)).toBe(false);
    expect(entry(day, shots.id, 'amount')).toMatchObject({ amount: 80 });

    // Unticking an item covered by other work: it stops counting it, the logged amount stays on the day.
    undoRoutineItem(day, dr.id, shot.id);
    expect(entry(day, shots.id, 'amount')).toMatchObject({ amount: 80 });
    expect(st(day, shot.id)).toMatchObject({ progress: 0, done: false, remaining: 50 });
    completeRoutineItem(day, dr.id, shot.id); // now it really does another 50
    expect(entry(day, shots.id, 'amount')).toMatchObject({ amount: 130 });
  });

  it('1.4 bug: ticking items already trained that day doubled their time (now it cannot)', () => {
    const data = createDefaultData();
    const season = createSeason(data, 24, '2026-11-01');
    const day = season.days.find((d) => d.date === TODAY)!;
    const a = findOrCreateActivity(data, 'sec-training', 'Mawkzy', 'time');
    const b = findOrCreateActivity(data, 'sec-training', 'Air dribble mastery', 'time');
    const c = findOrCreateActivity(data, 'sec-training', 'Backboard therapy', 'time');
    const r = createRoutine(data, 'Daily training', [
      { activityId: 'act-freeplay', minutes: 15 },
      { activityId: a.id, minutes: 15 },
      { activityId: c.id, minutes: 15 },
      { activityId: b.id, minutes: 15 },
    ]);
    // Trained with plain timers first...
    for (const id of ['act-freeplay', a.id, b.id]) addToDay(day, { activityId: id, measure: 'time', minutes: 15 });
    // ...then added the routine and ticked everything that was done.
    const dr = startRoutineOnDay(day, r);
    for (const i of dr.items) if (i.activityId !== c.id) completeRoutineItem(day, dr.id, i.id);
    expect(day.entries.map((e) => e.minutes)).toEqual([15, 15, 15]);
    expect(routineProgress(day, dr)).toMatchObject({ done: 3, minutesDone: 45 });
  });

  it('counts work logged outside the routine after it was added', () => {
    const { day, routine } = setup();
    const dr = startRoutineOnDay(day, routine);
    const free = dr.items[0];
    // A plain timer / manual entry for the same activity while the routine is on the day.
    addToDay(day, { activityId: 'act-freeplay', measure: 'time', minutes: 7 });
    expect(st(day, free.id)).toMatchObject({ progress: 7, done: false, remaining: 3 });
    completeRoutineItem(day, dr.id, free.id); // adds only the missing 3
    expect(entry(day, 'act-freeplay', 'time')).toMatchObject({ minutes: 10 });
    addToDay(day, { activityId: 'act-freeplay', measure: 'time', minutes: 10 });
    expect(st(day, free.id)).toMatchObject({ progress: 20, done: true });
    // Deleting the day's entry: the routine follows the log.
    day.entries = [];
    expect(st(day, free.id)).toMatchObject({ progress: 0, done: true }); // still ticked, nothing counted
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
    expect(dr.items.map((i) => [st(day, i.id).progress, st(day, i.id).done])).toEqual([
      [10, true],
      [2, false],
    ]);
    // Ticking the second item adds only its missing 3 minutes.
    completeRoutineItem(day, dr.id, dr.items[1].id);
    expect(entry(day, 'act-freeplay', 'time')).toMatchObject({ minutes: 15 });

    // More than both: the last item shows the extra.
    const day2 = season.days.find((d) => d.date === '2026-11-26')!;
    addToDay(day2, { activityId: 'act-freeplay', measure: 'time', minutes: 20 });
    dr = startRoutineOnDay(day2, r);
    expect(dr.items.map((i) => [st(day2, i.id).progress, st(day2, i.id).done])).toEqual([
      [10, true],
      [10, true],
    ]);
  });

  it('does not count what the day’s other routines already count', () => {
    const { day, routine } = setup();
    const first = startRoutineOnDay(day, routine);
    completeRoutineItem(day, first.id, first.items[0].id); // logs 10 min of Freeplay
    addToDay(day, { activityId: 'act-freeplay', measure: 'time', minutes: 3 }); // logged outside the routine
    const second = startRoutineOnDay(day, routine);
    expect(st(day, second.items[0].id)).toMatchObject({ progress: 3, done: false, remaining: 7 });
    expect(st(day, first.items[0].id)).toMatchObject({ progress: 10, done: true });
  });

  it('leaves a routine untouched on an empty day and drops the 1.5.0 prior field', () => {
    const { data, day, routine } = setup();
    const dr = startRoutineOnDay(day, routine);
    expect(dr.items.every((i) => !st(day, i.id).done && !st(day, i.id).progress)).toBe(true);
    (dr.items[0] as any).prior = 4;
    const back = normalizeData(JSON.parse(JSON.stringify(data)));
    expect(back.seasons[0].days.find((d) => d.date === TODAY)!.routines![0].items[0]).not.toHaveProperty('prior');
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
