// Training timer: shared by the main process (which owns it), the app window and the overlay.
// All times are wall-clock based so a timer keeps counting through app restarts and updates.

export interface TimerStart {
  activityId: string;
  /** e.g. "Training › Freeplay · Flicks" */
  label: string;
  /** Short name shown in the overlay, e.g. "Flicks". */
  activityName: string;
  color?: string;
  seasonId: string;
  dayId: string;
  date: string;
  /** Countdown length; 0 for a stopwatch or a count. */
  durationMs: number;
  note?: string;
  /**
   * 'down' = timer that ends by itself (default), 'up' = stopwatch you stop when you're done,
   * 'count' = an amount to do (routine amount item): no clock, it waits on the overlay until you press done.
   */
  mode?: 'down' | 'up' | 'count';
  /** With mode 'count': how many to do (shown on the overlay, e.g. 50×). */
  amount?: number;
  /** Set when the timer runs an item of a routine started on that day. */
  routine?: { dayRoutineId: string; itemId: string };
}

export interface TimerState extends TimerStart {
  id: string;
  /** Running since (epoch ms); null while paused. */
  startedAt: number | null;
  /** Time counted before the current run. */
  accumulatedMs: number;
  createdAt: number;
}

/** Sent to the app when a timer ends (or is finished early) so it can be logged. */
export interface TimerCompletion {
  timer: TimerState;
  minutes: number;
  early: boolean;
}

export type TimerAction = 'pause' | 'resume' | 'toggle' | 'finish' | 'cancel';
/** Where a timer command came from (written to the log, to tell what works in game). */
export type TimerSource = 'app' | 'overlay' | 'hotkey';

export function elapsedMs(t: TimerState, now = Date.now()) {
  return Math.max(0, t.accumulatedMs + (t.startedAt !== null ? now - t.startedAt : 0));
}

export function remainingMs(t: TimerState, now = Date.now()) {
  return Math.max(0, t.durationMs - elapsedMs(t, now));
}

export function isCountUp(t: Pick<TimerState, 'mode'>) {
  return t.mode === 'up';
}

/** An amount to do (no clock): ends only when the user presses done. */
export function isCount(t: Pick<TimerState, 'mode'> | null | undefined) {
  return t?.mode === 'count';
}

/** 50× · 12.5× */
export function fmtCount(n: number | undefined) {
  return `${+(n ?? 0).toFixed(2)}×`;
}

/** What to show: time left for a timer, time so far for a stopwatch. */
export function displayMs(t: TimerState, now = Date.now()) {
  return isCountUp(t) ? elapsedMs(t, now) : remainingMs(t, now);
}

export function isRunning(t: TimerState) {
  return t.startedAt !== null;
}

export function pauseTimer(t: TimerState, now = Date.now()): TimerState {
  if (t.startedAt === null) return t;
  return { ...t, accumulatedMs: elapsedMs(t, now), startedAt: null };
}

export function resumeTimer(t: TimerState, now = Date.now()): TimerState {
  if (t.startedAt !== null) return t;
  return { ...t, startedAt: now };
}

/** 5:07 · 12:30 · 1:02:03 */
export function fmtClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Minutes to log for a timer stopped early (whole minutes; under 30 seconds logs nothing). */
export function earlyMinutes(t: TimerState, now = Date.now()) {
  const ms = elapsedMs(t, now);
  if (ms < 30_000) return 0;
  return Math.max(1, Math.round(ms / 60_000));
}
