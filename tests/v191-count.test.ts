// 1.9.1: routine amount items on the overlay ("count" timers) with a done button; auto-next sets the
// next item up without starting it; finished countdowns wait at 0:00 for done.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppData } from '../src/shared/model';
import type { TimerCompletion, TimerStart, TimerState } from '../src/shared/timer';

// ---- The timer service runs in the main process: give it a temp userData folder.
const userData = mkdtempSync(join(tmpdir(), 'rlj-count-'));
vi.mock('electron', () => ({ app: { getPath: () => userData } }));
vi.mock('../src/main/log', () => ({ log: () => undefined }));

// ---- A small stand-in for the app store (the real one saves through window.rlj).
const store = vi.hoisted(() => {
  const s: { state: any; subs: (() => void)[] } = { state: null, subs: [] };
  const useStore: any = () => undefined;
  useStore.getState = () => s.state;
  useStore.setState = (p: any) => {
    s.state = { ...s.state, ...p };
    s.subs.forEach((f) => f());
  };
  useStore.subscribe = (f: () => void) => s.subs.push(f);
  return { s, useStore };
});
vi.mock('../src/renderer/store', () => ({ useStore: store.useStore, flushSave: () => undefined }));

import { TimerService } from '../src/main/timer';
import { fmtCount, isCount } from '../src/shared/timer';
import { completeRoutineItem, createDefaultData, createRoutine, createSeason, routineItemState, startRoutineOnDay } from '../src/renderer/lib/journal';
import { advancesOnEnd, logTimer, timerEnded, watchCountTimer } from '../src/renderer/syncRuntime';
import { startRoutineItemTimer } from '../src/renderer/lib/routineTimer';

const BASE: TimerStart = { activityId: 'act-freeplay', label: 'Shots', activityName: 'Shots', seasonId: 's', dayId: 'd', date: '2026-11-25', durationMs: 0 };

describe('ready and finished timers in the timer service', () => {
  it('keeps a countdown at 0:00 until done, then logs its full length', () => {
    vi.useFakeTimers();
    const done: TimerCompletion[] = [];
    const svc = new TimerService({ onState: () => undefined, onComplete: (c) => done.push(c) });
    const t = svc.start({ ...BASE, durationMs: 120_000 });
    vi.advanceTimersByTime(125_000);
    expect(done).toHaveLength(0);
    const ended = svc.get()!;
    expect(ended.endedAt).toBe(t.startedAt! + 120_000);
    expect(ended).toMatchObject({ startedAt: null, accumulatedMs: 120_000 });
    expect(svc.control('toggle', 'hotkey')).toBe(ended); // nothing to pause
    vi.advanceTimersByTime(10 * 60_000);
    expect(done).toHaveLength(0);
    svc.control('finish', 'overlay');
    expect(svc.get()).toBeNull();
    expect(done).toEqual([{ timer: ended, minutes: 2, early: false }]);
    vi.useRealTimers();
  });

  it('logs a finished timer first when another one starts', () => {
    vi.useFakeTimers();
    const done: TimerCompletion[] = [];
    const svc = new TimerService({ onState: () => undefined, onComplete: (c) => done.push(c) });
    svc.start({ ...BASE, durationMs: 60_000 });
    vi.advanceTimersByTime(61_000);
    const next = svc.start({ ...BASE, label: 'Next', durationMs: 60_000 });
    expect(done.map((c) => [c.minutes, c.early])).toEqual([[1, false]]);
    expect(svc.get()).toBe(next);
    vi.useRealTimers();
  });

  it('sets a timer up without starting it, until it is started', () => {
    vi.useFakeTimers();
    const svc = new TimerService({ onState: () => undefined, onComplete: () => undefined });
    const t = svc.start({ ...BASE, durationMs: 60_000, paused: true });
    expect(t).toMatchObject({ ready: true, startedAt: null, accumulatedMs: 0 });
    expect('paused' in t).toBe(false);
    vi.advanceTimersByTime(5 * 60_000);
    expect(svc.get()!.endedAt).toBeUndefined();
    const started = svc.control('toggle', 'hotkey')!;
    expect(started.ready).toBeUndefined();
    expect(started.startedAt).not.toBeNull();
    // A count can't be "ready": it waits for done anyway.
    expect(svc.start({ ...BASE, mode: 'count', amount: 5, paused: true }).ready).toBeUndefined();
    vi.useRealTimers();
  });
});

describe('count timers in the timer service', () => {
  it('never ends by itself, ignores pause and ticks off on done', () => {
    vi.useFakeTimers();
    const done: TimerCompletion[] = [];
    const states: (TimerState | null)[] = [];
    const svc = new TimerService({ onState: (t) => states.push(t), onComplete: (c) => done.push(c) });
    const t = svc.start({ ...BASE, mode: 'count', amount: 50, durationMs: 60_000 });
    expect(t).toMatchObject({ mode: 'count', amount: 50, durationMs: 0 });
    vi.advanceTimersByTime(10 * 60_000);
    expect(done).toHaveLength(0);
    expect(svc.control('toggle', 'hotkey')).toBe(svc.get());
    expect(svc.get()!.startedAt).not.toBeNull();
    expect(svc.control('finish', 'overlay')).toBeNull();
    expect(svc.get()).toBeNull();
    expect(done).toEqual([{ timer: t, minutes: 0, early: false }]);
    expect(states.at(-1)).toBeNull();
    vi.useRealTimers();
  });

  it('formats the amount', () => {
    expect(fmtCount(50)).toBe('50×');
    expect(fmtCount(12.5)).toBe('12.5×');
    expect(isCount({ mode: 'count' })).toBe(true);
    expect(isCount({ mode: 'up' })).toBe(false);
    expect(isCount(null)).toBe(false);
  });
});

describe('amount items through the overlay', () => {
  let started: TimerStart[];
  let controls: string[];
  let toasts: any[];

  function setup(autoNext = true) {
    const data: AppData = createDefaultData();
    data.settings.timerSound = false;
    data.settings.systemNotifications = false;
    const season = createSeason(data, 21, '2026-11-01');
    const day = season.days.find((d) => d.date === '2026-11-25')!;
    data.activities.push({ id: 'act-shots', sectionId: 'sec-training', name: 'Air roll shots', defaultMeasure: 'amount', order: 1, createdAt: '' });
    const r = createRoutine(data, 'Warm-up', [
      { activityId: 'act-freeplay', minutes: 10 },
      { activityId: 'act-shots', kind: 'amount', minutes: 0, amount: 50 },
      { activityId: 'act-freeplay', kind: 'stopwatch', minutes: 0 },
    ]);
    const dr = startRoutineOnDay(day, r);
    dr.autoNext = autoNext;
    store.s.state = {
      data,
      timer: null,
      toast: (t: any) => toasts.push(t),
      mutate: (fn: (d: AppData) => void) => {
        const draft = structuredClone(store.s.state.data);
        fn(draft);
        store.useStore.setState({ data: draft });
      },
    };
    const ref = { seasonId: season.id, dayId: day.id, dayRoutineId: dr.id };
    const today = () => store.s.state.data.seasons[0].days.find((d: any) => d.id === day.id);
    return { ref, dr, today };
  }

  const timerFor = (s: TimerStart): TimerState => ({ ...s, id: `t${Math.random()}`, startedAt: Date.now(), accumulatedMs: 0, createdAt: Date.now() });

  beforeEach(() => {
    started = [];
    controls = [];
    toasts = [];
    store.s.subs = [];
    (globalThis as any).window = {
      rlj: {
        timerStart: async (s: TimerStart) => {
          started.push(s);
          store.useStore.setState({ timer: timerFor(s) });
          return null;
        },
        timerControl: async (a: string) => {
          controls.push(a);
          if (a === 'cancel') store.useStore.setState({ timer: null });
          return null;
        },
        notify: () => undefined,
        timerGet: async () => null,
        onTimerState: () => () => undefined,
        onTimerComplete: () => () => undefined,
      },
    };
  });

  it('puts an amount item on the overlay as a count', async () => {
    const { ref, dr } = setup();
    expect(await startRoutineItemTimer({ ...ref, itemId: dr.items[1].id }, false)).toBe(true);
    expect(started[0]).toMatchObject({ mode: 'count', amount: 50, durationMs: 0, activityName: 'Air roll shots', label: 'Warm-up 2/3 · Air roll shots', routine: { itemId: dr.items[1].id } });
  });

  it('1.10: logs each timer as a session of the entry (routine items with their item)', () => {
    const { ref, dr, today } = setup(false);
    const item = timerFor({ ...BASE, ...ref, activityId: 'act-freeplay', mode: 'down', durationMs: 600_000, routine: { dayRoutineId: dr.id, itemId: dr.items[0].id } });
    logTimer({ timer: item, minutes: 10, early: false });
    logTimer({ timer: timerFor({ ...BASE, ...ref, activityId: 'act-freeplay', mode: 'down', durationMs: 300_000 }), minutes: 5, early: false });
    logTimer({ timer: timerFor({ ...BASE, ...ref, activityId: 'act-freeplay', mode: 'up', durationMs: 0, note: 'flicks' }), minutes: 12, early: true });
    const e = today().entries.find((x: any) => x.activityId === 'act-freeplay');
    expect(e.minutes).toBe(27);
    expect(e.sessions.map((s: any) => [s.value, s.by, s.note ?? null, s.routineItemId === dr.items[0].id])).toEqual([
      [10, 'timer', null, true],
      [5, 'timer', null, false],
      [12, 'stopwatch', 'flicks', false],
    ]);
  });

  it('goes timer → amount on the overlay → stopwatch with auto-next', async () => {
    const { ref, dr, today } = setup();
    // The 10-minute timer ends: the amount goes on the overlay by itself.
    const first = timerFor({ ...BASE, ...ref, activityId: 'act-freeplay', mode: 'down', durationMs: 600_000, routine: { dayRoutineId: dr.id, itemId: dr.items[0].id } });
    logTimer({ timer: first, minutes: 10, early: false });
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(started.at(-1)).toMatchObject({ mode: 'count', amount: 50, routine: { itemId: dr.items[1].id } });
    expect(toasts.at(-1).body).toContain('50× Air roll shots, on the overlay');

    // Done pressed on the overlay: 50 shots logged, the stopwatch starts.
    const count = store.s.state.timer as TimerState;
    store.useStore.setState({ timer: null });
    logTimer({ timer: count, minutes: 0, early: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(routineItemState(today(), dr.items[1].id)).toMatchObject({ done: true, progress: 50 });
    expect(today().entries.find((e: any) => e.activityId === 'act-shots')).toMatchObject({ measure: 'amount', amount: 50 });
    expect(toasts.at(-1).title).toBe('Done: 50× Air roll shots logged');
    // Auto-next sets the stopwatch up without starting it.
    expect(started.at(-1)).toMatchObject({ mode: 'up', paused: true, routine: { itemId: dr.items[2].id } });
    expect(toasts.at(-1).body).toContain('is ready: press ▶ to start');
  });

  it('moves to the next timer ready (not started) when a timer ends with auto-next', async () => {
    const { ref, dr } = setup();
    // Make item 2 a timer too.
    store.s.state.mutate((d: AppData) => {
      const x = d.seasons[0].days.find((y) => y.id === ref.dayId)!.routines![0].items[1];
      x.kind = 'time';
      x.minutes = 15;
      delete x.amount;
    });
    const first = timerFor({ ...BASE, ...ref, activityId: 'act-freeplay', mode: 'down', durationMs: 600_000, routine: { dayRoutineId: dr.id, itemId: dr.items[0].id } });
    const ended = { ...first, startedAt: null, accumulatedMs: 600_000, endedAt: Date.now() };
    expect(advancesOnEnd(store.s.state.data, ended)).toBe(true);
    // It ended: auto-next logs it right away (done), which then sets the next one up.
    timerEnded(ended);
    timerEnded(ended); // a second state update for the same timer changes nothing
    expect(controls).toEqual(['finish']);
    logTimer({ timer: ended, minutes: 10, early: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(started.at(-1)).toMatchObject({ mode: 'down', paused: true, durationMs: 15 * 60_000, routine: { itemId: dr.items[1].id } });
  });

  it('waits at 0:00 for done when nothing comes next (last item, auto-next off, no routine)', () => {
    const { ref, dr } = setup();
    const t = (itemId?: string) =>
      ({ ...timerFor({ ...BASE, ...ref, mode: 'down', durationMs: 60_000, ...(itemId ? { routine: { dayRoutineId: dr.id, itemId } } : {}) }), startedAt: null, accumulatedMs: 60_000, endedAt: Date.now() }) as TimerState;
    expect(advancesOnEnd(store.s.state.data, t())).toBe(false);
    // The last item still to do (the others ticked off).
    store.s.state.mutate((d: AppData) => {
      const items = d.seasons[0].days.find((y) => y.id === ref.dayId)!.routines![0].items;
      items[0].done = true;
      items[0].loggedMinutes = 10;
      items[1].done = true;
      items[1].loggedAmount = 50;
    });
    expect(advancesOnEnd(store.s.state.data, t(dr.items[2].id))).toBe(false);
    expect(advancesOnEnd(store.s.state.data, t(dr.items[0].id))).toBe(true);
    store.s.state.mutate((d: AppData) => void (d.seasons[0].days.find((y) => y.id === ref.dayId)!.routines![0].autoNext = false));
    expect(advancesOnEnd(store.s.state.data, t(dr.items[0].id))).toBe(false);
    // It stays: no done pressed for the user, a "time's up" message instead.
    const last = t(dr.items[2].id);
    timerEnded(last);
    expect(controls).toEqual([]);
    expect(toasts.at(-1).title).toBe('Time’s up: 1m Shots');
    expect(toasts.at(-1).body).toContain('to log it');
  });

  it('only ticks it off without auto-next, and never logs a count twice', async () => {
    const { ref, dr, today } = setup(false);
    await startRoutineItemTimer({ ...ref, itemId: dr.items[1].id }, false);
    const count = store.s.state.timer as TimerState;
    store.useStore.setState({ timer: null });
    logTimer({ timer: count, minutes: 0, early: false });
    logTimer({ timer: count, minutes: 0, early: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(today().entries.filter((e: any) => e.activityId === 'act-shots').map((e: any) => e.amount)).toEqual([50]);
    expect(started).toHaveLength(1);
    expect(toasts.at(-1).body).toContain('Added to');
  });

  it('takes the amount off the overlay when its item is ticked off another way', async () => {
    const { ref, dr } = setup();
    watchCountTimer();
    await startRoutineItemTimer({ ...ref, itemId: dr.items[1].id }, false);
    expect(controls).toEqual([]);
    // Logged with the pen instead (30, not 50): the item is done, so it comes off the overlay.
    store.s.state.mutate((d: AppData) => {
      const day = d.seasons[0].days.find((x) => x.id === ref.dayId)!;
      completeRoutineItem(day, dr.id, dr.items[1].id, 30);
    });
    expect(controls).toContain('cancel');
    expect(store.s.state.timer).toBeNull();
  });
});
