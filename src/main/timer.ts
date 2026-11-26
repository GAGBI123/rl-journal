// Owns the training timer: start / pause / resume / finish / cancel, saved to disk so it survives
// restarts and updates. The app window and the overlay only display it and send commands.
import { app } from 'electron';
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  earlyMinutes,
  fullMinutes,
  isCount,
  isCountUp,
  isEnded,
  isRunning,
  pauseTimer,
  remainingMs,
  resumeTimer,
  type TimerAction,
  type TimerCompletion,
  type TimerSource,
  type TimerStart,
  type TimerState,
} from '../shared/timer';
import { log } from './log';

export interface TimerEvents {
  onState: (t: TimerState | null) => void;
  onComplete: (c: TimerCompletion) => void;
}

const file = () => path.join(app.getPath('userData'), 'timer.json');

export class TimerService {
  private timer: TimerState | null = null;
  private endTimeout: NodeJS.Timeout | null = null;

  constructor(private events: TimerEvents) {}

  /** Restore a timer from the last run (it kept counting while the app was closed). */
  restore() {
    try {
      const t = JSON.parse(readFileSync(file(), 'utf8')) as TimerState;
      if (t && typeof t.durationMs === 'number' && t.activityId) {
        this.timer = t;
        log('timer restored', { activity: t.activityName, running: isRunning(t) });
        this.schedule();
      }
    } catch {
      /* no saved timer */
    }
  }

  get() {
    return this.timer;
  }

  start(input: TimerStart): TimerState {
    const now = Date.now();
    // A finished countdown still waiting for done is logged first, so starting another never loses it.
    const waiting = this.timer;
    if (waiting && isEnded(waiting)) {
      log('finished timer logged before a new one', { activity: waiting.activityName });
      this.timer = null;
      this.events.onComplete({ timer: waiting, minutes: fullMinutes(waiting), early: false });
    }
    const { paused, ...rest } = input;
    const ready = !!paused && input.mode !== 'count';
    this.timer = {
      ...rest,
      durationMs: input.mode === 'up' || input.mode === 'count' ? 0 : Math.max(1000, Math.round(input.durationMs)),
      id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      startedAt: ready ? null : now,
      accumulatedMs: 0,
      createdAt: now,
      ...(ready ? { ready: true } : {}),
    };
    log('timer started', {
      activity: input.activityName,
      mode: input.mode ?? 'down',
      ...(input.mode === 'count' ? { amount: input.amount } : { minutes: Math.round(input.durationMs / 60000) }),
      ...(ready ? { ready: true } : {}),
    });
    this.changed();
    return this.timer;
  }

  control(action: TimerAction, source: TimerSource = 'app') {
    const t = this.timer;
    if (!t) {
      log('timer command without a timer', { action, source });
      return null;
    }
    const now = Date.now();
    if (action !== 'cancel') log('timer', action, { source, running: isRunning(t) });
    // A count has no clock and a finished countdown has nothing left: pausing does nothing, done logs it.
    if ((isCount(t) || isEnded(t)) && (action === 'pause' || action === 'resume' || action === 'toggle')) return t;
    switch (action) {
      case 'pause':
        this.timer = pauseTimer(t, now);
        break;
      case 'resume':
        this.timer = resumeTimer(t, now);
        break;
      case 'toggle':
        this.timer = isRunning(t) ? pauseTimer(t, now) : resumeTimer(t, now);
        break;
      case 'finish': {
        if (isCount(t) || isEnded(t)) {
          // A count ticks its item off; a finished countdown logs its full length.
          this.timer = null;
          this.changed();
          this.events.onComplete({ timer: t, minutes: isCount(t) ? 0 : fullMinutes(t), early: false });
          return null;
        }
        // Stop now and log the time done so far.
        const minutes = earlyMinutes(t, now);
        this.timer = null;
        this.changed();
        if (minutes > 0) this.events.onComplete({ timer: t, minutes, early: true });
        return null;
      }
      case 'cancel':
        log('timer cancelled', { source });
        this.timer = null;
        break;
    }
    this.changed();
    return this.timer;
  }

  private changed() {
    this.schedule();
    this.events.onState(this.timer);
    void this.persist();
  }

  private async persist() {
    try {
      if (this.timer) await fs.writeFile(file(), JSON.stringify(this.timer), 'utf8');
      else await fs.unlink(file()).catch(() => undefined);
    } catch (err) {
      log('timer save failed', String(err));
    }
  }

  /** Fire exactly when the remaining time runs out (re-armed on every change). */
  private schedule() {
    if (this.endTimeout) clearTimeout(this.endTimeout);
    this.endTimeout = null;
    const t = this.timer;
    if (!t || !isRunning(t) || isCountUp(t) || isCount(t) || isEnded(t)) return; // a stopwatch or a count only ends when you stop it
    const left = remainingMs(t);
    if (left <= 0) return this.end();
    // Timers can drift over long waits; re-check at most every minute.
    this.endTimeout = setTimeout(() => this.schedule(), Math.min(left + 50, 60_000));
  }

  /**
   * The countdown reached 0: it stays (at 0:00) until the user presses done, which logs it. The app
   * plays the sound, and with auto-next it logs it right away and moves on to the next item.
   */
  private end() {
    const t = this.timer;
    if (!t || t.startedAt === null) return;
    // When it actually ran out (the app may have been closed then).
    const endedAt = t.startedAt + Math.max(0, t.durationMs - t.accumulatedMs);
    this.timer = { ...t, startedAt: null, accumulatedMs: t.durationMs, endedAt };
    log('timer finished', { activity: t.activityName });
    this.changed();
  }
}
